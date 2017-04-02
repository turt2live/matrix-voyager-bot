import { Component, OnInit } from "@angular/core";
import { ApiService } from "../shared/api.service";
import { VoyagerNetwork } from "../shared/voyager-network";

declare let nv, d3: any;

@Component({
    selector: 'my-graph',
    templateUrl: './graph.component.html',
    styleUrls: ['./graph.component.scss'],
})
export class GraphComponent implements OnInit {
    options; // set in ngOnInit
    data = {nodes: [], links: []};
    errorMessage = null;

    private callbackHandled = false;

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
                linkDist: (link) => Math.sqrt(link.value) * 75,
                charge: (node) => Math.max(-400, node.linkCount * -40),
                radius: (node) => node.type == 'room' ? 15 : 10,
                nodeExtras: function (node) {
                    if (!node) return;
                    // node
                    //     .append("text")
                    //     .attr("dx", 16)
                    //     .attr("dy", ".35em")
                    //     .text(function (d) {
                    //         return d.name;
                    //     })
                    //     .style("font-size", "10px");
                    node.selectAll("circle")
                        .style("fill", n => "url(#fillFor" + n.id + ")")
                        .style("stroke", "#fff")
                        .style("stroke-width", n => n.type == 'user' ? '1.5px' : "2px");
                },
                linkExtras: (link) => {
                    if (!link) return;
                    link.style("stroke", this.getColorForType);
                },
                callback: (graph) => {
                    if (this.callbackHandled) return;
                    this.callbackHandled = true;

                    graph.tooltip.enabled(false);
                    let svg = d3.select("svg");
                    let defs = svg.append("defs");

                    for (let node of this.data.nodes) {
                        const fillKey = "fillFor" + node.id;
                        const radius = node.type == 'room' ? 15 : 10;

                        let pattern = defs.append("pattern")
                            .attr("id", fillKey)
                            .attr("x", "0%").attr("y", "0%")
                            .attr("width", "100%").attr("height", "100%")
                            .attr("viewBox", "0 0 " + radius + " " + radius);
                        pattern.append("rect")
                            .attr("width", radius).attr("height", radius)
                            .attr("fill", "#fff");

                        if (node.avatarUrl && node.avatarUrl.trim().length > 0) {
                            pattern.append("image")
                                .attr("x", "0%").attr("y", "0%")
                                .attr("width", radius).attr("height", radius)
                                .attr("xlink:href", node.avatarUrl);
                        } else {
                            let text = node.name[1];
                            if (!text || node.isAnonymous) {
                                text = node.type == 'room' ? "#" : "@";
                            }

                            let size = node.type == 'room' ? 8 : 6;

                            pattern.append("rect")
                                .attr("width", radius).attr("height", radius)
                                .attr("fill", this.getBackgroundForString(node.name));
                            pattern.append("text")
                                .attr("text-anchor", "middle")
                                .attr("dominant-baseline", "central")
                                .attr("alignment-baseline", "central")
                                .attr("x", radius / 2).attr("y", radius / 2)
                                .attr("font-family", "sans-serif")
                                .attr("font-size", size)
                                .attr("fill", "#fff")
                                .text(text);
                        }
                    }
                }
            }
        };

        this.data = {nodes: [], links: []};

        this.api.getNetwork().subscribe(
            network => this.processNetwork(network),
            error => this.errorMessage = <any>error
        );
    }

    private getBackgroundForString(str) {
        let hash = str.hashCode();
        if (hash < 0) hash = hash * -1;

        const options = [
            "#ae71c6",
            "#71c6a8",
            "#a9c671",
            "#7189c6",
            "#c46fa8"
        ];

        return options[hash % options.length];
    }

    private getColorForType(pointOrType) {
        switch (pointOrType.type || pointOrType) {
            case "invite":
                return "#10b748";
            case "self_link":
                return "#694bcc";
            case "kick":
                return "#dd5e1a";
            case "ban":
                return "#ff2626";
            case "message":
            default:
                return "#999";
        }
    }

    private  processNetwork(network: VoyagerNetwork) {
        const nodes = [];
        const links = [];
        const nodeIndexMap = {};

        for (let networkNode of network.nodes) {
            let node = {
                id: networkNode.id,
                name: networkNode.meta.displayName || networkNode.meta.objectId || 'Matrix ' + networkNode.meta.type,
                group: networkNode.meta.type,
                type: networkNode.meta.type,
                avatarUrl: networkNode.meta.avatarUrl,
                isAnonymous: networkNode.meta.isAnonymous,
                linkCount: 0
            };
            nodeIndexMap[networkNode.id] = nodes.length;
            nodes.push(node);
        }

        let linkMap = {};
        for (let networkLink of network.links) {
            const key = networkLink.meta.sourceNodeId + " to " + networkLink.meta.targetNodeId + " for " + networkLink.meta.type;
            if (!linkMap[key]) {
                linkMap[key] = {
                    count: 0,
                    sourceNodeId: networkLink.meta.sourceNodeId,
                    targetNodeId: networkLink.meta.targetNodeId,
                    type: networkLink.meta.type
                };
            }

            linkMap[key].count++;
        }

        for (let linkKey in linkMap) {
            const aggregateLink = linkMap[linkKey];
            let link = {
                source: nodeIndexMap[aggregateLink.sourceNodeId],
                target: nodeIndexMap[aggregateLink.targetNodeId],
                value: aggregateLink.count,
                type: aggregateLink.type
            };
            links.push(link);

            nodes[link.source].linkCount++;
            nodes[link.target].linkCount++;
        }

        this.data = {links: links, nodes: nodes};
    }
}
