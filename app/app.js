// Based on example from bl.ocks.org
// https://bl.ocks.org/mbostock/4062045

var container = $('.svg-wrap');
var width = container.width();
var height = container.height();

var svg = $(".svg-wrap > svg")
    .attr("width", '100%')
    .attr("height", '100%');

svg = d3.select(".svg-wrap > svg");

var simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(function (d) {
        return d.id;
    }))
    .force("charge", d3.forceManyBody())
    .force("center", d3.forceCenter(width / 2, height / 2));

var source = "api/v1/network"; // test.json
d3.json(source, function (error, graph) {
    if (error) throw error;

    var display = {};
    for (var node of graph.nodes) {
        display[node.id] = node.display || node.id;
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
        .attr("r", 5)
        .attr("class", function (d) {
            return d.type;
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
            return d.value + " " + d.type + (d.value !== 1 ? "s" : "") + " from " + (display[d.source]);
        });

    simulation
        .nodes(graph.nodes)
        .on("tick", ticked);

    simulation.force("link")
        .links(graph.links)
        .distance(45);

    function ticked() {
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

        node
            .attr("cx", function (d) {
                return d.x;
            })
            .attr("cy", function (d) {
                return d.y;
            });
    }
});
}

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