import {Component} from "@angular/core";
import {SafeUrl} from '@angular/platform-browser';
import {NavController, NavParams} from "ionic-angular";

import {DerivPage} from "./deriv";
import {Prompt} from "../../providers/util_prompt";
import {Spec} from "../../providers/model/lineup/spec";
import {DerivGroup} from "../../providers/model/lineup/deriv";
import {Logger} from "../../util/logging";

const logger = new Logger("SpecPage");

@Component({
    templateUrl: 'build/pages/lineup/spec.html'
})
export class SpecPage {
    spec: Spec;

    constructor(private nav: NavController, private prompt: Prompt, params: NavParams) {
        this.spec = params.get("spec");
    }

    get title(): string {
        return this.spec.info.name;
    }

    get isReady(): boolean {
        return !_.isNil(this.title);
    }

    async delete(): Promise<void> {
        if (await this.prompt.confirm(`"${this.title}"を削除します`)) {
            await this.spec.specGroup.remove(this.spec);
            this.nav.pop();
        }
    }

    open(v: DerivGroup) {
        this.nav.push(DerivPage, {
            derivGroup: v
        });
    }

    addNew() {
        this.open(this.spec.createDeriv());
    }
}
