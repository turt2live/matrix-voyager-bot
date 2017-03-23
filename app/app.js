// Based on example from bl.ocks.org
// https://bl.ocks.org/mbostock/4062045

var container = $('.svg-wrap');
var width = container.width();
var height = container.height();

var svg = $(".svg-wrap > svg")
    .attr("width", '100%')
    .attr("height", '100%');

svg = d3.select(".svg-wrap > svg");
var defs = d3.select(".svg-wrap > svg > defs");

var simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(function (d) {
            return d.id;
        }))
        .force("charge", d3.forceManyBody().strength(-100))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide(function (d) {
            return d.type == "user" ? 24 : 44;
        }).strength(0.5))
    ;

var zoom = d3.zoom()
    .scaleExtent([-1, 10])
    .on('zoom', function () {
        svg.select("g.links").attr("transform", "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
        svg.select("g.nodes").attr("transform", "translate(" + d3.event.transform.x + "," + d3.event.transform.y + ")scale(" + d3.event.transform.k + "," + d3.event.transform.k + ")");
    });
svg.call(zoom);

var source = "api/v1/network"; // test.json
//source = "test2.json";
d3.json(source, function (error, graph) {
    if (error) throw error;

    var display = {};
    var images = {"count": 0};
    for (var key in graph.nodes) {
        var node = graph.nodes[key]; // can't use `for x of y` because IE
        display[node.id] = node.display || node.id;

        var imgSize = node.type == 'user' ? 24 : 44;
        var pattern = defs.append("pattern")
            .attr("id", "img" + images["count"])
            .attr("x", "0%")
            .attr("y", "0%")
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", "0 0 " + imgSize + " " + imgSize);
        pattern.append("rect")
            .attr("height", imgSize)
            .attr("width", imgSize)
            .attr("fill", "#fff");
        pattern.append("image")
            .attr("x", "0%")
            .attr("y", "0%")
            .attr("height", imgSize)
            .attr("width", imgSize)
            .attr("xlink:href", "api/v1/thumbnail/" + encodeURIComponent(node.type) + "/" + encodeURIComponent(display[node.id]));
        images[node.id] = "img" + images["count"];
        images["count"]++;
    }

    var link = svg.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(graph.links)
        .enter().append("line")
        .attr("stroke-width", function (d) {
            return Math.sqrt(d.value);
        })
        .attr("class", function (d) {
            return d.type;
        });

    var node = svg.append("g")
        .attr("class", "nodes")
        .selectAll("circle")
        .data(graph.nodes)
        .enter().append("circle")
        .attr("fill", function (d) {
            return "url(#" + images[d.id] + ")";
        })
        .attr("class", function (d) {
            return d.type;
        })
        .attr("r", function (d) {
            return d.type == "room" ? 22 : 12;
        })
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    node.append("title")
        .text(function (d) {
            return display[d.id];
        });

    link.append("title")
        .text(function (d) {
            return d.value + " " + d.type.replace(/_/g, ' ') + (d.value !== 1 ? "s" : "") + " from " + (display[d.source]);
        });

    simulation
        .nodes(graph.nodes)
        .on("tick", ticked);

    simulation.force("link")
        .links(graph.links);

    function ticked() {
        node
            .attr("cx", function (d) {
                return d.x = Math.max(imgSize, Math.min(width - imgSize, d.x));
            })
            .attr("cy", function (d) {
                return d.y = Math.max(imgSize, Math.min(height - imgSize, d.y));
            });

        link
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
});

function dragstarted(d) {
    if (!d3.event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
}

function dragended(d) {
    if (!d3.event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}