var w = 2500;
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


function getFuture(d, dependents) {
    if (!dependents) dependents = [];
    if (d.dependents.length > 0) {
        d.dependents.forEach(i => {
            let j = getTaskByID(i);
            if (!dependents.includes(j)) {
                dependents.push(j);
                getFuture(j, dependents);
            } else {
                console.log(`probable loop dependency ${i}`)
            }
        });
        return dependents;
    } else {
        return dependents;
    }
}


function getDepthFirstIndex(root, node) {
    var gotIt = false;
    function m(root, node, i) {
        if (!i) i = 0;
        var childs = root.children;
        // console.log(`root= ${root.id} node= ${node.id}`);
        if (root.id == node.id) {
            // console.log("got it in the beginning")
            return i;
        } else if (childs) {
            // console.log("going for the kill");
            for (var c = 0; c < childs.length; c++) {
                i++;
                if (childs[c].id == node.id) {
                    // console.log("got it while killin");
                    gotIt = true;
                    return i;
                } else if (!gotIt) {
                    // console.log("killin it");
                    // console.log(gotIt);
                    i = m(childs[c], node, i);
                }
            }
            return i;
        } else {
            // console.log(`not a child ${i}`);
            return i;
        }
    }
    let r = m(root, node);
    return r;
}

function generateDataQueue(root) {
    var q = [root.data];
    function m(root, q) {
        if (root.children) {
            root.children.forEach((d) => {
                q.push(d.data);
                m(d, q);
            });
            return q;
        } else {
            return q;
        }
    }
    return m(root, q);
}

// either json or csv
d3.json("./convertcsv.json")
    // d3.json("./schedule.json")
    .then(d => {
        // remove spaces from json keys
        data = JSON.parse(
            JSON.stringify(d)
                .replace(/(?!")(\w|\s)+(?=":)/g, (match) => match.replace(/\s/g, ""))
        );
    }).then(() => {
        data.forEach(d => d.dependents = []);
        processProjectData();
    });



// process data
function processProjectData() {
    data.forEach((item, index, arr) => {
        // convert raw data types
        let _dur = item.Duration.match(/^\d+/g);
        item.Duration = _dur ? +_dur[0] : 1;
        item.Finish = Date.parse(item.Finish);
        item.Start = Date.parse(item.Start);
        item.ID = String(item.ID);
        item.ActualStart = Date.parse(item.ActualStart);
        item.ActualFinish = Date.parse(item.ActualFinish);

        // process dependencies
        if (item.Predecessors) {
            var preArray = [];
            var _preArray = function (t) {
                let sc = t.search(/;/);
                let c = t.search(/,/);
                return sc == -1 ? t.split(",") : t.split(";");
            }(item.Predecessors.replace(/\s/g, ""));
            // delimiters could be different
            _preArray.forEach((link) => {
                var preObject = {};
                const rePre = /^\d+/g;
                const reType = /SS|FS|FF|SF/g;
                const reSign = /\+|-/g;
                const reAdd = /\d+(?=d)/g;

                // eg : "119FS+50 days"
                // could be +5d, +5 days
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
                arr[+preObject.pre - 1].dependents.push(item.ID);

            });
            item.preArray = preArray;
        }

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

    afterProcessData();
};

// main function after data processing
function afterProcessData() {

    var stratify = d3.stratify()
        .id(d => d.ID)
        .parentId(d => d.parents.length > 0 ? d.parents.slice(-1)[0] : "");

    hierarchy = stratify(data);
    hierarchy.each((d) => d._descendants = d.descendants().slice(1));

    function toggleChildren(d) {
        if (d.children) {
            d._children = d.children;
            d.children = null;
        } else if (d._children) {
            d.children = d._children;
            d._children = null;
        }
    }
    function hasChildren(d) {
        if (d.children) {
            return !d.children.length == 0
        } else {
            return !d._children.length == 0
        }
    }

    function render(root) {
        _grp = gantt.append("g")
            .attr("id", "task-rectangles")
            .selectAll("g")
            .data(root.descendants())
            .join("g")
            .attr("id",d=>"grp"+d.id);

        //append to group
        _grp.append("rect")
            .attr("id", d => "id" + d.id)
            .attr("x", d => timeScale(d.data.Start))
            .attr("y", (d) => heightScale(queue.indexOf(d.data) + 1))
            .attr("width", d => {
                let _w = timeScale(d.data.Finish) - timeScale(d.data.Start);
                return _w > 10 ? _w : 10;
            })
            .attr("height", taskht)
            .attr("rx", 2)
            .attr("ry", 2)
            .attr("opacity", 0.5)
            .attr("class", d => hasChildren(d.data) ? "task-parent" : "task-rect")
            .on("click", function (d) {
                d3.event.stopPropagation();
                removeSelection();
                Array.from(document.querySelectorAll("#task-connections path"))
                    .filter((k) => k.id.split("_").includes(d.id))
                    .forEach(el => d3.select(el).attr("class", "selected"));
                d3.select("#id" + d.id).attr("class", "selected");
            })
            .on("dblclick", function (d) {
                if (d.children || d._children) {
                    updateNodes(d);
                }
            });
        //FIXME: Add animation, update to text, actual

        // actual gantt
        _grp.append("rect")
            .attr("id", d => "progress" + d.id)
            .attr("x", d => timeScale(d.data.ActualStart))
            .attr("y", (d) => heightScale(queue.indexOf(d.data) + 1) + taskht / 3)
            .attr("width", d => {
                let _w = timeScale(d.data.ActualFinish) - timeScale(d.data.ActualStart);
                return _w > 10 ? _w : 10;
            })
            .attr("height", taskht / 2)
            .attr("class", "task-actual")
            .attr("rx", 2)
            .attr("ry", 2);

        //task names
        _grp.append("text")
            .text(d => hasChildren(d.data) ? d.data.TaskName.toUpperCase() : d.data.TaskName)
            .attr("x", d => hasChildren(d.data) ? timeScale(d.data.Start) + 10 : 10)
            .attr("y", (d) => heightScale(queue.indexOf(d.data)+1) + taskht / 2)
            .attr("class", "task");
        //task IDs
        _grp.append("text")
            .text(d => d.id)
            .attr("x", d => timeScale(d.data.Finish))
            .attr("y", (d) => heightScale(queue.indexOf(d.data)+1) + taskht / 2)
            .attr("class", "task");
    
    }

    function updateNodes(node) {
        // get node index
        gantt.selectAll("#task-connections").remove()
        let descendents = node._descendants;
        let index = queue.indexOf(node.data);
        var childs = node.children;
        var _childs = node._children;
        toggleChildren(node);
        queue = generateDataQueue(hierarchy);
        if (childs) {
            descendents.map((d) => {
                let nodedata = d.data || d;
                d3.selectAll("#grp" + nodedata.ID + " *")
                    .transition()
                    .duration(1000)
                    .attr("y", heightScale(index + 1))
                    .attr("opacity", 0)
                    .attr("display", function () { setTimeout(() => this.setAttribute("display", "none"), 1000) });
            });
            queue.slice(index + 1).map((d, i) => {
                let nodedata = d.data || d;
                d3.selectAll("#grp" + nodedata.ID + " *")
                    .transition()
                    .duration(1000)
                    .attr("y", heightScale(i + index + 2));

            });
        } else {
            queue.map((d, i) => {
                let nodedata = d.data || d;
                d3.selectAll("#grp" + nodedata.ID + " *")
                    .transition()
                    .duration(1000)
                    .attr("y", heightScale(i + 1))
                    .attr("opacity", 0.5)
                    .attr("display", function () { this.removeAttribute("display") });
            });
        }

        drawConnections();
    }

    // x scale
    var timeScale = d3.scaleTime()
        .domain([d3.min(data, d => d.Start),
        d3.max(data, d => d.Finish)])
        .range([0, 800]);
    // .range([0, w - 50]);
    // .clamp(true);

    var heightScale = d3.scaleLinear()
        .domain([1, data.length])
        .range([0, h - 50]);

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
                boolList.push(queue.includes(d));
            });
            return boolList.every(i => i);
        });
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

    // main container for gantt chart
    gantt = svg.append("g")
        .attr("id", "gantt")
        .attr("transform", "translate(20,20)");

    //execute 
    queue = generateDataQueue(hierarchy);
    render(hierarchy);
    drawConnections();

    // time slider
    var dragPosition = d3.mean(timeScale.range());
    gantt.append("path")
        .attr("id", "date-selector")
        .attr("d", lineGenerator([[dragPosition, 0], [dragPosition, h]]))
        .call(d3.drag()
            .on("drag", function () {
                const range = timeScale.range();
                let checkMouseX = pos => {
                    if (pos < range[1] && pos > range[0]) {
                        dragPosition = pos;
                        return pos;
                    } else {
                        return dragPosition;
                    }
                }
                d3.select(this)
                    .attr("d", () => {
                        let ptx = checkMouseX(d3.event.x);
                        return lineGenerator([[ptx, 0], [ptx, h]])
                    });
            }
            ));

    var event = new Event('dataloaded');
    // document.dispatchEvent(event);

}

