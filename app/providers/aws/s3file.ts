import {Injectable} from "@angular/core";
import {Http} from "@angular/http";
import {SafeUrl, DomSanitizationService} from '@angular/platform-browser';
import {Storage, LocalStorage} from 'ionic-angular';

import {BootSettings} from "../config/boot_settings";
import {assert} from "../../util/assertion";
import {Logger} from "../../util/logging";
import {Cognito} from "./cognito";

import {AWS, S3, AWSRequest, requestToPromise} from "./aws";

const logger = new Logger("S3File");

export type S3FileHead = {
    ContentLength?: number,
    ContentType: string,
    LastModified: Date,
    Metadata: {[key: string]: string}
}

@Injectable()
export class S3File {
    constructor(private settings: BootSettings, cognito: Cognito) {
        this.client = cognito.identity.then((x) => new AWS.S3());
    }

    private client: Promise<S3>;

    private async invoke<R>(proc: (s3client) => AWSRequest): Promise<R> {
        return requestToPromise<R>(proc(await this.client));
    }

    private async load(path: string): Promise<{Body: number[]}> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Reading file: ${bucketName}:${path}`);
        return await this.invoke<{ Body: number[] }>((s3) => s3.getObject({
            Bucket: bucketName,
            Key: path
        }));
    }

    async download(path: string, type: string = "image/jpeg"): Promise<Blob> {
        const res = await this.load(path);
        return new Blob([res.Body], { type: type });
    }

    async read(path: string): Promise<string> {
        const res = await this.load(path);
        return String.fromCharCode.apply(null, res.Body);
    }

    async write(path: string, text: string): Promise<void> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Write file: ${bucketName}:${path}`);
        await this.invoke((s3) => s3.putObject({
            Bucket: bucketName,
            Key: path,
            Body: text
        }));
    }

    async upload(path: string, blob: Blob): Promise<void> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Uploading file: ${bucketName}:${path}`);
        await this.invoke((s3) => s3.putObject({
            Bucket: bucketName,
            Key: path,
            Body: blob,
            ContentType: blob.type
        }));
    }

    async remove(path: string): Promise<void> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Removing file: ${bucketName}:${path}`);
        await this.invoke((s3) => s3.deleteObject({
            Bucket: bucketName,
            Key: path
        }));
    }

    async removeFiles(pathList: string[]): Promise<void> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Removing files in bucket[${bucketName}]: ${JSON.stringify(pathList, null, 4)}`);
        const lists = _.chunk(pathList, 1000);
        await Promise.all(_.map(lists, (list) =>
            this.invoke((s3) => s3.deleteObjects({
                Bucket: bucketName,
                Delete: {
                    Objects: _.map(list, (path) => {
                        return {
                            Key: path
                        }
                    })
                }
            }))
        ));
    }

    async removeDir(path: string): Promise<void> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Removing dir: ${bucketName}:${path}`);
        const dir = `${path}/`;
        const list = await this.list(dir);
        this.removeFiles(list);
    }

    async copy(src: string, dst: string): Promise<void> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Copying file: ${bucketName}:${src}=>${dst}`);
        await this.invoke((s3) => s3.copyObject({
            Bucket: bucketName,
            CopySource: `${bucketName}/${src}`,
            Key: dst
        }));
    }

    async move(src: string, dst: string): Promise<void> {
        await this.copy(src, dst);
        await this.remove(src);
    }

    async moveDir(src: string, dst: string): Promise<void> {
        const files = _.filter(await this.list(`${src}/`), (path) => {
            return !path.endsWith("/");
        });
        await Promise.all(_.map(files, (srcPath) => {
            const dstPath = srcPath.replace(src, dst);
            return this.move(srcPath, dstPath);
        }));
        await this.removeDir(src);
    }

    async list(path: string): Promise<Array<string>> {
        const bucketName = await this.settings.s3Bucket;
        const res = await this.invoke<{ Contents: { Key: string }[] }>((s3) => s3.listObjects({
            Bucket: bucketName,
            Prefix: path
        }));
        return res.Contents.map((x) => x.Key);
    }

    async head(path: string): Promise<S3FileHead> {
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Getting header: ${bucketName}:${path}`);
        const res = await this.invoke<S3FileHead>((s3) => s3.headObject({
            Bucket: bucketName,
            Key: path
        }));
        return res;
    }

    async exists(path: string): Promise<boolean> {
        try {
            const res = await this.head(path);
            logger.debug(() => `Head of ${path}: ${JSON.stringify(res)}`);
            return !_.isNil(res.LastModified);
        } catch (ex) {
            logger.debug(() => `Failed to get head of ${path}: ${ex}`);
            return false;
        }
    }

    async url(path: string, expiresInSeconds: number): Promise<string> {
        const s3: any = await this.client;
        const bucketName = await this.settings.s3Bucket;
        logger.debug(() => `Getting url of file: ${bucketName}:${path}`);
        try {
            return s3.getSignedUrl("getObject", {
                Bucket: bucketName,
                Key: path,
                Expires: expiresInSeconds
            });
        } catch (ex) {
            logger.warn(() => `Error on getting url: ${ex}`);
        }
    }
}

@Injectable()
export class S3Image {
    private local: Storage = new Storage(LocalStorage);

    constructor(public s3: S3File, private sanitizer: DomSanitizationService) { }

    async getUrl(s3path: string): Promise<SafeUrl> {
        assert("Caching S3 path", s3path);
        const url = await this.getCached(s3path);
        return _.isNil(url) ? null : this.sanitizer.bypassSecurityTrustUrl(url);
    }

    private async getLocal(s3path: string): Promise<{ url: string, lastModified: Date }> {
        const data = await this.local.get(s3path);
        if (!data) return null;
        const result = JSON.parse(data);
        return result.url && result.lastModified ? result : null;
    }

    private async setLocal(s3path: string, url: string, lastModified: Date): Promise<void> {
        try {
            const data = { url: url, lastModified: lastModified };
            await this.local.set(s3path, JSON.stringify(data));
        } catch (ex) {
            logger.warn(() => `Error on setting local data: ${s3path}: ${ex}`);
        }
    }

    private async removeLocal(s3path: string): Promise<void> {
        try {
            await this.local.remove(s3path);
            logger.debug(() => `Removed local data: ${s3path}`);
        } catch (ex) {
            logger.warn(() => `Error on removing local data: ${s3path}: ${ex}`);
        }
    }

    private async getCached(s3path: string): Promise<string> {
        try {
            const head = await this.s3.head(s3path);
            if (head) {
                try {
                    const data = await this.getLocal(s3path);
                    if (data) {
                        if (head.LastModified <= data.lastModified) {
                            if (await this.checkUrl(data.url)) {
                                logger.debug(() => `Using cached url for ${s3path}, ${data.url}`);
                                return data.url;
                            } else {
                                logger.debug(() => `Cached url is not valid: ${s3path}, ${data.url}`);
                            }
                        } else {
                            logger.debug(() => `Cached url is old: ${s3path}, ${data.lastModified}`);
                        }
                    } else {
                        logger.debug(() => `No cached url for ${s3path}`);
                    }
                } catch (ex) {
                    logger.info(() => `Failed to get local data: ${s3path}: ${ex}`);
                }
                const blob = await this.s3.download(s3path);
                const url = URL.createObjectURL(blob);
                this.setLocal(s3path, url, head.LastModified);
                return url;
            } else {
                logger.info(() => `No data on s3: ${s3path}, removing local cache...`);
                this.removeLocal(s3path);
            }
        } catch (ex) {
            logger.warn(() => `Failed to get url: ${s3path}`);
        }
        return null;
    }

    private async checkUrl(url: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            var http = new XMLHttpRequest();
            http.onload = () => {
                resolve(_.floor(http.status / 100) == 2);
            };
            http.onerror = () => {
                logger.warn(() => `No data on ${url}`);
                resolve(false);
            };
            http.open('GET', url);
            http.send();
        });
    }

    createCache(pathList: string[], refreshRate = 1000 * 60 * 10): CachedImage {
        return new CachedImage(this, pathList, refreshRate);
    }
}

export class CachedImage {
    private loading = true;
    private _url: SafeUrl;

    constructor(private s3image: S3Image, private _pathList: string[], refreshRate: number) {
        this.refresh(refreshRate).then(() => this.loading = false);
    }

    get isLoading(): boolean {
        return this.loading;
    }

    get listPath(): string[] {
        return _.map(this._pathList, (a) => a);
    }

    private async load(path: string): Promise<SafeUrl> {
        try {
            return await this.s3image.getUrl(path);
        } catch (ex) {
            logger.warn(() => `Failed to load s3image: ${path}: ${ex}`);
        }
        return null;
    }

    private async refresh(limit: number) {
        try {
            var url;
            var i = 0;
            while (_.isNil(url) && i < this._pathList.length) {
                url = await this.load(this._pathList[i++]);
            }
            this._url = url;
        } finally {
            setTimeout(() => {
                this.refresh(limit);
            }, limit);
        }
    }

    isSamePath(pathList: string[]): boolean {
        return _.isEmpty(_.difference(this._pathList, pathList));
    }

    get url(): SafeUrl {
        return this._url;
    }
}
