import {Component} from "@angular/core";
import {SafeUrl} from '@angular/platform-browser';
import {NavController, NavParams} from "ionic-angular";

import {SpecPage} from "./spec";
import {Prompt} from "../../providers/util_prompt";

import {LineupController, LineupValue} from "../../providers/model/lineup/lineup";
import {ItemSpec} from "../../providers/model/lineup/spec";
import {Logger} from "../../util/logging";

const logger = new Logger("ItemPage");

@Component({
    templateUrl: 'build/pages/lineup/item.html'
})
export class ItemPage {
    item: LineupValue;

    constructor(private nav: NavController, private prompt: Prompt, params: NavParams, private lineupCtrl: LineupController) {
        this.item = params.get("item");
    }

    get title(): string {
        return this.item.info.name;
    }

    get isReady(): boolean {
        return !_.isNil(this.title);
    }

    async uploadImage() {
        try {
            const file = await this.prompt.file("Title Image", "PNG file");
            if (!_.isNil(file)) {
                await this.item.changeImage(file);
            }
        } catch (ex) {
            logger.warn(() => `Failed to load image: ${ex}`);
        }
    }

    async delete(): Promise<void> {
        if (await this.prompt.confirm(`"${this.title}"を削除します`)) {
            const lineup = await this.lineupCtrl.lineup;
            await lineup.remove(this.item);
            this.nav.pop();
        }
    }

    open(spec: ItemSpec) {
        this.nav.push(SpecPage, {
            spec: spec
        });
    }

    addNew() {
        this.open(this.item.createSpec());
    }
}
