// DopeTool main.js — v2.1.0

var csInterface = new CSInterface();
var currentTab = "colors";
var currentClient = null;
var currentData = [];
var allClientsData = {};
var pendingCapture = null;
var activeContextId = null;
var activeContextItem = null;

var collectionMap = {
  colors: "colors", fonts: "fonts", textstyles: "textstyles",
  effects: "effects", animations: "animations"
};

var captureFunctionMap = {
  colors: "captureColor()", fonts: "captureFont()",
  textstyles: "captureTextStyle()", effects: null, animations: null
};

var GITHUB_RAW_BASE = "https://raw.githubusercontent.com/itsusmanelahi01/dopetool/main";
var nodeFs = require("fs");
var nodeOs = require("os");
var extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
var localVersionPath = extensionPath + "/local_version.json";

// ---- CLIENT COLOR + INITIAL ----
function clientColor(name) {
  var colors = ["#4c72ff","#ff5577","#33cc88","#ff9944","#aa55ff","#00cccc","#ff4488","#66bb33","#ff6644","#4499ff","#cc44aa","#88cc00"];
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function clientInitial(name) { return name.trim().charAt(0).toUpperCase(); }

// ---- LOAD ALL CLIENTS ----
function loadAllClients() {
  var grid = document.getElementById("clientGrid");
  grid.innerHTML = '<div style="color:#333348;padding:20px;text-align:center;font-size:11px;">Loading...</div>';
  var collections = ["colors","fonts","textstyles","effects","animations"];
  var clientMap = {};
  var pending = collections.length;

  collections.forEach(function (col) {
    db.collection(col).get()
      .then(function (snapshot) {
        snapshot.forEach(function (doc) {
          var data = doc.data();
          if (data.placeholder) return; // skip placeholder docs
          var client = data.client || "General";
          if (!clientMap[client]) clientMap[client] = { total: 0, types: {} };
          clientMap[client].total++;
          clientMap[client].types[col] = (clientMap[client].types[col] || 0) + 1;
        });
        pending--;
        if (pending === 0) renderClientGrid(clientMap);
      })
      .catch(function () { pending--; if (pending === 0) renderClientGrid(clientMap); });
  });
}

function renderClientGrid(clientMap) {
  var grid = document.getElementById("clientGrid");
  var search = document.getElementById("clientSearch").value.toLowerCase();
  var clients = Object.keys(clientMap).sort();
  if (search) clients = clients.filter(function (c) { return c.toLowerCase().indexOf(search) !== -1; });

  if (clients.length === 0) {
    grid.innerHTML = '<div style="color:#333348;padding:30px;text-align:center;font-size:11px;">No clients yet.<br>Click "+ Add New Client" to get started.</div>';
    allClientsData = clientMap;
    return;
  }

  grid.innerHTML = "";
  clients.forEach(function (client) {
    var data = clientMap[client];
    var color = clientColor(client);
    var typeSummary = [];
    if (data.types.colors) typeSummary.push(data.types.colors + " colors");
    if (data.types.fonts) typeSummary.push(data.types.fonts + " fonts");
    if (data.types.textstyles) typeSummary.push(data.types.textstyles + " styles");
    if (data.types.effects) typeSummary.push(data.types.effects + " fx");
    if (data.types.animations) typeSummary.push(data.types.animations + " anims");

    var card = document.createElement("div");
    card.className = "clientCard";
    card.style.setProperty("--client-color", color);
    card.innerHTML =
      '<div class="clientInitial" style="background:' + color + '">' + clientInitial(client) + '</div>' +
      '<div class="clientCardInfo">' +
        '<div class="clientCardName">' + client + '</div>' +
        '<div class="clientCardMeta">' + data.total + ' items · ' + (typeSummary.join(", ") || "empty") + '</div>' +
      '</div>' +
      '<div class="clientCardArrow">›</div>';
    card.addEventListener("click", function () { openClient(client, color); });
    grid.appendChild(card);
  });

  allClientsData = clientMap;
}

// ---- OPEN CLIENT ----
function openClient(clientName, color) {
  currentClient = clientName;
  document.getElementById("homeView").classList.add("hidden");
  document.getElementById("clientView").classList.remove("hidden");
  document.getElementById("clientViewName").innerText = clientName;
  document.getElementById("clientViewInitial").innerText = clientInitial(clientName);
  document.getElementById("clientViewInitial").style.background = color;
  document.getElementById("clientView").style.setProperty("--current-client-color", color);
  document.querySelectorAll(".tabBtn").forEach(function (b) { b.classList.remove("active"); });
  document.querySelector('.tabBtn[data-tab="colors"]').classList.add("active");
  currentTab = "colors";
  updateTabUI();
  loadClientLibrary("colors");
}

// ---- BACK BUTTON ----
document.getElementById("backBtn").addEventListener("click", function () {
  currentClient = null;
  document.getElementById("clientView").classList.add("hidden");
  document.getElementById("homeView").classList.remove("hidden");
  document.getElementById("addForm").classList.add("hidden");
  document.getElementById("ffxForm").classList.add("hidden");
  document.getElementById("editForm").classList.add("hidden");
  loadAllClients();
});

// ---- CLIENT SEARCH ----
document.getElementById("clientSearch").addEventListener("input", loadAllClients);

// ---- ADD NEW CLIENT ----
document.getElementById("addClientBtn").addEventListener("click", function () {
  var form = document.getElementById("addClientForm");
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) document.getElementById("newClientName").focus();
});

document.getElementById("addClientCancelBtn").addEventListener("click", function () {
  document.getElementById("addClientForm").classList.add("hidden");
  document.getElementById("newClientName").value = "";
});

document.getElementById("addClientSaveBtn").addEventListener("click", function () {
  var name = document.getElementById("newClientName").value.trim();
  if (!name) { document.getElementById("newClientName").style.borderColor = "#ff5566"; return; }
  document.getElementById("newClientName").style.borderColor = "";
  // Create a placeholder doc to register the client
  db.collection("colors").add({ name: "__placeholder", hex: "#4c72ff", client: name, placeholder: true })
    .then(function () {
      document.getElementById("addClientForm").classList.add("hidden");
      document.getElementById("newClientName").value = "";
      loadAllClients();
      setTimeout(function () { openClient(name, clientColor(name)); }, 600);
    })
    .catch(function (err) { document.getElementById("newClientName").placeholder = "Error: " + err.message; });
});

// ---- TABS ----
document.querySelectorAll(".tabBtn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tabBtn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    currentTab = btn.getAttribute("data-tab");
    document.getElementById("addForm").classList.add("hidden");
    document.getElementById("ffxForm").classList.add("hidden");
    hideContextMenu();
    updateTabUI();
    loadClientLibrary(currentTab);
  });
});

function updateTabUI() {
  var isEffects = currentTab === "effects";
  var isFfxTab = isEffects || currentTab === "animations";
  document.getElementById("captureBtn").classList.toggle("hidden", isFfxTab);
  document.getElementById("ffxToggleBtn").classList.toggle("hidden", !isFfxTab);
  document.getElementById("quickCaptureBtn").classList.toggle("hidden", !isEffects);
  var hint = document.getElementById("shiftHint");
  if (currentTab === "colors") hint.classList.remove("hidden");
  else hint.classList.add("hidden");
}

// ---- LOAD CLIENT LIBRARY ----
function loadClientLibrary(tab) {
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = '<div style="color:#333348;padding:16px;text-align:center;font-size:11px;">Loading...</div>';
  db.collection(collectionMap[tab]).where("client", "==", currentClient).get()
    .then(function (snapshot) {
      currentData = [];
      snapshot.forEach(function (doc) {
        var data = doc.data();
        if (data.placeholder) return; // skip placeholders
        currentData.push({ id: doc.id, data: data });
      });
      document.getElementById("clientViewCount").innerText = currentData.length + " " + tab;
      if (currentData.length === 0) {
        contentEl.innerHTML = '<div style="color:#333348;padding:20px;text-align:center;font-size:11px;">No ' + tab + ' saved yet.<br>Use "+ Capture Layer" to add.</div>';
        return;
      }
      renderItems(currentData, tab);
    })
    .catch(function (err) {
      contentEl.innerHTML = '<div style="color:#ff5566;padding:12px;font-size:11px;">Error loading: ' + err.message + '</div>';
    });
}

// ---- CAPTURE BUTTON ----
document.getElementById("captureBtn").addEventListener("click", function () {
  var form = document.getElementById("addForm");
  if (!form.classList.contains("hidden")) { form.classList.add("hidden"); pendingCapture = null; return; }
  var captureCall = captureFunctionMap[currentTab];
  if (!captureCall) return;
  document.getElementById("output").innerText = "Capturing...";
  csInterface.evalScript(captureCall, function (resultStr) {
    var result;
    try { result = JSON.parse(resultStr); } catch (e) { document.getElementById("output").innerText = "Capture failed."; return; }
    if (result.error) { document.getElementById("output").innerText = "Failed: " + result.error; return; }
    pendingCapture = result;
    showCaptureForm(result);
    document.getElementById("output").innerText = "Captured — enter a name.";
  });
});

// ---- QUICK CAPTURE (effects) ----
document.getElementById("quickCaptureBtn").addEventListener("click", function () {
  var form = document.getElementById("addForm");
  if (!form.classList.contains("hidden")) { form.classList.add("hidden"); pendingCapture = null; return; }
  document.getElementById("output").innerText = "Capturing effect...";
  csInterface.evalScript("captureEffects()", function (resultStr) {
    var result;
    try { result = JSON.parse(resultStr); } catch (e) { document.getElementById("output").innerText = "Capture failed."; return; }
    if (result.error) { document.getElementById("output").innerText = "Failed: " + result.error; return; }
    pendingCapture = result;
    showCaptureForm(result);
    document.getElementById("output").innerText = "Effect captured — enter a name.";
  });
});

// ---- FFX TOGGLE ----
document.getElementById("ffxToggleBtn").addEventListener("click", function () {
  document.getElementById("ffxForm").classList.toggle("hidden");
  document.getElementById("addForm").classList.add("hidden");
});

function showCaptureForm(captured) {
  var form = document.getElementById("addForm");
  var preview = document.getElementById("capturePreview");
  form.classList.remove("hidden");
  document.getElementById("ffxForm").classList.add("hidden");
  if (currentTab === "colors") {
    preview.innerHTML = '<div class="swatch" style="background-color:' + captured.hex + '"></div><span>' + captured.hex + '</span>';
  } else if (currentTab === "fonts") {
    preview.innerHTML = '<span style="color:#e0e0f0;font-size:13px;font-weight:600;">' + captured.name + '</span>';
  } else if (currentTab === "textstyles") {
    var ec = (captured.effects ? captured.effects.length : 0) + (captured.layerStyles ? captured.layerStyles.length : 0);
    preview.innerHTML = '<div class="swatch" style="background-color:' + (captured.color || "#888") + '"></div><span>' + (captured.font || "") + ' ' + (captured.size || "") + (ec > 0 ? ' · ' + ec + ' fx' : '') + '</span>';
  } else if (currentTab === "effects") {
    preview.innerHTML = '<span style="color:#9966ff;">⚡ ' + (captured.name || "Effect") + '</span>';
  }
  document.getElementById("newName").value = "";
  document.getElementById("newName").focus();
}

document.getElementById("cancelBtn").addEventListener("click", function () {
  document.getElementById("addForm").classList.add("hidden");
  pendingCapture = null;
});

document.getElementById("saveBtn").addEventListener("click", function () {
  if (!pendingCapture) return;
  var name = document.getElementById("newName").value.trim();
  if (!name) { document.getElementById("output").innerText = "Please enter a name."; return; }
  var docData = Object.assign({}, pendingCapture, { name: name, client: currentClient });
  document.getElementById("output").innerText = "Saving...";
  db.collection(collectionMap[currentTab]).add(docData)
    .then(function () {
      document.getElementById("output").innerText = "Saved!";
      document.getElementById("addForm").classList.add("hidden");
      pendingCapture = null;
      loadClientLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
});

document.getElementById("ffxCancelBtn").addEventListener("click", function () {
  document.getElementById("ffxForm").classList.add("hidden");
  document.getElementById("ffxName").value = "";
  document.getElementById("ffxFilename").value = "";
});

document.getElementById("ffxSaveBtn").addEventListener("click", function () {
  var name = document.getElementById("ffxName").value.trim();
  var filename = document.getElementById("ffxFilename").value.trim();
  if (!name) { document.getElementById("output").innerText = "Please enter a name."; return; }
  if (!filename) { document.getElementById("output").innerText = "Please enter filename."; return; }
  if (filename.indexOf(".ffx") === -1) filename = filename + ".ffx";
  db.collection(collectionMap[currentTab]).add({
    name: name, client: currentClient, filename: filename, type: "ffx",
    url: GITHUB_RAW_BASE + "/presets/" + encodeURIComponent(filename)
  })
    .then(function () {
      document.getElementById("output").innerText = "Saved! Push " + filename + " to GitHub.";
      document.getElementById("ffxForm").classList.add("hidden");
      document.getElementById("ffxName").value = "";
      document.getElementById("ffxFilename").value = "";
      loadClientLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
});

// ---- EDIT FORM ----
document.getElementById("editCancelBtn").addEventListener("click", function () {
  document.getElementById("editForm").classList.add("hidden");
});

document.getElementById("editSaveBtn").addEventListener("click", function () {
  if (!activeContextId) return;
  var newName = document.getElementById("editName").value.trim();
  if (!newName) { document.getElementById("output").innerText = "Name cannot be empty."; return; }
  document.getElementById("output").innerText = "Updating...";
  db.collection(collectionMap[currentTab]).doc(activeContextId).update({ name: newName })
    .then(function () {
      document.getElementById("output").innerText = "Updated.";
      document.getElementById("editForm").classList.add("hidden");
      loadClientLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Update failed: " + err.message; });
});

// ---- HANDLER FACTORIES ----
function makeColorHandler(hexValue) {
  return function (e) {
    var script = e.shiftKey ? 'applyStrokeColor("' + hexValue + '")' : 'applyColorSmart("' + hexValue + '")';
    csInterface.evalScript(script, function (result) {
      document.getElementById("output").innerText = result;
    });
  };
}

function makeFontHandler(fontValue) {
  return function () {
    csInterface.evalScript('applyFont("' + fontValue + '")', function (result) {
      document.getElementById("output").innerText = result;
    });
  };
}

function makeTextStyleHandler(fontValue, sizeValue, colorValue, effectsJson) {
  return function () {
    var sizeNum = sizeValue.toString().replace("px", "");
    var escaped = effectsJson.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    csInterface.evalScript('applyTextStyle("' + fontValue + '", ' + sizeNum + ', "' + colorValue + '", "' + escaped + '")', function (result) {
      document.getElementById("output").innerText = result;
    });
  };
}

function makeFfxHandler(url, filename) {
  return function () {
    var outputEl = document.getElementById("output");
    outputEl.innerText = "Downloading...";
    fetch(url + "?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("Not on GitHub yet — push " + filename + " to presets/");
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        var presetsTemp = nodeOs.homedir() + "/Documents/DopeTool_Presets";
        if (!nodeFs.existsSync(presetsTemp)) nodeFs.mkdirSync(presetsTemp, { recursive: true });
        var localPath = presetsTemp + "/" + filename;
        try { nodeFs.writeFileSync(localPath, Buffer.from(new Uint8Array(buffer))); }
        catch (e) { outputEl.innerText = "Write failed: " + e.message; return; }
        var escapedPath = localPath.replace(/ /g, "\\ ");
        csInterface.evalScript('applyFfxPreset("' + escapedPath + '")', function (result) {
          outputEl.innerText = result;
        });
      })
      .catch(function (err) { outputEl.innerText = "Download failed: " + err.message; });
  };
}

function makeEffectWithPropsHandler(effectData) {
  return function () {
    var escaped = JSON.stringify(effectData).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    csInterface.evalScript('applyEffectWithProps("' + escaped + '")', function (result) {
      document.getElementById("output").innerText = result;
    });
  };
}

// ---- RENDER ITEMS ----
function renderItems(items, tab) {
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = "";
  if (items.length === 0) {
    contentEl.innerHTML = '<div style="color:#333348;padding:20px;text-align:center;font-size:11px;">No items</div>';
    return;
  }
  for (var idx = 0; idx < items.length; idx++) {
    var entry = items[idx];
    var data = entry.data;
    var card = document.createElement("div");
    card.className = "card";

    if (tab === "colors") {
      card.innerHTML =
        '<div class="swatch" style="background-color:' + data.hex + '"></div>' +
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + data.hex + '</div></div>';
      card.addEventListener("click", makeColorHandler(data.hex));
    } else if (tab === "fonts") {
      card.innerHTML =
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + (data.weight || "Regular") + '</div></div>';
      card.addEventListener("click", makeFontHandler(data.name));
    } else if (tab === "textstyles") {
      var ec = (data.effects ? data.effects.length : 0) + (data.layerStyles ? data.layerStyles.length : 0);
      card.innerHTML =
        '<div class="swatch" style="background-color:' + (data.color || "#888") + '"></div>' +
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + (data.font || "") + ' · ' + (data.size || "") + (ec > 0 ? ' · ' + ec + ' fx' : '') + '</div></div>';
      var allFx = (data.effects || []).concat(data.layerStyles || []);
      card.addEventListener("click", makeTextStyleHandler(data.font, data.size, data.color, JSON.stringify(allFx)));
    } else if (tab === "effects") {
      var isFFX = data.type === "ffx";
      card.innerHTML =
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + (isFFX ? "FFX Preset" : "Captured Effect") + '</div></div>' +
        '<span class="badge' + (isFFX ? " ffx" : "") + '">' + (isFFX ? "FFX" : "FX") + '</span>';
      if (isFFX) card.addEventListener("click", makeFfxHandler(data.url, data.filename));
      else card.addEventListener("click", makeEffectWithPropsHandler({ matchName: data.matchName || data.type, props: data.props || [] }));
    } else if (tab === "animations") {
      card.innerHTML =
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">Animation Preset</div></div>' +
        '<span class="badge anim">ANIM</span>';
      card.addEventListener("click", makeFfxHandler(data.url, data.filename));
    }

    addLongPressHandler(card, entry);
    contentEl.appendChild(card);
  }
}

// ---- LONG PRESS + CONTEXT MENU ----
function addLongPressHandler(element, entryRef) {
  var timer = null;
  var didLongPress = false;
  element.addEventListener("mousedown", function (e) {
    didLongPress = false;
    timer = setTimeout(function () {
      didLongPress = true;
      activeContextId = entryRef.id;
      activeContextItem = entryRef.data;
      showContextMenu(e.pageX, e.pageY);
    }, 600);
  });
  element.addEventListener("mouseup", function () { clearTimeout(timer); });
  element.addEventListener("mouseleave", function () { clearTimeout(timer); });
  element.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    activeContextId = entryRef.id;
    activeContextItem = entryRef.data;
    showContextMenu(e.pageX, e.pageY);
  });
  element.addEventListener("click", function (e) {
    if (didLongPress) { e.stopImmediatePropagation(); didLongPress = false; }
  }, true);
}

function showContextMenu(x, y) {
  var menu = document.getElementById("contextMenu");
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.classList.remove("hidden");
}
function hideContextMenu() { document.getElementById("contextMenu").classList.add("hidden"); }
document.addEventListener("click", hideContextMenu);

document.getElementById("ctxDelete").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeContextId) return;
  document.getElementById("output").innerText = "Deleting...";
  db.collection(collectionMap[currentTab]).doc(activeContextId).delete()
    .then(function () {
      document.getElementById("output").innerText = "Deleted.";
      hideContextMenu();
      loadClientLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Delete failed: " + err.message; });
});

document.getElementById("ctxEdit").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeContextId || !activeContextItem) return;
  hideContextMenu();
  document.getElementById("editName").value = activeContextItem.name || "";
  document.getElementById("editForm").classList.remove("hidden");
});

// ---- AUTO UPDATE ----
function getLocalVersion() {
  try { return JSON.parse(nodeFs.readFileSync(localVersionPath, "utf8")).version || "0.0.0"; }
  catch (e) { return "0.0.0"; }
}
function setLocalVersion(v) {
  try { nodeFs.writeFileSync(localVersionPath, JSON.stringify({ version: v }), "utf8"); } catch (e) {}
}

function checkForUpdate() {
  var localVersion = getLocalVersion();
  fetch(GITHUB_RAW_BASE + "/version.json?t=" + Date.now())
    .then(function (res) { return res.json(); })
    .then(function (data) { if (data.version && data.version !== localVersion) showUpdateBanner(data.version); })
    .catch(function () {});
}

function showUpdateBanner(newVersion) {
  if (document.getElementById("updateBanner")) return;
  var banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.innerHTML = '<span>Update v' + newVersion + ' available</span><button id="updateNowBtn">Update</button>';
  document.body.insertBefore(banner, document.body.firstChild);
  document.getElementById("updateNowBtn").addEventListener("click", function () { performUpdate(newVersion); });
}

function performUpdate(newVersion) {
  var banner = document.getElementById("updateBanner");
  banner.innerHTML = '<span>Updating...</span>';
  var files = [
    { remote: "/index.html", local: "/index.html" },
    { remote: "/js/main.js", local: "/js/main.js" },
    { remote: "/css/style.css", local: "/css/style.css" },
    { remote: "/jsx/hostscript.jsx", local: "/jsx/hostscript.jsx" }
  ];
  var done = 0; var failed = [];
  files.forEach(function (file) {
    fetch(GITHUB_RAW_BASE + file.remote + "?t=" + Date.now())
      .then(function (res) { return res.text(); })
      .then(function (content) {
        nodeFs.writeFileSync(extensionPath + file.local, content, "utf8");
        done++;
        if (done + failed.length === files.length) finishUpdate(newVersion, banner, failed);
      })
      .catch(function () {
        failed.push(file.local); done++;
        if (done + failed.length === files.length) finishUpdate(newVersion, banner, failed);
      });
  });
}

function finishUpdate(newVersion, banner, failed) {
  if (failed.length > 0) {
    banner.innerHTML = '<span>Update partially failed: ' + failed.join(", ") + '</span>';
  } else {
    setLocalVersion(newVersion);
    banner.innerHTML = '<span>✓ Updated to v' + newVersion + ' — reopen DopeTool</span>';
  }
}

// ---- INIT ----
window.addEventListener("DOMContentLoaded", function () {
  setTimeout(checkForUpdate, 1000);
  setTimeout(loadAllClients, 300);
});
