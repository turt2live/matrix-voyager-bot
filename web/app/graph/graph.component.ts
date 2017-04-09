import { Component, OnInit, ElementRef } from "@angular/core";
import { ApiService } from "../shared/api.service";
import { VoyagerNetwork } from "../shared/voyager-network";
import { D3Service, D3, Selection, ForceLink, SimulationNodeDatum, SimulationLinkDatum } from "d3-ng2-service";

@Component({
    selector: 'my-graph',
    templateUrl: './graph.component.html',
    styleUrls: ['./graph.component.scss'],
})
export class GraphComponent implements OnInit {
    private d3: D3;
    private parentNativeElement: any;
    private data: {links: NetworkLink[], nodes: NetworkNode[], nodeLinks: string[]};

    public highlightedNode: NetworkNode = null;

    constructor(private api: ApiService, element: ElementRef, d3Service: D3Service) {
        this.d3 = d3Service.getD3();
        this.parentNativeElement = element.nativeElement;
    }

    ngOnInit() {
        let d3 = this.d3;
        let d3ParentElement: Selection<any, any, any, any>;

        this.api.getNetwork().subscribe(
            network => {
                if (this.parentNativeElement == null) {
                    throw new Error("Failed to get native element");
                }

                d3ParentElement = d3.select(this.parentNativeElement);

                let tooltip = d3ParentElement.select<HTMLDivElement>("div.tooltip");

                let svg = d3ParentElement.select<SVGSVGElement>("svg");
                let bbox = d3ParentElement.node().getBoundingClientRect();
                let width = bbox.width;
                let height = bbox.height;

                svg.attr("width", width).attr("height", height);

                svg.call(d3.zoom()
                    .scaleExtent([-1, 10])
                    .on('zoom', () => {
                        svg.select("g.links")
                            .attr("transform",
                                "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")" +
                                "scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
                        svg.select("g.nodes")
                            .attr("transform",
                                "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")" +
                                "scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
                    }));

                this.processNetwork(network);

                let defs = svg.select<SVGDefsElement>("defs");
                this.buildFills(defs);

                let simulation = d3.forceSimulation()
                    .force("link", d3.forceLink<NetworkNode, NetworkLink>()
                        .id(n => <any>n.id)
                        .distance(k => Math.sqrt(k.value) * 75))
                    .force("charge", d3.forceManyBody<NetworkNode>()
                        .strength(n => Math.max(-400, n.linkCount * -40)))
                    .force("center", d3.forceCenter(width / 2, height / 2))
                    .force("collide", d3.forceCollide<NetworkNode>(n => n.type == 'room' ? 20 : 15).strength(0.5));

                let links = svg.append("g")
                    .attr("class", "links")
                    .selectAll("path")
                    .data(this.data.links).enter().append("svg:path")
                    .attr("fill", "none")
                    .attr("stroke-width", k => Math.sqrt(k.value))
                    .attr("stroke", k => this.getColorForType(k.type))
                    .attr("stroke-opacity", 0.7);

                let nodes = svg.append("g")
                    .attr("class", "nodes")
                    .selectAll("circle")
                    .data(this.data.nodes).enter().append("circle")
                    .attr("fill", n => "url(#fillFor" + n.id + ")")
                    .attr("r", n => n.type == 'room' ? 15 : 10)
                    .attr("stroke", "#fff")
                    .attr("stroke-width", n => n.type == 'room' ? '1.5px' : '1px')
                    .call(d3.drag<SVGCircleElement, any>()
                        .on("start", d => {
                            if (!d3.event.active) simulation.alphaTarget(0.3).restart();
                            d.fx = d.x;
                            d.fy = d.y;
                        })
                        .on("drag", d => {
                            d.fx = d3.event.x;
                            d.fy = d3.event.y;
                        })
                        .on("end", d => {
                            if (!d3.event.active) simulation.alphaTarget(0);
                            d.fx = null;
                            d.fy = null;
                        }));

                nodes.on('mouseover', n => {
                    this.fade(n, 0.1, nodes, links);

                    this.highlightedNode = n;
                    tooltip.transition().duration(200).style("opacity", 0.9);
                    tooltip.style("left", d3.event.pageX + "px");
                    tooltip.style("top", d3.event.pageY + "px");
                });

                nodes.on('mouseout', n => {
                    this.fade(n, 1, nodes, links);

                    tooltip.transition().duration(500).style('opacity', 0);
                });

                simulation.nodes(this.data.nodes).on('tick', () => this.onTick(links, nodes));
                simulation.force<ForceLink<NetworkNode, NetworkLink>>("link").links(this.data.links);
            },
            error => alert(<any>error)
        );
    }

    private onTick(links, nodes) {
        nodes.attr("cx", d => d.x)
            .attr("cy", d => d.y);

        links.attr("d", d => {
            let dx = (d.target.x - d.source.x) / 0.1;
            let dy = (d.target.y - d.source.y) / 0.1;
            let dr = Math.sqrt((dx * dx) + (dy * dy));

            let hasRelatedLinks = d.relatedLinkTypes && d.relatedLinkTypes.length > 1;
            if (!hasRelatedLinks && (d.inverseCount == 0 || d.value == 0)) {
                return "M" + d.source.x + "," + d.source.y + " L" + d.target.x + "," + d.target.y;
            }

            let shouldInvert = hasRelatedLinks ? (d.relatedLinkTypes.indexOf(d.type) !== 0) : false;

            let sx = shouldInvert ? d.target.x : d.source.x;
            let sy = shouldInvert ? d.target.y : d.source.y;
            let tx = shouldInvert ? d.source.x : d.target.x;
            let ty = shouldInvert ? d.source.y : d.target.y;
            return "M" + sx + "," + sy + "A" + dr + "," + dr + " 0 0,1 " + tx + "," + ty;
        });
    }

    private fade(selfNode, opacity: number, nodes, links) {
        nodes.attr('stroke-opacity', n => this.isConnected(selfNode, n) ? 1 : opacity);
        nodes.attr('fill-opacity', n => this.isConnected(selfNode, n) ? 1 : opacity);

        links.attr("stroke-opacity", k => (k.source === selfNode || k.target === selfNode ? 1 : opacity));
    }

    private isConnected(node1: NetworkNode, node2: NetworkNode) {
        if (node1.id == node2.id) return true;

        const sourceToTarget = node1.id + "," + node2.id;
        const targetToSource = node2.id + "," + node1.id;

        return this.data.nodeLinks.indexOf(sourceToTarget) !== -1 || this.data.nodeLinks.indexOf(targetToSource) !== -1;
    }

    private buildFills(defs) {
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
                let text = node.name[0];
                if (text == '!' || text == '@' || text == '#')
                    text = node.name[1];
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

    private processNetwork(network: VoyagerNetwork) {
        const nodes = [];
        const links = [];
        const nodeIndexMap = {};
        const nodeLinksMap = [];

        for (let networkNode of network.nodes) {
            let node = {
                id: networkNode.id,
                name: networkNode.meta.displayName || networkNode.meta.objectId || 'Matrix ' + networkNode.meta.type,
                group: networkNode.meta.type,
                type: networkNode.meta.type,
                avatarUrl: networkNode.meta.avatarUrl,
                isAnonymous: networkNode.meta.isAnonymous,
                linkCount: 0,
                directLinks: []
            };
            nodeIndexMap[networkNode.id] = nodes.length;
            nodes.push(node);
        }

        let linkMap = {};
        let linkTypesMap = {};
        for (let networkLink of network.links) {
            const key = networkLink.meta.sourceNodeId + " to " + networkLink.meta.targetNodeId + " for " + networkLink.meta.type;
            const typeKey = networkLink.meta.sourceNodeId + " and " + networkLink.meta.targetNodeId;
            const inverseTypeKey = networkLink.meta.sourceNodeId + " and " + networkLink.meta.targetNodeId;

            let typeArray = linkTypesMap[typeKey] ? linkTypesMap[typeKey] : linkTypesMap[inverseTypeKey];
            if (!typeArray)
                typeArray = linkTypesMap[typeKey] = [];

            if (typeArray.indexOf(networkLink.meta.type) === -1)
                typeArray.push(networkLink.meta.type);

            if (!linkMap[key]) {
                linkMap[key] = {
                    count: 0,
                    sourceNodeId: networkLink.meta.sourceNodeId,
                    targetNodeId: networkLink.meta.targetNodeId,
                    type: networkLink.meta.type,
                    relatedLinkTypes: typeArray
                };
            }

            linkMap[key].count++;
        }

        for (let linkKey in linkMap) {
            const aggregateLink = linkMap[linkKey];
            const inverseLinkKey = aggregateLink.targetNodeId + " to " + aggregateLink.sourceNodeId + " for " + aggregateLink.type;
            const oppositeAggregateLink = linkMap[inverseLinkKey];

            let link = {
                sourceNode: nodeIndexMap[aggregateLink.sourceNodeId],
                targetNode: nodeIndexMap[aggregateLink.targetNodeId],
                source: aggregateLink.sourceNodeId,
                target: aggregateLink.targetNodeId,
                value: aggregateLink.count,
                type: aggregateLink.type,
                inverseCount: oppositeAggregateLink ? oppositeAggregateLink.count : 0,
                relatedLinkTypes: aggregateLink.relatedLinkTypes
            };
            links.push(link);

            let sourceNode = nodes[link.sourceNode];
            let targetNode = nodes[link.targetNode];

            sourceNode.linkCount++;
            targetNode.linkCount++;
            sourceNode.directLinks.push(link);
            targetNode.directLinks.push(link);

            if (nodeLinksMap.indexOf(sourceNode.id + "," + targetNode.id) === -1)
                nodeLinksMap.push(sourceNode.id + "," + targetNode.id);
            if (nodeLinksMap.indexOf(targetNode.id + "," + sourceNode.id) === -1)
                nodeLinksMap.push(targetNode.id + "," + sourceNode.id);
        }

        this.data = {links: links, nodes: nodes, nodeLinks: nodeLinksMap};
    }
}

class NetworkNode implements SimulationNodeDatum {
    id: number;
    name: string;
    group: string;
    type: string;
    avatarUrl: string;
    isAnonymous: boolean;
    linkCount: number;
    directLinks: NetworkLink[];
}

class NetworkLink implements SimulationLinkDatum<NetworkNode> {
    sourceNode: number;
    targetNode: number;
    source: NetworkNode;
    target: NetworkNode;
    value: number;
    type: string;
    inverseCount: number;
    relatedLinkTypes: string[];
}
