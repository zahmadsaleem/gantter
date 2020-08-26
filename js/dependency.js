document.addEventListener("dataloaded", dgraph);

function dgraph() {
    const width = 800;
    const height = 2000;

    const svg1 = d3.select("body")
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("class", "svg")
        .attr("overflow", "scroll");

    let colors = {"FF":"red","FS":"yellow","SS":"blue"}
    const links = connections.map(d => { return { source: d[0], target: d[1] , type: d[2]?d[2]:"FS" } });
    const nodes = data.map(d => d);
    console.log(links);

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.ID))
        .force("charge", d3.forceManyBody())
        .force("center", d3.forceCenter(width / 2, height / 2));

    let drag = simulation => {

        function dragstarted(d) {
            if (!d3.event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
            console.log(d.TaskName);
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

        return d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended);
    }

    const link = svg1.append("g")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke", d => colors[d.type])
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.6);

    const node = svg1.append("g")
        .attr("stroke", "#333")
        .attr("stroke-width", 1.5)
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => Math.sqrt(d.Duration))
        .call(drag(simulation));

    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);


    });
}