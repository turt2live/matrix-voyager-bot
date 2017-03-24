var container = $(".svg-wrap");
var width = container.width();
var height = container.height();
var displayNames = {}; // { nodeId: text }
var nodeFills = {}; // { nodeId: id }

var svg = $(".svg-wrap > svg")
    .attr('width', width)
    .attr('height', height);

svg = d3.select(".svg-wrap > svg");
var defs = d3.select(".svg-wrap > svg > defs");

var jsonSource = "api/v1/network";
//jsonSource = "test2.json";

var simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(getNodeId).distance(getLinkDistance))
    .force("charge", d3.forceManyBody())
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(function (d) {
        return getNodeRadius(d);
    }));

d3.json(jsonSource, function (error, json) {
    if (error) throw error;

    prepareFills(json);

    var links = svg.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(json.links).enter().append("line")
        .attr("stroke-width", getWidthForLink)
        .attr("stroke", getColorForType);

    var nodes = svg.append("g")
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

    function onTick() {
        checkNodeDistance(nodes, links);
    }
});

var zoom = d3.zoom()
    .scaleExtent([-1, 10])
    .on('zoom', function () {
        svg.select("g.links").attr("transform", "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
        svg.select("g.nodes").attr("transform", "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
    });
svg.call(zoom);

function getNodeText(node) {
    return displayNames[node.id];
}

function getLinkText(link) {
    var type = link.type.replace(/_/g, ' ');
    return "" +
        link.sourceToTarget + " " + type + (link.sourceToTarget == 1 ? "" : "s") + " to " + displayNames[link.target] + "\n" +
        link.targetToSource + " " + type + (link.targetToSource == 1 ? "" : "s") + " to " + displayNames[link.source];
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

function getColorForType(point) {
    switch (point.type) {
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

function getNodeRadius(node) {
    return node.type == "user" ? 10 : 14;
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

function checkNodeDistance(nodes, links) {
    nodes
        .attr("cx", function (d) {
            return d.x = Math.max(getNodeRadius(d), Math.min(width - getNodeRadius(d), d.x));
        })
        .attr("cy", function (d) {
            return d.y = Math.max(getNodeRadius(d), Math.min(height - getNodeRadius(d), d.y));
        });

    links
        .attr("x1", function (d) {
            return d.source.x;
        })
        .attr("y1", function (d) {
            return d.source.y;
        })
        .attr("x2", function (d) {
            return d.target.x;
        })
        .attr("y2", function (d) {
            return d.target.y;
        });
}