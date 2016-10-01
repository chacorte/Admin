import {Component} from "@angular/core";
import {SafeUrl} from '@angular/platform-browser';
import {NavController, NavParams} from "ionic-angular";

import {SpecPage} from "./spec";
import * as Lineup from "../../providers/model/lineup";
import {Logger} from "../../util/logging";

const logger = new Logger("ItemPage");

@Component({
    templateUrl: 'build/pages/lineup/item.html'
})
export class ItemPage {
    title: string;
    item: Lineup.Item;

    constructor(private nav: NavController, params: NavParams) {
        this.item = params.get("item");
        this.title = this.item.name;
    }

    get isReady(): boolean {
        return !_.isNil(this.title);
    }

    open(spec: Lineup.ItemSpec) {
        this.nav.push(SpecPage, {
            spec: spec
        });
    }
}
