var d3 = require("d3");
export default {
    name: 'graph',
    data () {
        return {
            isLoading: true,
            error: null,
            graph: null,
            nodeHover: {x: 0, y: 0, item: null, is: false},
            linkHover: {x: 0, y: 0, item: null, is: false},
            transformStr: "",
            width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
            height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0) - 4,

            hasBoundZoom: false
        };
    },
    mounted () {
        return this.$http.get("/api/v1/network", {since: 0, limit: 100000}).then(response => {
            this.graph = this.processNetwork(response.body.results);
            this.genGraph();
            this.stylize();
            this.isLoading = false;
        }).catch(error => {
            this.error = "There was a problem loading the graph data. Please try again later.";
            this.isLoading = false;
            console.error(error);
        });
    },
    updated () {
        if (this.hasBoundZoom) {
            return;
        }

        this.hasBoundZoom = true;
        d3.select("#graphsvg").call(d3.zoom()
            .scaleExtent([-1, 10])
            .on('zoom', () => {
                this.transformStr = "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")"
                    + "scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")";
            }));
    },
    methods: {
        enterItem (item, state, event) {
            state.x = event.clientX;
            state.y = event.clientY;
            state.item = item;
            state.is = true;
        },
        exitItem (state) {
            state.is = false;
        },
        getLinkText (link) {
            if (!link) {
                return "";
            }

            return link.value + ' ' + link.type.replace(/_ /g, ' ') + (link.value !== 1 ? 's' : '') + ' from ' + link.source.name + ' to ' + link.target.name;
        },
        getFillForText (text) {
            let hash = text.hashCode();
            if (hash < 0) hash = hash * -1;

            const options = [
                "#ae71c6",
                "#71c6a8",
                "#a9c671",
                "#7189c6",
                "#c46fa8"
            ];

            return options[hash % options.length];
        },
        getLinkParams (link) {
            var dx = (link.target.x - link.source.x) / 0.1;
            var dy = (link.target.y - link.source.y) / 0.1;
            var dr = Math.sqrt((dx * dx) + (dy * dy));

            var hasRelatedLinks = link.relatedLinkTypes && link.relatedLinkTypes.length > 1;
            if (!hasRelatedLinks && (link.inverseCount === 0 || link.value === 0)) {
                return "M" + link.source.x + "," + link.source.y + " L" + link.target.x + "," + link.target.y;
            }

            var shouldInvert = hasRelatedLinks ? (link.relatedLinkTypes.indexOf(link.type) !== 0) : false;
            var sx = shouldInvert ? link.target.x : link.source.x;
            var sy = shouldInvert ? link.target.y : link.source.y;
            var tx = shouldInvert ? link.source.x : link.target.x;
            var ty = shouldInvert ? link.source.y : link.target.y;

            return "M" + sx + "," + sy + "A" + dr + "," + dr + " 0 0,1 " + tx + "," + ty;
        },
        downloadSvg () {
            var svgData = document.getElementById("graphsvg").outerHTML;
            var svgBlob = new Blob([svgData], {type: "image/svg+xml;charset=utf-8"});
            var svgUrl = URL.createObjectURL(svgBlob);
            var downloadLink = document.createElement("a");
            downloadLink.href = svgUrl;
            downloadLink.download = "voyager.svg";
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        },
        genGraph () {
            this.simulation = d3.forceSimulation(this.graph.nodes)
                .force("link", d3.forceLink(this.graph.links).id(n => n.id).distance(k => Math.sqrt(k.value) * 75))
                .force("charge", d3.forceManyBody().strength(n => Math.max(-400, n.linkCount * -40)))
                .force("center", d3.forceCenter(this.width / 2, this.height / 2))
                .force("collide", d3.forceCollide(i => i.type === 'room' ? 20 : 15).strength(0.5));
            this.simulation.force("link").links(this.graph.links);
            this.simulation.stop();

            for (let i = 0, n = Math.ceil(Math.log(this.simulation.alphaMin()) / Math.log(1 - this.simulation.alphaDecay())); i < n; ++i) {
                this.simulation.tick();
            }
        },
        stylize () {
            for (var node of this.graph.nodes) {
                node.r = node.type === "room" ? 15 : 8;
            }

            for (var link of this.graph.links) {
                switch (link.type) {
                    case "invite":
                        link.stroke = "#10b748";
                        continue;
                    case "self_link":
                        link.stroke = "#694bcc";
                        continue;
                    case "kick":
                        link.stroke = "#dd5e1a";
                        continue;
                    case "ban":
                        link.stroke = "#ff2626";
                        continue;
                    case "message":
                    default:
                        link.stroke = "#999";
                }
            }
        },
        processNetwork (network) {
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
                if (!typeArray) {
                    typeArray = linkTypesMap[typeKey] = [];
                }

                if (typeArray.indexOf(networkLink.meta.type) === -1) {
                    typeArray.push(networkLink.meta.type);
                }

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

                if (nodeLinksMap.indexOf(sourceNode.id + "," + targetNode.id) === -1) {
                    nodeLinksMap.push(sourceNode.id + "," + targetNode.id);
                }
                if (nodeLinksMap.indexOf(targetNode.id + "," + sourceNode.id) === -1) {
                    nodeLinksMap.push(targetNode.id + "," + sourceNode.id);
                }
            }

            return {links, nodes, nodeLinks: nodeLinksMap};
        }
    }
};
