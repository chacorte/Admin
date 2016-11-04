import _ from "lodash";

import { Component, Input, Output, EventEmitter } from "@angular/core";

import Info from "../../providers/model/lineup/_info.d";
import { EditableMap } from "../../providers/util/editable_map";
import { Logger } from "../../providers/util/logging";

const logger = new Logger("CategoryComponent");

@Component({
    selector: "fathens-category",
    templateUrl: 'category.html'
})
export class CategoryComponent {
    @Input() category: Info.Category;
    @Input() key: string;
    @Output() keyChange: EventEmitter<string> = new EventEmitter();

    private _flags: EditableMap<string>;
    get flags(): EditableMap<string> {
        if (_.isNil(this._flags)) {
            this._flags = new EditableMap<string>(this.category.flags, () => "new_value");
            logger.debug(() => `flags are decoded.`);
        }
        return this._flags;
    }
}
