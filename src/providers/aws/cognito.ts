import _ from "lodash";
import { Injectable } from "@angular/core";

import { BootSettings } from "../config/boot_settings";
import { FBConnect } from "../facebook/fb_connect";
import { Preferences } from "../config/preferences";
import { Logger } from "../util/logging";

import { AWS, ClientConfig } from "./aws";

const logger = new Logger("Cognito");

export const PROVIDER_KEY_FACEBOOK = "graph.facebook.com";

function setupCredentials(poolId: string): CognitoIdentityCredentials {
    return AWS.config.credentials = new AWS.CognitoIdentityCredentials({
        IdentityPoolId: poolId
    });
}
function getCredentials(): CognitoIdentityCredentials {
    return AWS.config.credentials;
}
interface CognitoIdentityCredentials {
    identityId: string;
    expired: boolean;
    get(callback: (err) => void): void;
    params: {
        IdentityId: string,
        Logins: { [key: string]: string; }
    };
}

export type ChangedCognitoIdHook = (oldId: string, newId: string) => Promise<void>;

@Injectable()
export class Cognito {
    private static initialized: Promise<void> = null;
    private static refreshing: Promise<CognitoIdentity> = null;

    private static changedHooks: Array<ChangedCognitoIdHook> = new Array();
    static addChangingHook(hook: ChangedCognitoIdHook) {
        this.changedHooks.push(hook);
    }

    constructor(private settings: BootSettings, private pref: Preferences, private facebook: FBConnect) {
        if (_.isNil(Cognito.initialized)) {
            Cognito.initialized = this.initialize();
        }
    }

    get identity(): Promise<CognitoIdentity> {
        return Cognito.initialized.then((_) => Cognito.refreshing);
    }

    private async initialize(): Promise<void> {
        try {
            logger.debug(() => `Initializing Cognito...`);
            (AWS.config as ClientConfig).region = await this.settings.awsRegion;
            const cred = setupCredentials(await this.settings.cognitoPoolId);
            logger.debug(() => `Refreshing credential: ${cred}`);

            if (await this.pref.getSocial(PROVIDER_KEY_FACEBOOK)) {
                await this.joinFacebook();
            } else {
                try {
                    await this.refresh();
                } catch (ex) {
                    logger.warn(() => `Retry to initialize cognito by clearing identityId...`);
                    getCredentials().params.IdentityId = null;
                    await this.refresh();
                }
            }
        } catch (ex) {
            logger.fatal(() => `Failed to initialize: ${JSON.stringify(ex, null, 4)}`);
        }
    }

    private async refresh(): Promise<CognitoIdentity> {
        const oldId = (_.isNil(Cognito.refreshing)) ? null : await Cognito.refreshing.catch((_) => null);

        return Cognito.refreshing = new Promise<CognitoIdentity>((resolve, reject) => {
            logger.info(() => `Refreshing cognito identity... (old = ${oldId})`);
            getCredentials().expired = true;
            getCredentials().get(async (err) => {
                if (err) {
                    logger.warn(() => `Cognito refresh error: ${err}`);
                    reject(err);
                } else {
                    logger.info(() => `Cognito refresh success`);
                    try {
                        const newId = new CognitoIdentity();
                        logger.debug(() => `Created CognitoIdentity: ${newId}`);
                        if (!_.isNil(oldId)) {
                            await Promise.all(Cognito.changedHooks.map(async (hook) => {
                                try {
                                    await hook(oldId.identityId, newId.identityId);
                                } catch (ex) {
                                    logger.warn(() => `Error on hook: ${ex}`);
                                }
                            }));
                            logger.info(() => `Done hooking of changing cognitoId`);
                        }
                        resolve(newId);
                    } catch (ex) {
                        logger.warn(() => `Failed to process changing CognitoIdentity: ${ex}`);
                        reject(ex);
                    }
                }
            });
        });
    }

    async joinFacebook() {
        const token = await this.facebook.login();
        await this.setToken(PROVIDER_KEY_FACEBOOK, token);
    }

    async dropFacebook() {
        await this.removeToken(PROVIDER_KEY_FACEBOOK);
    }

    private async setToken(service: string, token: string): Promise<void> {
        logger.info(() => `SignIn: ${service}`);
        const p = getCredentials().params;
        if (_.has(p.Logins, service)) {
            logger.info(() => `Nothing to do, since already signed in: ${service}`);
        } else {
            if (_.isEmpty(p.Logins)) p.Logins = {};
            p.Logins[service] = token;
            p.IdentityId = null;
            const id = await this.refresh();
            await this.pref.setSocial(service, id.isJoin(service));
        }
    }

    private async removeToken(service: string): Promise<void> {
        logger.info(() => `SignOut: ${service}`);
        const p = getCredentials().params;
        if (_.has(p.Logins, service)) {
            delete p.Logins[service];
            p.IdentityId = null;
            const id = await this.refresh();
            await this.pref.setSocial(service, id.isJoin(service));
        } else {
            logger.info(() => `Nothing to do, since not signed in: ${service}`);
        }
    }
}

export class CognitoIdentity {
    constructor() {
        this.id = getCredentials().identityId;
        this.map = _.merge({}, getCredentials().params.Logins);
    }

    toString(): string {
        return `Cognito(identityId: ${this.id}, services: [${_.keys(this.map).join(", ")}])`;
    }

    private id: string;
    private map: { [key: string]: string; } = {};

    get identityId(): string {
        return this.id;
    }

    isJoin(name: string): boolean {
        return _.has(this.map, name);
    }

    get isJoinFacebook(): boolean {
        return this.isJoin(PROVIDER_KEY_FACEBOOK);
    }
}
