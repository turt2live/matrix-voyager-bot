<template>
    <div class="graph">
        <div v-if="isLoading">
            <h1>Loading...</h1>
        </div>
        <div v-if="!isLoading && error">
            <h1>{{ error }}</h1>
        </div>
        <div v-if="!isLoading && !error">
            <svg xmlns="http://www.w3.org/2000/svg"
                 :width="width+'px'"
                 :height="height+'px'">
                <line v-for="link in graph.links"
                :x1="link.source.x"
                :y1="link.source.y"
                :x2="link.target.x"
                :y2="link.target.y"
                stroke="black" stroke-width="2" />
                <circle v-for="node in graph.nodes"
                        :cx="node.x"
                        :cy="node.y"
                        r="20" fill='red' stroke='white' stroke-width='2' />
            </svg>
        </div>
    </div>
</template>

<script>
var d3 = require("d3");
export default {
  name: 'graph',
  data () {
    return {
      isLoading: true,
      error: null,
      graph: null,
      width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
      height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0) - 40
    };
  },
  mounted () {
      return this.$http.get("/api/v1/network", {since: 0, limit: 100000}).then(response => {
        this.graph = this.processNetwork(response.body.results);
        this.genGraph();
        this.isLoading = false;
      }).catch(error => {
        this.error = "There was a problem loading the graph data. Please try again later.";
        this.isLoading = false;
        console.error(error);
      });
  },
  methods: {
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

</script>

<style scoped>
</style>