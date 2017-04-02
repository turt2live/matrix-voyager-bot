import { Component, OnInit } from "@angular/core";
import { ApiService } from "../shared/api.service";
import { VoyagerNetwork } from "../shared/voyager-network";

declare let nv: any;

@Component({
    selector: 'my-graph',
    templateUrl: './graph.component.html',
    styleUrls: ['./graph.component.scss'],
})
export class GraphComponent implements OnInit {
    options; // set in ngOnInit
    data = {nodes: [], links: []};
    errorMessage = null;

    constructor(private api: ApiService) {
    }

    ngOnInit() {
        this.options = {
            chart: {
                type: 'forceDirectedGraph',
                height: (function () {
                    return nv.utils.windowSize().height;
                })(),
                width: (function () {
                    return nv.utils.windowSize().width;
                })(),
                color: function () {
                    return "red";
                },
                nodeExtras: function (node) {
                    if (!node) return;
                    node
                        .append("text")
                        .attr("dx", 8)
                        .attr("dy", ".35em")
                        .text(function (d) {
                            return d.name;
                        })
                        .style("font-size", "10px");
                }
            }
        };

        this.data = {nodes: [], links: []};

        this.api.getNetwork().subscribe(
            network => this.processNetwork(network),
            error => this.errorMessage = <any>error
        );
    }

    private  processNetwork(network: VoyagerNetwork) {
        const nodes = [];
        const links = [];
        const nodeIndexMap = {};

        for (let networkNode of network.nodes) {
            let node = {
                name: networkNode.meta.displayName || networkNode.meta.objectId || 'Matrix ' + networkNode.meta.type,
                group: networkNode.meta.type
            };
            nodeIndexMap[networkNode.id] = nodes.length;
            nodes.push(node);
        }

        let linkMap = {};
        for (let networkLink of network.links) {
            const key = networkLink.meta.sourceNodeId + " to " + networkLink.meta.targetNodeId;
            if (!linkMap[key]) {
                linkMap[key] = {
                    count: 0,
                    sourceNodeId: networkLink.meta.sourceNodeId,
                    targetNodeId: networkLink.meta.targetNodeId
                };
            }

            linkMap[key].count++;
        }

        for (let linkKey in linkMap) {
            const aggregateLink = linkMap[linkKey];
            links.push({
                source: nodeIndexMap[aggregateLink.sourceNodeId],
                target: nodeIndexMap[aggregateLink.targetNodeId],
                value: aggregateLink.count
            });
        }

        this.data = {links: links, nodes: nodes};
    }
}
