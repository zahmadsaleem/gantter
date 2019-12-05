var w = 800;
var h = 5000;
var taskht = 20;

var svg = d3.select("body")
    .append("svg")
    .attr("width", w)
    .attr("height", h)
    .attr("class", "svg")
    .attr("overflow", "scroll");

var data;
var group;
var gantt;
var tree;
var hierarchy;
var connections = [];
var queue = [];

function removeSelection() {
    document.querySelectorAll("path.selected").forEach(function (el) {
        d3.select(el).attr("class", "line");
    })
    document.querySelectorAll("rect.selected").forEach(function (el) {
        d3.select(el).attr("class", "task-rect");
    })
}

document.querySelector("body").addEventListener("click", removeSelection)

function getTaskByID(id) {
    let task = data.filter((d) => d.ID == id);
    return task ? task[0] : undefined;
}


// process data
d3.json("./schedule.json")
    .then((d) => {
        // remove spaces from json keys
        data = JSON.parse(
            JSON.stringify(d)
                .replace(/(?!")(\w|\s)+(?=":)/g, (match) => match.replace(/\s/g, ""))
        );
        data.forEach((item, index, arr) => {
            // convert raw data types
            let _dur = item.Duration.match(/^\d+/g);
            item.Duration = _dur ? +_dur[0] : 1;
            item.Finish = Date.parse(item.Finish);
            item.Start = Date.parse(item.Start);

            // process dependencies
            var preArray = [];
            var _preArray = item.Predecessors.split(";");
            _preArray.forEach((link) => {
                var preObject = {};
                const rePre = /^\d+/g;
                const reType = /SS|FS|FF|SF/g;
                const reSign = /\+|-/g;
                const reAdd = /\d+(?=\sday)/g;

                // eg : "119FS+50 days"
                var _pre = rePre.exec(link);
                if (_pre) {
                    preObject.pre = _pre[0];
                    var _type = reType.exec(link);
                    _type ? preObject.type = _type[0] : preObject.type = undefined;
                    _sign = reSign.exec(link);
                    if (_sign) {
                        preObject.addition = eval(_sign[0] + reAdd.exec(link)[0]);
                    } else {
                        preObject.addition = 0;
                    }
                    connections.push([item, getTaskByID(_pre[0]), _type ? _type[0] : undefined]);
                } else {
                    preObject.pre = undefined;
                    preObject.type = undefined;
                    preObject.addition = 0;
                }
                preArray.push(preObject);
            });
            item.preArray = preArray;

            // convert indent to parent<>child list
            let _s = item.TaskName.match(/^\s+\w/g);
            _s ? item.indent = _s[0].search(/\S/g) / 4 : item.indent = 0;
            item.TaskName = item.TaskName.trim()
            item.children = [];
            var _parent;
            if (index > 0) {
                if (item.indent > arr[index - 1].indent) {
                    _parent = arr[index - 1].parents.concat(arr[index - 1].ID);
                    item.parents = _parent;
                } else {
                    _parent = arr[index - 1].parents.slice(0, item.indent);
                    item.parents = _parent;
                }
                if (_parent.length > 0) {
                    arr[_parent.slice(-1)[0] - 1].children.push(item.ID);
                }
            } else {
                item.parents = [];
            }
        });

        console.log(data);
        // console.log(connections);

        afterJSONLoad();
    });

// main function after data processing
function afterJSONLoad() {

    var stratify = d3.stratify()
        .id(d => d.ID)
        .parentId(d => d.parents.length > 0 ? d.parents.slice(-1)[0] : "");

    hierarchy = stratify(data);
    console.log(hierarchy);

    var index = 1;
    var collapsed = [];
    tree = d3.tree(hierarchy);

    /* 
    HACK : This is temporary, 
    make it work with native tree and
    enter exit function
    TODO : Animation
    */
    function toggleChildren(d) {
        if (d.children) {
            d._children = d.children;
            d.children = null;
        } else if (d._children) {
            d.children = d._children;
            d._children = null;
        }
    }
    function render(grp, node) {
        queue.push(node.data);
        _grp = grp.append("g").datum(node.data);
        //append to group
        _grp.append("rect")
            .attr("id", d => "id" + d.ID)
            .attr("x", d => timeScale(d.Start))
            .attr("y", heightScale(index))
            .attr("width", d => timeScale(d.Finish) - timeScale(d.Start))
            .attr("height", taskht)
            .attr("rx", 2)
            .attr("ry", 2)
            .attr("class", d => {
                if (d.children) {
                    return d.children.length == 0 ? "task-rect" : "task-parent";
                } else {
                    return d._children.length == 0 ? "task-rect" : "task-parent";
                }
            })
            .on("click", function (d) {
                d3.event.stopPropagation();
                removeSelection();
                Array.from(document.querySelectorAll("#task-connections path"))
                    .filter((k) => k.id.split("_").includes(d.ID))
                    .forEach(el => d3.select(el).attr("class", "selected"));
                d3.select("#id" + d.ID).attr("class", "selected");
            })
            .on("dblclick", function (d) {
                if (d.children) {
                    queue = [];
                    index = 1;
                    gantt.selectAll("rect").remove()
                    gantt.selectAll("text").remove()
                    gantt.selectAll("#task-connections").remove()
                    toggleChildren(node);
                    render(gantt, hierarchy);
                    drawConnections();
                }
            });
        _grp.append("text")
            .text(d => d.TaskName)
            .attr("x", 10)
            .attr("y", heightScale(index) + taskht / 2)
            .attr("class", "task");
        _grp.append("text")
            .text(d => d.ID)
            .attr("x", d => timeScale(d.Start))
            .attr("y", heightScale(index) + taskht)
            .attr("class", "task");
        index++;
        //on click toggle children
        //change position of ids after node
        if (node.children) {
            let group1 = grp.append("g");
            node.children.forEach((child) => {
                render(group1, child);
            });
        }
    }



    var timeScale = d3.scaleTime()
        .domain([d3.min(data, d => d.Start),
        d3.max(data, d => d.Finish)])
        .range([0, w - 50]);

    // axis
    var xAxis = d3.axisBottom(timeScale)
        .ticks(d3.timeWeek)
        .tickFormat(d3.timeFormat('%d %b'));

    // var grid = svg.append('g')
    //     .attr('class', 'grid')
    //     .attr('transform', 'translate(20)')
    //     .call(xAxis)
    //     .selectAll("text")
    //     .style("text-anchor", "middle")
    //     .attr("fill", "#000")
    //     .attr("stroke", "none")
    //     .attr("font-size", 10)
    //     .attr("dy", "1em");

    var heightScale = d3.scaleLinear()
        .domain([1, data.length])
        .range([0, h - 50]);

    // main container for gantt chart
    gantt = svg.append("g")
        .attr("id", "gantt")
        .attr("transform", "translate(20,20)");

    // group = gantt.append("g")
    //     // .attr('transform', 'translate(0,25)')
    //     .attr("id", "task-rectangles")
    //     .selectAll("g")
    //     .data(data)
    //     .enter()
    //     .append("g")
    //     .on("click", function (d) {
    //         d3.event.stopPropagation();
    //         removeSelection();
    //         Array.from(document.querySelectorAll("#task-connections path"))
    //             .filter((k) => k.id.split("_").includes(d.ID))
    //             .forEach(el => d3.select(el).attr("class", "selected"));
    //         d3.select("#id" + d.ID).attr("class", "selected");
    //     });

    // task rectangles
    // rect = group.append("rect")
    //     .attr("x", (d) => timeScale(d.Start))
    //     .attr("y", (d, i) => heightScale(+(d.ID)))
    //     .attr("width", (d) => timeScale(d.Finish) - timeScale(d.Start))
    //     .attr("height", taskht)
    //     .attr("rx", 2)
    //     .attr("ry", 2)
    //     .attr("class", "task-rect")
    //     .attr("id", (d) => "id" + d.ID);


    // taask names
    // group.append("text")
    //     .text((d) => d.ID)
    //     .attr("x", (d) => timeScale(d.Start))
    //     .attr("y", (d) => heightScale(+(d.ID)) + taskht)
    //     .attr("class", "task");



    var lineGenerator = d3.line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveStep);

    // path points for connection lines
    function ptGenerator(k) {
        // [x,y]
        let offset = 5;
        var ptList = [];
        var pta = [];
        var ptb = [];
        let a = k[1];// predecessor
        let b = k[0];// item

        if (k[2]) {
            let _type = k[2].split("")
            var _typea = _type[1] == "S" ? "Start" : "Finish";
            var _typeb = _type[0] == "S" ? "Start" : "Finish";
        } else {
            var _typea = "Finish";
            var _typeb = "Start";
        }

        let xa = timeScale(a[_typea]);
        let ya = heightScale(queue.indexOf(a) + 1);
        let xb = timeScale(b[_typeb]);
        let yb = heightScale(queue.indexOf(b) + 1);
        let sign = +a.ID > +b.ID ? - 1 : 1;// prdecessor id > item id 
        let factor = offset * sign;
        if (_typea == "Start") {
            pta.push([xa + offset, ya]);
            pta.push([xa + offset, ya + factor]);

        } else if (_typea == "Finish") {
            pta.push([xa - offset, ya]);
            pta.push([xa - offset, ya + factor]);
        }

        if (_typeb == "Start") {
            ptb.push([xb + offset, yb]);
            ptb.push([xb + offset, yb + factor * -1]);
        } else if (_typeb == "Finish") {
            ptb.push([xb - offset, yb]);
            ptb.push([xb - offset, yb + factor * -1]);
        }

        ptList = [...pta, ...ptb].sort((a, b) => a[1] - b[1]);

        return lineGenerator(ptList);
    }

    function checkSelection(id) {
        return d3.select("#id" + id).attr("class").includes("selected");
    }

    // connection lines
    function drawConnections() {
        let _connections = connections.filter(con => {
            let boolList = [];
            con.slice(0, 2).forEach(d => {
                console.log(d);
                console.log(queue.includes(d));
                boolList.push(queue.includes(d));
                
            }); 
            return boolList.every(i=>i);
            
        });
        console.log(_connections);
        console.log(queue);
        gantt.append("g")
            .attr("id", "task-connections")
            .selectAll("path")
            .data(_connections)
            .enter()
            .append("path")
            .attr("class", "line")
            .attr("id", d => d[1].ID + "_" + d[0].ID)
            .attr("d", ptGenerator)
            .on("mouseover", function (k) {
                if (!checkSelection(k[0].ID)) {
                    d3.select("#id" + k[0].ID).attr("class", "select-rect");
                }
                if (!checkSelection(k[1].ID)) {
                    d3.select("#id" + k[1].ID).attr("class", "select-rect");
                }
            })
            .on("mouseout", function (k) {
                if (!checkSelection(k[0].ID)) {
                    d3.select("#id" + k[0].ID).attr("class", "task-rect");
                }
                if (!checkSelection(k[1].ID)) {
                    d3.select("#id" + k[1].ID).attr("class", "task-rect");
                }
            })
            .on("click", function (k) {
                d3.event.stopPropagation()
                if (!d3.event.shiftKey) {
                    removeSelection();
                }
                d3.select("#id" + k[0].ID).attr("class", "selected");
                d3.select("#id" + k[1].ID).attr("class", "selected");
                d3.select(this).attr("class", "selected");
            })
    }
    console.log(connections);

    //execute 
    render(gantt, hierarchy);
    drawConnections();
}
