let W,
    H;

const TASK_HT = 15,
    PROGRESS_HT = 8,
    GAP = 4,
    PROGRESS_TOP_OFFSET = (TASK_HT - PROGRESS_HT) / 2,
    TASK_NAME_TOP_OFFSET = TASK_HT / 3,
    DURATION = 1000;

let GANTT,
    LINE_GENERATOR,
    HEIGHT_SCALE,
    TIME_SCALE;

let LINE_GEN_OUTPUT_POINTS = false;

// TODO : Create options for input
// either json or csv
async function getData(url) {
    return await d3.json(url);
}

// remove spaces from json keys
function cleanJson(jsonData) {
    return JSON.parse(
        JSON.stringify(jsonData)
            .replace(/(?!")(\w|\s)+(?=":)/g, (match) => match.replace(/\s/g, ""))
    );
}

// process data
// TODO: create options object 
// parse object properties i.e { property: f(value) }
function processProjectData(data) {
    let connections = [];

    function processDependencies(item, index, arr) {

        if (!item.Predecessors) {
            return item
        }
        let preArray = [];
        let _preArray = function (t) {
            let sc = t.search(/;/);
            // let c = t.search(/,/);
            return sc === -1 ? t.split(",") : t.split(";");
        }(item.Predecessors.replace(/\s/g, ""));

        function addConnections(_pre, link) {
            let preObject = {
                pre: null,
                type: null,
                addition: 0,
            };
            const reType = /SS|FS|FF|SF/g;
            const reSign = /[+-]/g;
            const reAdd = /\d+(?=d)/g;
            preObject.pre = _pre[0];
            let _type = reType.exec(link);
            _type ? preObject.type = _type[0] : preObject.type = undefined;
            let _sign = reSign.exec(link);
            if (_sign) {
                preObject.addition = eval(_sign[0] + reAdd.exec(link)[0]);
            } else {
                preObject.addition = 0;
            }
            connections.push([item, getTaskByID(_pre[0], data), _type ? _type[0] : undefined]);
            return preObject
        }

        // NOTE : delimiters could be different
        _preArray.forEach((link) => {
            let predecessor;
            const rePre = /^\d+/g;
            // eg : "119FS+50 days"
            // could be +5d, +5 days
            const _pre = rePre.exec(link);
            if (_pre) {
                predecessor = addConnections(_pre, link);
            }
            if (predecessor) preArray.push(predecessor);
            arr[+predecessor.pre - 1].dependents.push(item.ID);

        });
        item.preArray = preArray;
        return item
    }

    function convertIndentsToParentChild(item, index, arr) {
        let _s = item.TaskName.match(/^\s+\w/g);
        _s ? item.indent = _s[0].search(/\S/g) / 4 : item.indent = 0;
        item.TaskName = item.TaskName.trim()
        item.children = [];
        let _parent;
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
        return item;
    }

    function convertRawToObjects(item, index, arr) {
        // convert raw data types
        let _dur = item.Duration.match(/^\d+/g);
        item.Duration = _dur ? +_dur[0] : 1;
        item.Finish = Date.parse(item.Finish);
        item.Start = Date.parse(item.Start);
        item.ID = String(item.ID);
        item.ActualStart = Date.parse(item.ActualStart);
        item.ActualFinish = Date.parse(item.ActualFinish);
        item.dependents = []
        // convert indent to parent<>child list
        return convertIndentsToParentChild(item, index, arr);
    }

    data = data.map(convertRawToObjects);

    data = data.map(processDependencies);

    return {data, connections}
}

// main function after data processing
// create necessary data structure eg: tree
function generateHierarchy(data, connections) {

    // setting up the data structure
    const stratify = d3.stratify()
        .id(d => d.ID)
        .parentId(d => d.parents.length > 0 ? d.parents.slice(-1)[0] : "");

    let hierarchy = stratify(data);
    hierarchy.each((d) => d._descendants = d.descendants().slice(1));
    let _flatHierarchy = {};

    hierarchy.descendants().forEach((d) => _flatHierarchy[d.id] = d);

    // rebuild connections with hierarchy data
    connections.map((con, i, arr) => {
        arr[i] = [_flatHierarchy[con[0].ID], _flatHierarchy[con[1].ID], con[2]];
    });

    return hierarchy;
}

function updateHeight(data) {
    let wh = window.innerHeight * 0.85
    let sh = data.length * (TASK_HT + GAP)
    H = sh > wh ? sh : wh;
}

function updateWidth() {
    W = window.innerWidth > 1060 ? window.innerWidth * 0.63 : window.innerWidth * 0.9;
}

function updateScale(data) {
    // x scale
    TIME_SCALE = d3.scaleTime()
        .domain([d3.min(data, d => d.Start),
            d3.max(data, d => d.ActualFinish)])
        .range([0, W - 50]);
    // y scale
    HEIGHT_SCALE = d3.scaleLinear()
        .domain([1, data.length])
        .range([0, H - 50]);
}

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
        return d.children.length !== 0
    } else {
        return d._children.length !== 0
    }
}

function getTaskByID(id, data) {
    let task = data.filter((d) => d.ID === id);
    return task ? task[0] : null;
}

function getNodeIndex(node, id_queue) {
    let i = id_queue.indexOf(node.id);

    // if node is collapsed id isn't found in idqueue
    if (i === -1) {
        let anc = node.ancestors()
        for (let o = 1; o < anc.length; ++o) {
            let j = id_queue.indexOf(anc[o].id);
            if (j !== -1) {
                return j;
            }
        }
    } else {
        return i;
    }
}

// generate item, index sequence
function generateDataQueue(root) {
    const q = [root];
    const i = [root.id];

    function m(root, q, i) {
        if (root.children) {
            root.children.forEach((d) => {
                i.push(d.id);
                q.push(d);
                m(d, q, i);
            });
            return [q, i];
        } else {
            return [q, i];
        }
    }

    return m(root, q, i);
}

function onDragDateSelector(dragPosition) {
    return function () {
        const range = TIME_SCALE.range();
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
                return LINE_GENERATOR([[ptx, 0], [ptx, H]])
            });

        // emit event? add listener to image, date
        setCurrentDate(dragPosition);
        setCurrentImage(dragPosition);
        // change image
    };
}

function onDoubleClickTaskRectangle(hierarchy, connections, queue) {
    // d is d3 bound data
    return function (d) {
        if (d.children || d._children) {
            toggleNodes(d, hierarchy, connections, queue);
        }
    };
}

function render(hierarchy, data, connections, queue, id_queue) {
    function renderContainer() {
        return d3.select("#gantt-container")
            .append("svg")
            .attr("width", W)
            .attr("height", H)
            .attr("class", "svg")
            .attr("overflow", "scroll");
    }

    // top level container
    let svg = renderContainer();

    // main container for gantt chart
    GANTT = svg.append("g")
        .attr("id", "gantt")
        .attr("transform", "translate(20,20)");

    drawConnections(connections, id_queue);

    // time slider - behind  everything
    let dragPosition = d3.mean(TIME_SCALE.range());

    GANTT.append("path")
        .attr("id", "date-selector")
        .attr("d", LINE_GENERATOR([[dragPosition, 0], [dragPosition, H]]))
        .call(d3.drag()
            .on("drag", onDragDateSelector(dragPosition)
            ));

    // rectangles
    let _grp = GANTT.append("g")
        .attr("id", "task-rectangles")
        .selectAll("g")
        .data(hierarchy.descendants())
        .join("g")
        .attr("id", d => "grp" + d.id);

    //append to group
    _grp.append("rect")
        .attr("id", d => "id" + d.id)
        .attr("x", d => TIME_SCALE(d.data.Start))
        .attr("y", (d) => HEIGHT_SCALE(getNodeIndex(d, id_queue) + 1))
        .attr("width", d => {
            let _w = TIME_SCALE(d.data.Finish) - TIME_SCALE(d.data.Start);
            return _w > 10 ? _w : 10;
        })
        .attr("height", TASK_HT)
        .attr("rx", 2)
        .attr("ry", 2)
        // .attr("opacity", 0.5)
        .attr("class", d => hasChildren(d.data) ? "task-parent" : "task-rect")
        .on("click", function (d) {
            d3.event.stopPropagation();
            removeSelection();
            Array.from(document.querySelectorAll("#task-connections path"))
                .filter((k) => k.id.split("_").includes(d.id))
                .forEach(el => d3.select(el).attr("class", "selected"));
            d3.select("#id" + d.id).attr("class", "selected");
            displayTaskInfo(d.data, data);
        })
        .on("dblclick", onDoubleClickTaskRectangle(hierarchy, connections, queue));

    // actual time rectangles
    _grp.append("rect")
        .attr("id", d => "progress" + d.id)
        .attr("x", d => TIME_SCALE(d.data.ActualStart))
        .attr("y", (d) => HEIGHT_SCALE(getNodeIndex(d, id_queue) + 1))
        .attr("transform", `translate(0,${PROGRESS_TOP_OFFSET})`)
        .attr("width", 10)
        .attr("height", PROGRESS_HT)
        .attr("class", "task-actual")
        .attr("rx", 2)
        .attr("ry", 2)
        // .attr("opacity", 0.5)
        .transition()
        .duration(DURATION * 0.8)
        .attr("width", d => {
            let _w = TIME_SCALE(d.data.ActualFinish) - TIME_SCALE(d.data.ActualStart);
            return _w > 10 ? _w : 10;
        });

    _grp.append("rect")
        .attr("x", 0)
        .attr("y", d => HEIGHT_SCALE(getNodeIndex(d, id_queue) + 1))
        .attr("width", W)
        .attr("height", 1)
        .attr("transform", `translate(0,${TASK_HT / 2})`)
        .attr("class", "marker");

    //task names
    _grp.append("text")
        .text(d => /* hasChildren(d.data) ? d.data.TaskName.toUpperCase() : */ d.data.TaskName)
        .attr("x",/* d =>  hasChildren(d.data) ? timeScale(d.data.Start) + 10 : */ 10)
        .attr("y", (d) => HEIGHT_SCALE(getNodeIndex(d, id_queue) + 1))
        .attr("class", "task")
        .attr("transform", `translate(0,${TASK_NAME_TOP_OFFSET})`)
        .each(function () {
            if (!isVisibilityAllowed(this)) {
                this.setAttribute("display", "none");
            }
        });

    /* //task IDs
    _grp.append("text")
        .text(d => d.id)
        .attr("x", d => timeScale(d.data.Finish))
        .attr("y", (d) => heightScale(queue.indexOf(d) + 1))
        .attr("class", "task")
        .attr("transform", `translate(0,${IdTopOffset})`); */

    setCurrentDate(dragPosition);
    setCurrentImage(dragPosition);
    displayTaskInfo(data[0], data);

}

// path points for connection lines
// generates list of [x,y]
function generateConnectionPoints(connection_info, id_queue) {

    let offsetX = 3;
    let offsetY = TASK_HT / 2;
    let ptList,
        pta = [],
        ptb = [];

    let a = connection_info[1].data;// predecessor
    let b = connection_info[0].data;// item

    let _typea, _typeb;
    if (connection_info[2]) {
        let _type = connection_info[2].split("")
        _typea = _type[1] === "S" ? "Start" : "Finish";
        _typeb = _type[0] === "S" ? "Start" : "Finish";
    } else {
        _typea = "Finish";
        _typeb = "Start";
    }

    let xa = TIME_SCALE(a[_typea]);
    // collapsed nodes are not found in queue
    // in that case use parent's position

    let ya = HEIGHT_SCALE(getNodeIndex(connection_info[1], id_queue) + 1) + offsetY;
    let xb = TIME_SCALE(b[_typeb]);
    let yb = HEIGHT_SCALE(getNodeIndex(connection_info[0], id_queue) + 1) + offsetY;
    let sign = +a.ID > +b.ID ? -1 : 1;// predecessor id > item id
    let factor = (offsetY + GAP / 3) * sign;
    if (_typea === "Start") {
        pta.push([xa - offsetX, ya]);
        pta.push([xa - offsetX, ya + factor]);

    } else if (_typea === "Finish") {
        pta.push([xa + offsetX, ya]);
        pta.push([xa + offsetX, ya + factor]);
    }

    if (_typeb === "Start") {
        ptb.push([xb - offsetX, yb]);
        ptb.push([xb - offsetX, yb + factor * -1]);
    } else if (_typeb === "Finish") {
        ptb.push([xb + offsetX, yb]);
        ptb.push([xb + offsetX, yb + factor * -1]);
    }

    ptList = [...pta, ...ptb].sort((a, b) => a[1] - b[1]);

    return LINE_GEN_OUTPUT_POINTS ? ptList : LINE_GENERATOR(ptList);
}

function drawConnections(connections, id_queue) {
    let _connections = connections.filter(con => {
        return con
            .slice(0, 2)
            .reduce(
                (acc, item) => {
                    acc.push(id_queue.includes(item.id));
                    return acc;
                }, []).every(i => i);
    });

    GANTT.append("g")
        .attr("id", "task-connections")
        .selectAll("path")
        .data(_connections)
        .enter()
        .append("path")
        .attr("class", "line")
        .attr("opacity", 0.3)
        .attr("id", d => "con_" + d[1].id + "_" + d[0].id)
        .attr("d", (k) => generateConnectionPoints(k, id_queue))
        .on("mouseover", function (k) {
            if (!isSelected(k[0].id)) {
                d3.select("#id" + k[0].id).attr("class", "select-rect");
            }
            if (!isSelected(k[1].id)) {
                d3.select("#id" + k[1].id).attr("class", "select-rect");
            }
        })
        .on("mouseout", function (k) {
            if (!isSelected(k[0].id)) {
                d3.select("#id" + k[0].id).attr("class", "task-rect");
            }
            if (!isSelected(k[1].id)) {
                d3.select("#id" + k[1].id).attr("class", "task-rect");
            }
        })
        .on("click", function (k) {
            d3.event.stopPropagation()
            if (!d3.event.shiftKey) {
                removeSelection();
            }
            d3.select("#id" + k[0].id).attr("class", "selected");
            d3.select("#id" + k[1].id).attr("class", "selected");
            d3.select(this).attr("class", "selected");
        })
}

// connection lines
function updateConnections(connections, id_queue) {
    connections.forEach(con => {
        let boolList = [];
        con.slice(0, 2).forEach(d => {
            boolList.push(id_queue.includes(d.id));
        });
        let val = boolList.every(i => i);
        let id = "#con_" + con[1].id + "_" + con[0].id;
        if (!val) {
            d3.select(id).attr("class", "line filtered");
        } else {
            d3.select(id).attr("class", "line")
                .attr("display", function () {
                    setTimeout(() => this.removeAttribute("display"), DURATION / 2)
                });
        } // toggle filtered class

        return val;
    });
    // select path element
    d3.selectAll("path.filtered")
        .transition()
        .duration(DURATION)
        .attr("opacity", 0)
        .attr("display", function () {
            setTimeout(() => {
                this.setAttribute("display", "none")
            }, DURATION / 2);
        });
    // change d attr
    d3.select("#task-connections")
        .selectAll("path")
        .transition()
        .duration(DURATION)
        .attr("d", function (d) {
            LINE_GEN_OUTPUT_POINTS = true;
            let ptList = generateConnectionPoints(d, id_queue);
            return LINE_GENERATOR(ptList);
        })
}

function toggleNodes(node, hierarchy, connections, queue) {

    // get node index
    let descendants = node._descendants;
    let index = queue.indexOf(node);
    const isChilderenVisible = !!node.children;
    toggleChildren(node);

    let [queue_new, id_queue] = generateDataQueue(hierarchy);
    queue = queue_new;

    updateHeight(queue);
    updateConnections(connections, id_queue);
    d3.select("#gantt-container>svg")
        .transition()
        .duration(DURATION)
        .attr("height", H);


    function collapseNodes(d) {
        let nodedata = d.data || d;
        d3.selectAll("#grp" + nodedata.ID + " *")
            .classed("hidden", true)
            .each(function () {
                setTimeout(() => {
                    if (isVisibilityAllowed(this)) {
                        this.setAttribute("display", "none")
                    }
                }, DURATION)
            })
            .transition()
            .ease(d3.easeCubic)
            .duration(DURATION)
            .attr("y", HEIGHT_SCALE(index + 1));

    }

    function moveGroups(d, i) {
        let nodedata = d.data || d;
        d3.selectAll("#grp" + nodedata.ID + " *")
            .transition()
            .ease(d3.easeCubic)
            .duration(DURATION)
            .attr("y", HEIGHT_SCALE(i + index + 2));
    }

    function showNodes(d, i) {
        let nodedata = d.data || d;
        d3.selectAll("#grp" + nodedata.ID + " *")
            .classed("hidden", false)
            .each(function () {
                if (isVisibilityAllowed(this)) {
                    this.setAttribute("display", "block");
                }
            })
            .transition()
            .ease(d3.easeCubic)
            .duration(DURATION)
            .attr("y", HEIGHT_SCALE(i + 1));

    }

    if (isChilderenVisible) {
        descendants.map(collapseNodes);
        queue.slice(index + 1).map(moveGroups);
    } else {
        queue.map(showNodes);
    }

}

function setCurrentDate(dragPosition) {
    let _d = new Date(TIME_SCALE.invert(dragPosition));
    const options = {year: 'numeric', month: 'long', day: 'numeric'};
    document.querySelector("#current-date").innerHTML = `${_d.toLocaleDateString('en-US', options)}`
}

function setCurrentImage(dragPosition) {
    let imageRange = d3.scaleLinear()
        .domain([1, 413])
        .range(TIME_SCALE.range());
    let imageIndex = Number(imageRange.invert(dragPosition));
    imageIndex -= imageIndex % 1;
    document.getElementById("sequence-img").setAttribute("src", `./assets/sequence/0 (${imageIndex}).jpg`)
}

function removeSelection() {
    d3.selectAll("path.selected").attr("class", "line");
    d3.selectAll("rect.selected").attr("class", d => hasChildren(d.data) ? "task-parent" : "task-rect");
}

function isVisibilityAllowed(d) {
    if (d.id.startsWith("progress")) {
        return document.getElementById("isProgressVisible").checked;
    } else if (d.classList.contains("task")) {
        return document.getElementById("isTextVisible").checked;
    } else if (d.id.startsWith("id")) {
        return true;
    } else {
        return true;
    }
}

function isSelected(id) {
    return d3.select("#id" + id).attr("class").includes("selected");
}

function scrollToTask(taskId) {
    const scrollOptions = {
        top: document.getElementById(taskId)
            .getAttribute("y"),
        left: 0,
        behavior: 'smooth'
    }
    document.getElementById("gantt-container")
        .scrollTo(scrollOptions)
}

function highlightTaskSelection(taskId) {
    document.getElementById(taskId).classList.toggle("select-blink1");
    document.getElementById(taskId).classList.toggle("select-blink");
    setTimeout(() => {
        document.getElementById(taskId).classList.toggle("select-blink");
        setTimeout(() => document.getElementById(taskId).classList.toggle("select-blink1"), 1000);
    }, 1000);
}

function displayTaskInfo(taskObj, data) {
    const options = {year: 'numeric', month: 'long', day: 'numeric'};

    const fields = {
        "info-task-id": taskObj.ID,
        "info-task-name": taskObj.TaskName,
        "info-pstart": new Date(taskObj.Start).toLocaleDateString('en-US', options),
        "info-pfinish": new Date(taskObj.Finish).toLocaleDateString('en-US', options),
        "info-pduration": taskObj.Duration + "d",
        "info-astart": new Date(taskObj.ActualStart).toLocaleDateString('en-US', options),
        "info-afinish": new Date(taskObj.ActualFinish).toLocaleDateString('en-US', options),
        // "info-aduration": taskObj.TaskName,
    };

    for (const key of Object.keys(fields)) {
        document.getElementById(key).innerHTML = fields[key];
    }

    //  delete all children
    let dependency_list = document.getElementById("dependency-container").children;

    for (const d of dependency_list) {
        d.remove();
    }

    for (const dep of taskObj.dependents) {
        // add info-link, scroll to
        // create div, add listener, append child
        let el = document.createElement("tr");
        el.setAttribute("data-infoId", "id" + dep)
        el.addEventListener("click", (e) => {
            let r = e.target.getAttribute("data-infoId");
            if (r == null) {
                r = e.target.parentElement.getAttribute("data-infoId");
            }
            scrollToTask(r);
            highlightTaskSelection(r);
        });
        el.innerHTML = `<td>${getTaskByID(dep, data).TaskName}</td>`;
        document.getElementById("dependency-container").append(el);

    }
}

function setupEventListeners(data, hierarchy, connections) {
    let isLinksVisible = document.getElementById("isLinksVisible")
    isLinksVisible.checked = true;
    isLinksVisible.addEventListener("click", function () {
        if (!this.checked) {
            d3.select("#task-connections").attr("display", "none")
        } else {
            d3.selectAll("#task-connections").attr("display", "block")
        }
    })

    let isProgressVisible = document.getElementById("isProgressVisible")
    isProgressVisible.checked = true;
    isProgressVisible.addEventListener("click", function () {
        if (!this.checked) {
            d3.selectAll(".task-actual").attr("display", "none");
        } else {
            d3.selectAll(".task-actual:not(.hidden)").attr("display", "block");
        }
    })

    // text visibility check box
    let isTextVisible = document.getElementById("isTextVisible")
    isTextVisible.checked = false;
    isTextVisible.addEventListener("click", function () {
        if (!this.checked) {
            d3.selectAll("g text").attr("display", "none");
        } else {
            d3.selectAll("g text:not(.hidden)").attr("display", "block");
        }
    })

    // deselect tasks
    document.querySelector("#gantt-container").addEventListener("click", removeSelection);

    // resize
    window.addEventListener("resize", () => {
        document.querySelector("#gantt-container>svg").remove();
        let [q, iq] = generateDataQueue(hierarchy)
        updateHeight(q);
        updateWidth();
        updateScale(data);
        render(hierarchy, data, connections, q, iq);
    })
}

// execute on load
(async () => {
    let rawData = await getData("./data/convertcsv.json");
    let {data, connections} = processProjectData(cleanJson(rawData));
    let hierarchy = generateHierarchy(data, connections);
    let [queue, id_queue] = generateDataQueue(hierarchy);
    // path generator for dependency links
    LINE_GENERATOR = d3.line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveStep);

    setupEventListeners(data, hierarchy, connections);
    updateHeight(data);
    updateWidth();
    updateScale(data);
    render(hierarchy, data, connections, queue, id_queue);
})();


// -----------UNCHARTED WATERS-------------------------------

// based on preceding, succeeding events
// TODO : select all connected
function getFuture(d, dependents, data) {
    if (!dependents) dependents = [];
    if (d.dependents.length > 0) {
        d.dependents.forEach(i => {
            let j = getTaskByID(i, data);
            if (!dependents.includes(j)) {
                dependents.push(j);
                getFuture(j, dependents, data);
            } else {
                console.log(`probable loop dependency ${i}`)
            }
        });
        return dependents;
    } else {
        return dependents;
    }
}

