var container = $(".svg-wrap");
var width = container.width();
var height = container.height();
var displayNames = {}; // { nodeId: text }
var nodeTypes = {}; // { nodeId: type }
var nodeFills = {}; // { nodeId: id }
var nodesById = {}; // { nodeId: node }

var svg = $(".svg-wrap > svg")
    .attr('width', width)
    .attr('height', height);

svg = d3.select(".svg-wrap > svg");
var defs = d3.select(".svg-wrap > svg > defs");

var jsonSource = "api/v1/network";
//jsonSource = "test2.json";

var simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(getNodeId).distance(getLinkDistance))
    .force("charge", d3.forceManyBody().strength(getNodeStrength))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(getNodeCollisionRadius).strength(0.5));

var links, nodes;

d3.json(jsonSource, function (error, json) {
    if (error) throw error;

    explodeLinks(json);
    parseNodes(json);
    parseLinks(json);
    prepareFills(json);
    prepareMarkers(json);

    links = svg.append("g")
        .attr("class", "links")
        .selectAll("path")
        .data(json.links).enter().append("svg:path")
        .attr("fill", "none")
        .attr("stroke-width", getWidthForLink)
        .attr("stroke", getColorForType)
        .attr("stroke-opacity", 0.7)
        .attr("marker-end", getMarkerEndForLink);

    nodes = svg.append("g")
        .attr("class", "nodes")
        .selectAll("circle")
        .data(json.nodes).enter().append("circle")
        .attr("fill", getNodeFill)
        .attr("r", getNodeRadius)
        .attr("stroke", "#fff")
        .attr("stroke-width", getWidthForNode)
        .call(d3.drag()
            .on("start", onDragStarted)
            .on("drag", onDragged)
            .on("end", onDragEnded));

    nodes.append("title")
        .text(getNodeText);
    links.append("title")
        .text(getLinkText);

    simulation.nodes(json.nodes).on("tick", onTick);
    simulation.force("link").links(json.links);
});

var zoom = d3.zoom()
    .scaleExtent([-1, 10])
    .on('zoom', function () {
        svg.select("g.links").attr("transform", "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
        svg.select("g.nodes").attr("transform", "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
    });
svg.call(zoom);

function getNodeStrength(node) {
    return Math.max(-400, node.linkCount * -40);
}

function getNodeCollisionRadius(node) {
    return getNodeRadius(node) + 5;
}

function getMarkerEndForLink(link) {
    return "url(#arrow-" + link.type + "-" + nodeTypes[link.target] + ")";
}

function getNodeText(node) {
    return displayNames[node.id];
}

function getLinkText(link) {
    var type = link.type.replace(/_/g, ' ');
    return link.value + " " + type + (link.value !== 1 ? "s" : "") + " from " + displayNames[link.source] + " to " + displayNames[link.target];
}

function getLinkDistance(link) {
    return Math.sqrt(link.value) * 75;
}

function getNodeId(node) {
    return node.id;
}

function getWidthForNode(node) {
    return node.type == "user" ? "1px" : "1.5px";
}

function getNodeFill(node) {
    return "url(#" + nodeFills[node.id] + ")";
}

function getWidthForLink(link) {
    return Math.sqrt(link.value);
}

function getColorForType(pointOrType) {
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

function getNodeRadius(nodeOrType) {
    return (nodeOrType.type || nodeOrType) == "user" ? 10 : 15;
}

function prepareFills(json) {
    var nodeCount = 0;
    for (var key in json.nodes) {
        var node = json.nodes[key];

        displayNames[node.id] = node.display || node.id;

        var nodeSize = getNodeRadius(node);
        var pattern = defs.append("pattern")
            .attr("id", "img" + nodeCount)
            .attr("x", "0%").attr("y", "0%")
            .attr("width", "100%").attr("height", "100%")
            .attr("viewBox", "0 0 " + nodeSize + " " + nodeSize);
        pattern.append("rect")
            .attr("height", nodeSize).attr("width", nodeSize)
            .attr("fill", "#fff");
        pattern.append("image")
            .attr("x", "0%").attr("y", "0%")
            .attr("width", nodeSize).attr("height", nodeSize)
            .attr("xlink:href", "api/v1/thumbnail/" + encodeURIComponent(node.type) + "/" + encodeURIComponent(displayNames[node.id]));
        nodeFills[node.id] = "img" + nodeCount;
        nodeCount++;
    }
}

function prepareMarkers(json) {
    return; // TODO: Finish this code. Issue: #29

    var markerNodeTypes = ['user', 'room']; // don't need to detect this, we'll just hardcode it for now

    var foundTypes = [];
    for (var key in json.links) {
        var link = json.links[key];

        if (foundTypes.indexOf(link.type) == -1)
            foundTypes.push(link.type);
    }

    for (var i = 0; i < foundTypes.length; i++) {
        var linkType = foundTypes[i];

        // User and Rooms have different sizes, so we have to build the marker twice
        for (var j = 0; j < markerNodeTypes.length; j++) {
            var nodeType = markerNodeTypes[j];

            defs.append("marker")
                .attr("id", "arrow-" + linkType + "-" + nodeType)
                .attr("stroke", getColorForType(linkType))
                .attr("fill", "none")
                .attr("viewBox", "0 -5 10 10")
                .attr("refX", 20)
                .attr("refY", 0)
                .attr("markerUnits", "userSpaceOnUse")
                .attr("markerWidth", 8)
                .attr("markerHeight", 8)
                .attr("orient", "auto")
                .append("svg:path")
                .attr("d", "M0,-5L10,0L0,5");
        }
    }
}

function onDragStarted(d) {
    if (!d3.event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function onDragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
}

function onDragEnded(d) {
    if (!d3.event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function onTick() {
    nodes
        .attr("cx", function (d) {
            return d.x;
        })
        .attr("cy", function (d) {
            return d.y;
        });

    links.attr("d", function (d) {
        var dx = d.target.x - d.source.x;
        var dy = d.target.y - d.source.y;
        var dr = Math.sqrt((dx * dx) + (dy * dy));
        var hasRelatedLinks = d.relatedTypes && d.relatedTypes.length > 1;
        if (!hasRelatedLinks && (d.sourceToTarget == 0 || d.targetToSource == 0)) {
            return "M" + d.source.x + "," + d.source.y + " L" + d.target.x + "," + d.target.y;
        }

        var shouldInvert = hasRelatedLinks ? (d.relatedTypes.indexOf(d.type) !== 0) : false;

        var sx = shouldInvert ? d.target.x : d.source.x;
        var sy = shouldInvert ? d.target.y : d.source.y;
        var tx = shouldInvert ? d.source.x : d.target.x;
        var ty = shouldInvert ? d.source.y : d.target.y;
        return "M" + sx + "," + sy + "A" + dr + "," + dr + " 0 0,1 " + tx + "," + ty;
    });
}

function explodeLinks(json) {
    var newLinks = [];

    for (var key in json.links) {
        var link = json.links[key];

        // Special case: Expand user links into multiple links
        if (link.type == "user_link") {
            var otherLinkTypes = [];

            for (var subtype in link.subtypes) {
                otherLinkTypes.push(subtype);

                var subLink = {
                    source: link.source,
                    target: link.target,
                    sourceToTarget: link.subtypes[subtype],
                    targetToSource: 0,
                    value: link.subtypes[subtype],
                    type: subtype,
                    relatedTypes: otherLinkTypes // pass by reference
                };
                newLinks.push(subLink);
            }

            continue;
        }

        if (link.source == link.target) continue; // Filter out self-links for now

        var c1 = JSON.parse(JSON.stringify(link));
        var c2 = JSON.parse(JSON.stringify(link));

        if (link.sourceToTarget != 0) {
            c1.value = link.sourceToTarget;
            newLinks.push(c1);
        }

        if (link.targetToSource != 0) {
            c2.value = link.targetToSource;
            c2.target = link.source;
            c2.source = link.target;
            newLinks.push(c2);
        }
    }

    json.links = newLinks;
}

function parseNodes(json) {
    for (var key in json.nodes) {
        var node = json.nodes[key];

        nodeTypes[node.id] = node.type;
        nodesById[node.id] = node;
    }
}

function parseLinks(json) {
    for (var key in json.links) {
        var link = json.links[key];

        nodesById[link.target].linkCount = (nodesById[link.target].linkCount + 1) || 1;
        nodesById[link.source].linkCount = (nodesById[link.source].linkCount + 1) || 1;
    }
}