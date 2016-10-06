import {SafeUrl} from '@angular/platform-browser';

import * as Info from "./_info.d";
import {LineupController} from "./lineup";
import {ItemGroup, Item} from "./item";
import {SpecGroup, Spec} from "./spec";
import {S3File, S3Image, CachedImage} from "../../aws/s3file";
import {InputInterval} from "../../../util/input_interval";
import * as Base64 from "../../../util/base64";
import {Logger} from "../../../util/logging";

const logger = new Logger("Lineup.Deriv");

export class DerivGroup {
    availables: Deriv[];
    private _current: Deriv;
    private _changeKey: InputInterval<string> = new InputInterval<string>(1000);

    constructor(private ctrl: LineupController, public spec: Spec, public info: Info.DerivGroup) {
        this.availables = _.map(info.value.availables, (a) => {
            return new Deriv(ctrl, this, a);
        });
    }

    get key(): string {
        return this.info.key;
    }

    set key(v: string) {
        if (_.isEmpty(v)) return;
        this._changeKey.update(v, async (v) => {
            await this.ctrl.onChanging.derivGroupKey(this, async () => {
                this.info.key = v;
            });
        });
    }

    get current(): Deriv {
        if (_.isNil(this._current)) {
            this._current = this.get(this.info.value.initial) || _.head(this.availables);
        }
        return this._current;
    }

    set current(v: Deriv) {
        if (_.find(this.availables, {key: v.key}) && !_.isEqual(this.current.key, v.key)) {
            this._current = v;
            this.spec.onChangedDerivCurrent();
        }
    }

    get(key: string): Deriv {
        return _.find(this.availables, {key: key});
    }

    async remove(o: Deriv): Promise<void> {
        if (_.size(this.availables) < 2) return;
        await this.ctrl.onRemoving.deriv(o, async () => {
            _.remove(this.availables, {key: o.key});
            _.remove(this.info.value.availables, {key: o.key});
            if (_.isEqual(this.info.value.initial, o.key)) {
                this.info.value.initial = _.head(this.availables).key;
            }
        });
    }

    async createNew(): Promise<Deriv> {
        const key = await this.ctrl.createNewKey("new_deriv_value", async (key) => this.get(key));
        const one = new Deriv(this.ctrl, this, {
            name: "新しい派生の値",
            key: key,
            description: ""
        });
        this.availables.unshift(one);
        this.info.value.availables.unshift(one.info);
        return one;
    }
}

export class Deriv {
    private _image: CachedImage;
    private _changeKey: InputInterval<string> = new InputInterval<string>(1000);

    constructor(private ctrl: LineupController, public derivGroup: DerivGroup, public info: Info.Deriv) {
    }

    refreshIllustrations() {
        this.refreshImage(true);
    }

    get key(): string {
        return this.info.key;
    }

    set key(v: string) {
        if (_.isEmpty(v)) return;
        this._changeKey.update(v, async (v) => {
            await this.ctrl.onChanging.derivKey(this, async () => {
                if (_.isEqual(this.derivGroup.info.value.initial, this.key)) {
                    this.derivGroup.info.value.initial = v;
                }
                this.info.key = v;
            });
        });
    }

    private refreshImage(clear = false): CachedImage {
        if (clear || _.isNil(this._image)) {
            this._image = this.ctrl.illust.deriv(this);
        }
        return this._image;
    }

    async changeImage(file: File): Promise<void> {
        await this.ctrl.illust.uploadDeriv(this, file);
        this.refreshImage(true);
    }

    get image(): SafeUrl {
        return this.refreshImage().url;
    }
}
