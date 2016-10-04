import {SafeUrl} from '@angular/platform-browser';

import * as Info from "./_info.d";
import * as Observ from "./_observ";
import {Lineup, LineupValue} from "./lineup";
import {ItemSpecDeriv, ItemSpecDerivValue} from "./deriv";
import {S3File, S3Image, CachedImage} from "../../aws/s3file";
import {InputInterval} from "../../../util/input_interval";
import * as Base64 from "../../../util/base64";
import {Logger} from "../../../util/logging";

const logger = new Logger("LineupSpec");

export class ItemSpec {
    availables: ItemSpecValue[];
    private _current: ItemSpecValue;
    private _changeKey: InputInterval<string> = new InputInterval<string>(1000);

    constructor(private illust: Observ.Illustration, public item: LineupValue, public info: Info.Spec) {
        this.availables = _.map(info.value.availables, (key) => {
            const v = _.find(item.info.specValues, {"key": key});
            return new ItemSpecValue(illust, this, v);
        });
        this.current = _.find(this.availables, (a) => _.isEqual(a.info.key, info.value.initial));
    }

    get key(): string {
        return this.info.key;
    }

    set key(v: string) {
        if (_.isEmpty(v)) return;
        this._changeKey.update(v, async (v) => {
            await this.illust.onChanging.specKey(this, async () => {
                logger.debug(() => `Changing lineup key: ${this.info.key} -> ${v}`);
                this.info.key = v;
            });
        });
    }

    get current(): ItemSpecValue {
        return this._current;
    }

    set current(v: ItemSpecValue) {
        this.item.onChangeSpecValue();
        this._current = v;
    }

    get(key: string) {
        return  _.find(this.availables, (a) => _.isEqual(key, a.info.key));
    }

    async remove(o: ItemSpecValue): Promise<void> {
        if (_.size(this.availables) > 1) {
            await this.illust.onRemoving.specValue(o, async () => {
                _.remove(this.availables, (a) => _.isEqual(a.info.key, o.info.key));
                _.remove(this.info.value.availables, (a) => _.isEqual(a, o.info.key));
                if (_.isEqual(this.info.value.initial, o.info.key)) {
                    this.info.value.initial = _.head(this.availables).info.key;
                }
            });
        }
    }

    createNew() {
        const key = Observ.createNewKey("new_value", (key) => this.get(key));
        const one = new ItemSpecValue(this.illust, this, {
            name: "新しい仕様の値",
            key: key,
            description: "",
            derives: [],
            price: 100
        });
        this.availables.unshift(one);
        this.item.info.specValues.unshift(one.info);
        this.info.value.availables.unshift(one.info.key);
        return one;
    }
}

export class ItemSpecValue {
    derives: ItemSpecDeriv[];
    private _image: CachedImage;
    private _changeKey: InputInterval<string> = new InputInterval<string>(1000);

    constructor(private illust: Observ.Illustration, public spec: ItemSpec, public info: Info.SpecValue) {
        this.derives = _.map(info.derives, (o) => new ItemSpecDeriv(illust, this, o));
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
            await this.illust.onChanging.specValueKey(this, async () => {
                logger.debug(() => `Changing lineup key: ${this.info.key} -> ${v}`);
                this.info.key = v;
            });
        });
    }

    onChangeDeriv() {
        this.spec.item.onChangeSpecValue();
    }

    private refreshImage(clear = false): CachedImage {
        if (clear || _.isNil(this._image)) {
            this._image = this.illust.specValue(this);
        }
        return this._image;
    }

    get image(): SafeUrl {
        return this.refreshImage().url;
    }

    getDeriv(key: string): ItemSpecDeriv {
        return _.find(this.derives, (a) => _.isEqual(key, a.info.key));
    }

    async removeDeriv(o: ItemSpecDeriv): Promise<void> {
        await this.illust.onRemoving.deriv(o, async () => {
            _.remove(this.derives, (a) => _.isEqual(a.info.key, o.info.key));
            _.remove(this.info.derives, (a) => _.isEqual(a.key, o.info.key));
        });
    }

    createDeriv(): ItemSpecDeriv {
        const key = Observ.createNewKey("new_deriv", (key) => this.getDeriv(key));
        const one = new ItemSpecDeriv(this.illust, this, {
            name: "新しい派生",
            key: key,
            value: {
                initial: "",
                availables: []
            }
        });
        const initial = one.createNew();
        one.info.value.initial = initial.info.key;
        this.derives.unshift(one);
        this.info.derives.unshift(one.info);
        return one;
    }
}
