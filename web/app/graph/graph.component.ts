import { Component, OnInit, ElementRef } from "@angular/core";
import { ApiService } from "../shared/api.service";
import { VoyagerNetwork } from "../shared/voyager-network";
import { D3Service, D3, Selection, ForceLink } from "d3-ng2-service";
import { NetworkLink, NetworkNode } from "./network-dto";
import { LocalStorageService } from "angular-2-local-storage";

@Component({
    selector: 'my-graph',
    templateUrl: './graph.component.html',
    styleUrls: ['./graph.component.scss']
})
export class GraphComponent implements OnInit {
    private d3: D3;
    private parentNativeElement: any;
    private data: {links: NetworkLink[], nodes: NetworkNode[], nodeLinks: string[]};

    // public highlightedNode: NetworkNode = null;
    // public highlightedLink: NetworkLink = null;
    // private isDragging = false;

    constructor(private api: ApiService,
                element: ElementRef,
                d3Service: D3Service,
                /*private modalService: NgbModal,*/
                private localStorageService: LocalStorageService) {
        this.d3 = d3Service.getD3();
        this.parentNativeElement = element.nativeElement;
    }

    ngOnInit() {
        let commonNetwork = <VoyagerNetworkHelper>{
            links: [],
            nodes: [],
            maxLinkTimestamp: 0,
            handledLinkIds: [],
            handledNodeIds: []
        };

        this.appendNetwork(0, commonNetwork);
    }

    private appendNetwork(since: number, resultsSoFar: VoyagerNetworkHelper) {
        this.api.getNetwork(since).subscribe(result => {
            let timestampChanged = false;

            for (let i = 0; i < result.results.links.length; i++) {
                let link = result.results.links[i];
                if (resultsSoFar.handledLinkIds.indexOf(link.id) !== -1) continue;

                if (link.timestamp > resultsSoFar.maxLinkTimestamp) {
                    resultsSoFar.maxLinkTimestamp = link.timestamp;
                    timestampChanged = true;
                }

                resultsSoFar.handledLinkIds.push(link.id);
                resultsSoFar.links.push(link);
            }
            for (let i = 0; i < result.results.nodes.length; i++) {
                let node = result.results.nodes[i];
                if (resultsSoFar.handledNodeIds.indexOf(node.id) !== -1) continue;

                resultsSoFar.handledNodeIds.push(node.id);
                resultsSoFar.nodes.push(node);
            }

            if (result.remaining > 0 && timestampChanged) {
                this.appendNetwork(resultsSoFar.maxLinkTimestamp, resultsSoFar);
            } else {
                this.processNetworkData(resultsSoFar);
            }
        }, error => alert(<any>error));
    }

    private processNetworkData(network: VoyagerNetwork) {
        let d3 = this.d3;
        let d3ParentElement: Selection<any, any, any, any>;

        if (this.parentNativeElement === null) {
            throw new Error("Failed to get native element");
        }

        d3ParentElement = d3.select(this.parentNativeElement);

        // let nodeTooltip = d3ParentElement.select<HTMLDivElement>("div.tooltip.node-tooltip");
        // let linkTooltip = d3ParentElement.select<HTMLDivElement>("div.tooltip.link-tooltip");

        let canvasElement = d3ParentElement.select<HTMLCanvasElement>("canvas");
        let bbox = d3ParentElement.node().getBoundingClientRect();
        let width = bbox.width;
        let height = bbox.height;
        let canvas = canvasElement.node().getContext("2d");

        canvasElement.attr("width", width).attr("height", height);

        canvasElement.call(d3.zoom()
            .scaleExtent([-1, 10])
            .on('zoom', () => {
                canvas.save();
                canvas.clearRect(0, 0, width, height);
                canvas.translate(d3.event.transform.x, d3.event.transform.y);
                canvas.scale(d3.event.transform.k, d3.event.transform.k);
                this.render(canvas, this.data.nodes, this.data.links);
                canvas.restore();
            }));

        this.processNetwork(network);

        this.localStorageService.set('seenNodes', this.data.nodes.map(n => n.id));

        let simulation = d3.forceSimulation(this.data.nodes)
            .force("link", d3.forceLink<NetworkNode, NetworkLink>()
                .id(n => <any>n.id)
                .distance(k => Math.sqrt(k.value) * 75))
            .force("charge", d3.forceManyBody<NetworkNode>()
                .strength(n => Math.max(-400, n.linkCount * -40)))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide<NetworkNode>(n => n.type === 'room' ? 20 : 15).strength(0.5));

        simulation.on('tick', () => this.onTick(canvas, this.data.links, this.data.nodes, width, height));
        simulation.force<ForceLink<NetworkNode, NetworkLink>>("link").links(this.data.links);

        // TODO: Dragging
        // ref: https://bl.ocks.org/mbostock/1b64ec067fcfc51e7471d944f51f1611
    }

    private onTick(canvas, links, nodes, width, height) {
        canvas.clearRect(0, 0, width, height);
        canvas.save();
        this.render(canvas, nodes, links);
        canvas.restore();
    }

    private render(canvas, nodes, links) {
        canvas.beginPath();
        links.forEach(k => {
            canvas.moveTo(k.source.x, k.source.y);
            canvas.lineTo(k.target.x, k.target.y);
        });
        canvas.strokeStyle = "#ccc";
        canvas.stroke();

        canvas.beginPath();
        nodes.forEach(n => {
            canvas.moveTo(n.x + 5, n.y);
            canvas.arc(n.x, n.y, 3, 0, 2 * Math.PI);
        });
        canvas.strokeStyle = "#f00";
        canvas.stroke();
    }

    // private fade(selfNode, opacity: number, nodes, links) {
    //     nodes.attr('stroke-opacity', n => this.isConnected(selfNode, n) ? 1 : opacity);
    //     nodes.attr('fill-opacity', n => this.isConnected(selfNode, n) ? 1 : opacity);
    //
    //     links.attr("stroke-opacity", k => (k.source === selfNode || k.target === selfNode ? 1 : opacity));
    // }

    // private isConnected(node1: NetworkNode, node2: NetworkNode) {
    //     if (node1.id === node2.id) return true;
    //
    //     const sourceToTarget = node1.id + "," + node2.id;
    //     const targetToSource = node2.id + "," + node1.id;
    //
    //     return this.data.nodeLinks.indexOf(sourceToTarget) !== -1 || this.data.nodeLinks.indexOf(targetToSource) !== -1;
    // }
    //
    // private buildFills(defs) {
    //     const seenNodes = this.localStorageService.get<number[]>('seenNodes') || [];
    //
    //     for (let node of this.data.nodes) {
    //         const fillKey = "fillFor" + node.id;
    //         const radius = node.type === 'room' ? 15 : 10;
    //
    //         let pattern = defs.append("pattern")
    //             .attr("id", fillKey)
    //             .attr("x", "0%").attr("y", "0%")
    //             .attr("width", "100%").attr("height", "100%")
    //             .attr("viewBox", "0 0 " + radius + " " + radius);
    //         pattern.append("rect")
    //             .attr("width", radius).attr("height", radius)
    //             .attr("fill", "#fff");
    //
    //         if (node.avatarUrl && node.avatarUrl.trim().length > 0) {
    //             pattern.append("image")
    //                 .attr("x", "0%").attr("y", "0%")
    //                 .attr("width", radius).attr("height", radius)
    //                 .attr("xlink:href", node.avatarUrl);
    //         } else {
    //             let text = node.name[0];
    //             if (text === '!' || text === '@' || text === '#')
    //                 text = node.name[1];
    //             if (!text || node.isAnonymous) {
    //                 text = node.type === 'room' ? "#" : "@";
    //             }
    //
    //             let size = node.type === 'room' ? 8 : 6;
    //
    //             pattern.append("rect")
    //                 .attr("width", radius).attr("height", radius)
    //                 .attr("fill", this.getBackgroundForString(node.name));
    //             pattern.append("text")
    //                 .attr("text-anchor", "middle")
    //                 .attr("dominant-baseline", "central")
    //                 .attr("alignment-baseline", "central")
    //                 .attr("x", radius / 2).attr("y", radius / 2)
    //                 .attr("font-family", "sans-serif")
    //                 .attr("font-size", size)
    //                 .attr("fill", "#fff")
    //                 .text(text);
    //         }
    //
    //         let isNew = seenNodes.length > 0 && (seenNodes.indexOf(node.id) === -1);
    //         if (!isNew || node.type === 'user') continue;
    //
    //         pattern.append("rect")
    //             .attr("width", radius * 2).attr("height", 12)
    //             .attr("fill", "#f9d35e")
    //             .attr("stroke", "#a0a0a0")
    //             .attr("stroke-width", "1px")
    //             .attr("transform", "translate(0) rotate(45 " + radius + " 6)");
    //         pattern.append("text")
    //             .attr("text-anchor", "middle")
    //             .attr("dominant-baseline", "central")
    //             .attr("alignment-baseline", "central")
    //             .attr("x", 11).attr("y", 9)
    //             .attr("transform", "rotate(45 " + radius + " 6)")
    //             .attr("font-family", "sans-serif")
    //             .attr("font-size", 4)
    //             .attr("fill", "#000")
    //             .text("NEW");
    //     }
    // }

    // private getBackgroundForString(str) {
    //     let hash = str.hashCode();
    //     if (hash < 0) hash = hash * -1;
    //
    //     const options = [
    //         "#ae71c6",
    //         "#71c6a8",
    //         "#a9c671",
    //         "#7189c6",
    //         "#c46fa8"
    //     ];
    //
    //     return options[hash % options.length];
    // }
    //
    // private getColorForType(pointOrType) {
    //     switch (pointOrType.type || pointOrType) {
    //         case "invite":
    //             return "#10b748";
    //         case "self_link":
    //             return "#694bcc";
    //         case "kick":
    //             return "#dd5e1a";
    //         case "ban":
    //             return "#ff2626";
    //         case "message":
    //         default:
    //             return "#999";
    //     }
    // }

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
                primaryAlias: networkNode.meta.primaryAlias,
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

class VoyagerNetworkHelper extends VoyagerNetwork {
    handledNodeIds: number[];
    handledLinkIds: number[];
    maxLinkTimestamp: number;
}
