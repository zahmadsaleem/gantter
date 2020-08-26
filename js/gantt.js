let w,
    h,
    taskht = 15,
    progressht = 8,
    gap = 4,
    progressTopOffset = (taskht - progressht) / 2,
    taskNameTopOffset = taskht / 3,
    duration = 1000;

let svg,
    data,
    gantt,
    hierarchy,
    connections = [],
    queue = [],
    idqueue = [],
    lineGenerator,
    heightScale,
    timeScale;

let linegenOutputPts = false;

// TODO : Create options for input
// either json or csv
function getData(url) {
    d3.json(url)
        // d3.json(url)
        .then(d => {
            // remove spaces from json keys
            data = cleanJson(d);
        }).then(() => {
        data.forEach(d => d.dependents = []);
        processProjectData();
    });
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
function processProjectData() {
    function processDependencies(item, arr) {
        let preArray = [];
        let _preArray = function (t) {
            let sc = t.search(/;/);
            let c = t.search(/,/);
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
            connections.push([item, getTaskByID(_pre[0]), _type ? _type[0] : undefined]);
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
    }

    data.forEach((item, index, arr) => {
        // convert raw data types
        let _dur = item.Duration.match(/^\d+/g);
        item.Duration = _dur ? +_dur[0] : 1;
        item.Finish = Date.parse(item.Finish);
        item.Start = Date.parse(item.Start);
        item.ID = String(item.ID);
        item.ActualStart = Date.parse(item.ActualStart);
        item.ActualFinish = Date.parse(item.ActualFinish);


        // convert indent to parent<>child list
        convertIndentsToParentChild(item, index, arr);
    });

    data.forEach((item, index, arr) => {
        // process dependencies
        if (item.Predecessors) {
            processDependencies(item, arr);
        }
    })

    // console.log(data);
    // console.log(connections);

    setupDataStructure();
}

// main function after data processing
// create necessary data structure eg: tree
function setupDataStructure() {

    // setting up the data structure
    const stratify = d3.stratify()
        .id(d => d.ID)
        .parentId(d => d.parents.length > 0 ? d.parents.slice(-1)[0] : "");

    hierarchy = stratify(data);

    hierarchy.each((d) => d._descendants = d.descendants().slice(1));
    let _flatHierarchy = {};

    hierarchy.descendants().forEach((d) => _flatHierarchy[d.id] = d);

    // rebuild connections with hierarchy data
    connections.map((con, i, arr) => {
        arr[i] = [_flatHierarchy[con[0].ID], _flatHierarchy[con[1].ID], con[2]];
    });

    // path generator for dependency links
    lineGenerator = d3.line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveStep);


    setupEventListeners();

    //execute 
    // hierarchy.children.forEach(d => toggleChildren(d));
    let q = generateDataQueue(hierarchy);
    queue = q[0]
    idqueue = q[1];
    // hierarchy.children.forEach(d => toggleChildren(d));
    updateHeight(data);
    updateWidth();
    updateScale(data);
    render(hierarchy);

}

// #endregion

// #region setup layout

function updateHeight(data) {
    let wh = window.innerHeight * 0.85
    let sh = data.length * (taskht + gap)
    h = sh > wh ? sh : wh;
}

function updateWidth() {
    w = window.innerWidth > 1060 ? window.innerWidth * 0.63 : window.innerWidth * 0.9;
}

function updateScale(data) {
    // x scale
    timeScale = d3.scaleTime()
        .domain([d3.min(data, d => d.Start),
            d3.max(data, d => d.ActualFinish)])
        .range([0, w - 50]);
    // y scale
    heightScale = d3.scaleLinear()
        .domain([1, data.length])
        .range([0, h - 50]);

}


// #endregion

// #region data utils

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

function getTaskByID(id) {
    let task = data.filter((d) => d.ID === id);
    return task ? task[0] : undefined;
}

// based on preceding, succeeding events
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

function checkId(node) {
    let i = idqueue.indexOf(node.id);

    // if node is collapsed id isn't found in idqueue
    if (i === -1) {
        let anc = node.ancestors()
        for (var o = 1; o < anc.length; ++o) {
            let j = idqueue.indexOf(anc[o].id);
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

// #endregion

// #region add elements

function render(hierarchy) {
    // top level container
    svg = d3.select("#gantt-container")
        .append("svg")
        .attr("width", w)
        .attr("height", h)
        .attr("class", "svg")
        .attr("overflow", "scroll");

    // time slider - behind  everything
    var dragPosition = d3.mean(timeScale.range());

    // main container for gantt chart
    gantt = svg.append("g")
        .attr("id", "gantt")
        .attr("transform", "translate(20,20)");

    drawConnections();

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

                    // emit event? add listener to image, date
                    setCurrentDate(dragPosition);
                    setCurrentImage(dragPosition);
                    // change image
                }
            ));

    // rectangles
    let _grp = gantt.append("g")
        .attr("id", "task-rectangles")
        .selectAll("g")
        .data(hierarchy.descendants())
        .join("g")
        .attr("id", d => "grp" + d.id);

    //append to group
    _grp.append("rect")
        .attr("id", d => "id" + d.id)
        .attr("x", d => timeScale(d.data.Start))
        .attr("y", (d) => heightScale(checkId(d) + 1))
        .attr("width", d => {
            let _w = timeScale(d.data.Finish) - timeScale(d.data.Start);
            return _w > 10 ? _w : 10;
        })
        .attr("height", taskht)
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
            displayTaskInfo(d.data);
        })
        .on("dblclick", function (d) {
            if (d.children || d._children) {
                toggleNodes(d);
            }
        });

    // actual time rectangles
    _grp.append("rect")
        .attr("id", d => "progress" + d.id)
        .attr("x", d => timeScale(d.data.ActualStart))
        .attr("y", (d) => heightScale(checkId(d) + 1))
        .attr("transform", `translate(0,${progressTopOffset})`)
        .attr("width", 10)
        .attr("height", progressht)
        .attr("class", "task-actual")
        .attr("rx", 2)
        .attr("ry", 2)
        // .attr("opacity", 0.5)
        .transition()
        .duration(duration * 0.8)
        .attr("width", d => {
            let _w = timeScale(d.data.ActualFinish) - timeScale(d.data.ActualStart);
            return _w > 10 ? _w : 10;
        });

    _grp.append("rect")
        .attr("x", 0)
        .attr("y", d => heightScale(checkId(d) + 1))
        .attr("width", w)
        .attr("height", 1)
        .attr("transform", `translate(0,${taskht / 2})`)
        .attr("class", "marker");

    //task names
    _grp.append("text")
        .text(d => /* hasChildren(d.data) ? d.data.TaskName.toUpperCase() : */ d.data.TaskName)
        .attr("x",/* d =>  hasChildren(d.data) ? timeScale(d.data.Start) + 10 : */ 10)
        .attr("y", (d) => heightScale(checkId(d) + 1))
        .attr("class", "task")
        .attr("transform", `translate(0,${taskNameTopOffset})`)
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
    displayTaskInfo(data[0]);

}

// path points for connection lines
function ptGenerator(k) {
    // [x,y]
    let offsetX = 3;
    let offsetY = taskht / 2;
    let ptList,
        pta = [],
        ptb = [];

    let a = k[1].data;// predecessor
    let b = k[0].data;// item

    let _typea, _typeb;
    if (k[2]) {
        let _type = k[2].split("")
        _typea = _type[1] === "S" ? "Start" : "Finish";
        _typeb = _type[0] === "S" ? "Start" : "Finish";
    } else {
        _typea = "Finish";
        _typeb = "Start";
    }

    let xa = timeScale(a[_typea]);
    // collapsed nodes are not found in queue
    // in that case use parent's position

    // console.log(`id ${a.ID} con ${queue[checkId(k[1])].id} -- id ${b.ID} con ${queue[checkId(k[0])].id}`);
    let ya = heightScale(checkId(k[1]) + 1) + offsetY;
    let xb = timeScale(b[_typeb]);
    let yb = heightScale(checkId(k[0]) + 1) + offsetY;
    let sign = +a.ID > +b.ID ? -1 : 1;// predecessor id > item id
    let factor = (offsetY + gap / 3) * sign;
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
    //console.log([k,ptList])
    return linegenOutputPts ? ptList : lineGenerator(ptList);
}

function drawConnections() {
    let _connections = connections.filter(con => {
        let boolList = [];
        con.slice(0, 2).forEach(d => {
            boolList.push(idqueue.includes(d.id));
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
        .attr("opacity", 0.3)
        .attr("id", d => "con_" + d[1].id + "_" + d[0].id)
        .attr("d", ptGenerator)
        .on("mouseover", function (k) {
            if (!checkSelection(k[0].id)) {
                d3.select("#id" + k[0].id).attr("class", "select-rect");
            }
            if (!checkSelection(k[1].id)) {
                d3.select("#id" + k[1].id).attr("class", "select-rect");
            }
        })
        .on("mouseout", function (k) {
            if (!checkSelection(k[0].id)) {
                d3.select("#id" + k[0].id).attr("class", "task-rect");
            }
            if (!checkSelection(k[1].id)) {
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
function updateConnections() {
    connections.forEach(con => {
        let boolList = [];
        con.slice(0, 2).forEach(d => {
            boolList.push(idqueue.includes(d.id));
        });
        let val = boolList.every(i => i);
        let id = "#con_" + con[1].id + "_" + con[0].id;
        if (!val) {
            d3.select(id).attr("class", "line filtered");
        } else {
            d3.select(id).attr("class", "line")
                .attr("display", function () {
                    setTimeout(() => this.removeAttribute("display"), duration / 2)
                });
        } // toggle filtered class 

        return val;
    });
    // select path element
    d3.selectAll("path.filtered")
        .transition()
        .duration(duration)
        .attr("opacity", 0)
        .attr("display", function () {
            setTimeout(() => {
                this.setAttribute("display", "none")
            }, duration / 2);
        });
    // change d attr 
    d3.select("#task-connections")
        .selectAll("path")
        .transition()
        .duration(duration)
        .attr("d", function (d) {
            linegenOutputPts = true;
            let ptList = ptGenerator(d);
            return lineGenerator(ptList);
        })

    // 
}

// #endregion

// #region interactivity utils

function toggleNodes(node) {

    // get node index
    let descendants = node._descendants;
    let index = queue.indexOf(node);
    const childs = node.children;
    toggleChildren(node);

    let q = generateDataQueue(hierarchy);
    queue = q[0];
    idqueue = q[1];

    updateHeight(queue);
    updateConnections();
    svg
        .transition()
        .duration(duration)
        .attr("height", h);


    if (childs) {
        descendants.map((d) => {
            let nodedata = d.data || d;
            d3.selectAll("#grp" + nodedata.ID + " *")
                .classed("hidden", true)
                .each(function () {
                    setTimeout(() => {
                        if (isVisibilityAllowed(this)) {
                            this.setAttribute("display", "none")
                        }
                    }, duration)
                })
                .transition()
                .ease(d3.easeCubic)
                .duration(duration)
                .attr("y", heightScale(index + 1));
        });
        queue.slice(index + 1).map((d, i) => {
            let nodedata = d.data || d;
            d3.selectAll("#grp" + nodedata.ID + " *")
                .transition()
                .ease(d3.easeCubic)
                .duration(duration)
                .attr("y", heightScale(i + index + 2));
        });
    } else {
        queue.map((d, i) => {
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
                .duration(duration)
                .attr("y", heightScale(i + 1));
        });
    }

}

function setCurrentDate(dragPosition) {
    let _d = new Date(timeScale.invert(dragPosition));
    const options = {year: 'numeric', month: 'long', day: 'numeric'};
    document.querySelector("#current-date").innerHTML = `${_d.toLocaleDateString('en-US', options)}`
}

function setCurrentImage(dragPosition) {
    let imageRange = d3.scaleLinear()
        .domain([1, 413])
        .range(timeScale.range());
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
        return isProgressVisible.checked;
    } else if (d.classList.contains("task")) {
        return isTextVisible.checked;
    } else if (d.id.startsWith("id")) {
        return true;
    } else {
        return true;
    }
}

function checkSelection(id) {
    return d3.select("#id" + id).attr("class").includes("selected");
}

function scrollToTask(taskId) {
    document.getElementById("gantt-container")
        .scrollTo({
            top: document.getElementById(taskId)
                .getAttribute("y"),
            left: 0,
            behavior: 'smooth'
        })
}

function highlightTaskSelection(taskId) {
    document.getElementById(taskId).classList.toggle("select-blink1");
    document.getElementById(taskId).classList.toggle("select-blink");
    setTimeout(() => {
        document.getElementById(taskId).classList.toggle("select-blink");
        setTimeout(() => document.getElementById(taskId).classList.toggle("select-blink1"), 1000);
    }, 1000);
}

function displayTaskInfo(taskObj) {
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
        el.innerHTML = `<td>${getTaskByID(dep).TaskName}</td>`;
        document.getElementById("dependency-container").append(el);

    }
}

function setupEventListeners() {
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
        svg.remove();
        updateHeight(queue);
        updateWidth();
        updateScale(data);
        render(hierarchy);
    })
}

// #endregion

// #region execute

getData("./data/convertcsv.json");

// #endregion