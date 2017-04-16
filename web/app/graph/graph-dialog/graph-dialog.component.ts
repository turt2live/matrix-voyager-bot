import { Component, Input } from "@angular/core";
import { NgbActiveModal } from "@ng-bootstrap/ng-bootstrap";
import { NetworkNode } from "../network-dto";

@Component({
    selector: 'my-graph-dialog',
    templateUrl: './graph-dialog.component.html',
    styleUrls: ['./graph-dialog.component.scss'],
})
export class GraphDialogComponent {

    @Input() node: NetworkNode;

    constructor(public activeModal: NgbActiveModal) {
    }
}
