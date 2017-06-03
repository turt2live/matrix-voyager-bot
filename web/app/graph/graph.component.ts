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
    private isDragging = false;
    private isHovering = false;

    public isBrowserSupported = false;
    public highlightedNode: NetworkNode = null;

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

        try {
            let hasPath = (new Path2D()) !== undefined;
            console.log("Path support: " + hasPath); // this is to stop ts from yelling at us
            this.isBrowserSupported = hasPath;
        } catch (err) {
            this.isBrowserSupported = false;
            console.error(err);
            return;
        }

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

        let nodeTooltip = d3ParentElement.select<HTMLDivElement>("div.tooltip.node-tooltip");

        let canvasElement = d3ParentElement.select<HTMLCanvasElement>("canvas");
        let bbox = d3ParentElement.node().getBoundingClientRect();
        let width = bbox.width;
        let height = bbox.height;
        let ctx = canvasElement.node().getContext("2d");

        canvasElement.attr("width", width).attr("height", height);

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

        simulation.on('tick', () => this.onTick(ctx, this.data.links, this.data.nodes, width, height));
        simulation.force<ForceLink<NetworkNode, NetworkLink>>("link").links(this.data.links);

        let lastTransform = d3.zoomIdentity;

        canvasElement.call(d3.drag()
            .subject(() => this.findSubject(lastTransform))
            .on("start", () => {
                if (!d3.event.active) simulation.alphaTarget(0.3).restart();
                d3.event.subject.fx = d3.event.subject.x;
                d3.event.subject.fy = d3.event.subject.y;
                this.isDragging = true;
                this.isHovering = true;
            })
            .on("drag", () => {
                d3.event.subject.fx = lastTransform.invertX(d3.event.x);
                d3.event.subject.fy = lastTransform.invertY(d3.event.y);
                this.renderAll(ctx, lastTransform, width, height);
            })
            .on("end", () => {
                if (!d3.event.active) simulation.alphaTarget(0).restart();
                d3.event.subject.fx = null;
                d3.event.subject.fy = null;
                this.isDragging = false;
                this.isHovering = false;
            }));

        canvasElement.call(d3.zoom()
            .scaleExtent([-1, 10])
            .on('zoom', () => {
                lastTransform = d3.event.transform;
                this.renderAll(ctx, lastTransform, width, height);
            }));

        const self = this;
        canvasElement.on('mousemove', function () {
            const mouse = d3.mouse(this);
            const subject = self.findSubject(lastTransform, mouse[0], mouse[1]);
            if (!subject) {
                nodeTooltip.transition().duration(100).style('opacity', 0);
                self.isHovering = false;
                return;
            }

            self.highlightedNode = subject;
            self.isHovering = true;
            nodeTooltip.transition().duration(100).style("opacity", 0.9);
            nodeTooltip.style("left", d3.event.pageX + "px");
            nodeTooltip.style("top", d3.event.pageY + "px");
        });
    }

    private findSubject(lastTransform, sx = null, sy = null) {
        let d3 = this.d3;

        if (sx === null) sx = d3.event.x;
        if (sy === null) sy = d3.event.y;

        const x = lastTransform.invertX(sx);
        const y = lastTransform.invertY(sy);

        for (let node of <any[]>this.data.nodes) {
            let dx = x - node.x;
            let dy = y - node.y;
            let r = this.getNodeRadius(node);

            if (dx * dx + dy * dy < r * r) {
                node.x = lastTransform.applyX(node.x);
                node.y = lastTransform.applyY(node.y);
                return node;
            }
        }
    }

    private renderAll(ctx, transform, width, height) {
        console.log("render all");
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);
        this.render(ctx, this.data.nodes, this.data.links);
        ctx.restore();
    }

    private getNodeRadius(node) {
        return node.type === 'room' ? 15 : 8;
    }

    private onTick(ctx, links, nodes, width, height) {
        console.log("tick");
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        this.render(ctx, nodes, links);
        ctx.restore();
    }

    private render(ctx, nodes, links) {
        const fadedOpacity = 0.1;

        links.forEach(k => {
            if (this.isHovering) {
                ctx.globalAlpha = (k.target === this.highlightedNode || k.source === this.highlightedNode) ? 1 : fadedOpacity;
            } else ctx.globalAlpha = 1;

            ctx.beginPath();
            ctx.strokeStyle = this.getColorForType(k);

            let hasRelatedLinks = k.relatedLinkTypes && k.relatedLinkTypes.length > 1;
            if (!hasRelatedLinks && (k.inverseCount === 0 || k.value === 0)) {
                ctx.moveTo(k.source.x, k.source.y);
                ctx.lineTo(k.target.x, k.target.y);
                ctx.stroke();
            } else {
                let shouldInvert = hasRelatedLinks ? (k.relatedLinkTypes.indexOf(k.type) !== 0) : false;
                let sx = shouldInvert ? k.target.x : k.source.x;
                let sy = shouldInvert ? k.target.y : k.source.y;
                let tx = shouldInvert ? k.source.x : k.target.x;
                let ty = shouldInvert ? k.source.y : k.target.y;
                let dx = (k.target.x - k.source.x) / 0.1;
                let dy = (k.target.y - k.source.y) / 0.1;
                let dr = Math.sqrt((dx * dx) + (dy * dy));

                let path = new Path2D(<any>("M" + sx + "," + sy + "A" + dr + "," + dr + " 0 0,1 " + tx + "," + ty));
                // this.curveBetweenPoints(ctx, sx, sy, tx, ty, shouldInvert);
                ctx.stroke(path);
            }
        });

        nodes.forEach(n => {
            if (this.isHovering) {
                ctx.globalAlpha = this.isConnected(n, this.highlightedNode) ? 1 : fadedOpacity;
            } else ctx.globalAlpha = 1;

            const r = this.getNodeRadius(n);
            ctx.beginPath();
            ctx.moveTo(n.x + r, n.y);
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI, false);
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#fff";
            ctx.fillStyle = "#fff";
            ctx.stroke();
            ctx.fill();

            const seenNodes = this.localStorageService.get<number[]>('seenNodes') || [];
            if (n.avatarUrl && n.avatarUrl.trim().length > 0) {
                n.image = this.drawImageCircle(ctx, n.x, n.y, r, n.x - r, n.y - r, r * 2, r * 2, n.avatarUrl, n.image);
            } else {
                this.drawNodeAvatar(ctx, n.x, n.y, r, n);
            }

            let isNew = seenNodes.length > 0 && (seenNodes.indexOf(n.id) === -1);
            if (isNew && n.type === 'room') {
                this.drawNodeIsNew(ctx, n.x, n.y, r);
            }
        });
    }

    private drawNodeIsNew(ctx, x, y, r) {
        const numTriangles = 7;
        const distance = 0 + r;

        const baseDist = 3;
        const width = (Math.PI * (distance + baseDist)) / numTriangles;

        ctx.fillStyle = "#F90";
        ctx.setTransform(1, 0, 0, 1, x, y); // move center to where it should be.

        for (let i = 0; i < numTriangles; i++) {
            ctx.setTransform(1, 0, 0, 1, x, y);
            ctx.rotate((i / numTriangles) * Math.PI * 2);
            ctx.beginPath();
            ctx.moveTo(-width, distance + baseDist);
            ctx.lineTo(0, distance + 10);
            ctx.lineTo(width, distance + baseDist);
            ctx.fill();
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
    }

    private drawImageCircle(ctx, circleX, circleY, radius, imageX, imageY, imageWidth, imageHeight, imageUrl, existingImage) {
        if (existingImage) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(circleX, circleY, radius, 0, Math.PI * 2, true);
            ctx.clip();
            ctx.drawImage(existingImage, imageX, imageY, imageWidth, imageHeight);
            ctx.restore();
            return existingImage;
        }
        let img = new Image();
        img.onload = () => {
            this.drawImageCircle(ctx, circleX, circleY, radius, imageX, imageY, imageWidth, imageHeight, imageUrl, img);
        };
        img.src = imageUrl;
        return img;
    }

    private drawNodeAvatar(ctx, circleX, circleY, radius, node) {
        let text = node.name[0];
        if (text === '!' || text === '@' || text === '#')
            text = node.name[1];
        if (!text || node.isAnonymous) {
            text = node.type === 'room' ? "#" : "@";
        }

        text = text.toUpperCase(); // to match Riot

        ctx.beginPath();
        ctx.arc(circleX, circleY, radius, 0, Math.PI * 2, true);
        ctx.fillStyle = this.getBackgroundForString(node.name);
        ctx.fill();
        ctx.font = (node.type === 'room' ? 20 : 10) + 'pt Calibri';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(text, circleX, circleY + (node.type === 'room' ? 8 : 4));
    }

    private isConnected(node1: NetworkNode, node2: NetworkNode) {
        if (node1.id === node2.id) return true;

        const sourceToTarget = node1.id + "," + node2.id;
        const targetToSource = node2.id + "," + node1.id;

        return this.data.nodeLinks.indexOf(sourceToTarget) !== -1 || this.data.nodeLinks.indexOf(targetToSource) !== -1;
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
