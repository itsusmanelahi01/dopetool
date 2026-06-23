var csInterface = new CSInterface();

document.getElementById("output").innerText = "Panel loaded OK";

document.getElementById("testBtn").addEventListener("click", function () {
  document.getElementById("output").innerText = "Calling AE...";
  csInterface.evalScript("testConnection()", function (result) {
    document.getElementById("output").innerText = result;
  });
});

var currentTab = "colors";
var currentData = [];
var pendingCapture = null;
var activeContextId = null;
var activeContextItem = null;

var collectionMap = {
  colors: "colors",
  fonts: "fonts",
  textstyles: "textstyles",
  effects: "effects"
};

var captureFunctionMap = {
  colors: "captureColor()",
  fonts: "captureFont()",
  textstyles: "captureTextStyle()",
  effects: "captureEffects()"
};

var GITHUB_RAW_BASE = "https://raw.githubusercontent.com/itsusmanelahi01/dopetool/main";
var nodeFs = require("fs");
var extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
var localVersionPath = extensionPath + "/local_version.json";

function updateTabUI() {
  var isEffects = currentTab === "effects";
  document.getElementById("captureBtn").classList.toggle("hidden", isEffects);
  document.getElementById("ffxToggleBtn").classList.toggle("hidden", !isEffects);
  document.getElementById("addForm").classList.add("hidden");
  document.getElementById("ffxForm").classList.add("hidden");
  pendingCapture = null;
}

document.querySelectorAll(".tabBtn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tabBtn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    currentTab = btn.getAttribute("data-tab");
    document.getElementById("searchBox").value = "";
    document.getElementById("clientFilter").value = "";
    hideContextMenu();
    updateTabUI();
    loadLibrary(currentTab);
  });
});

document.getElementById("searchBox").addEventListener("input", applyFilters);
document.getElementById("clientFilter").addEventListener("change", applyFilters);

function applyFilters() {
  var query = document.getElementById("searchBox").value.toLowerCase();
  var selectedClient = document.getElementById("clientFilter").value;
  var filtered = currentData.filter(function (item) {
    var matchesSearch = JSON.stringify(item.data).toLowerCase().indexOf(query) !== -1;
    var matchesClient = !selectedClient || item.data.client === selectedClient;
    return matchesSearch && matchesClient;
  });
  renderItems(filtered, currentTab);
}

function populateClientFilter(items) {
  var select = document.getElementById("clientFilter");
  var currentValue = select.value;
  var clients = [];
  items.forEach(function (item) {
    if (item.data.client && clients.indexOf(item.data.client) === -1) clients.push(item.data.client);
  });
  clients.sort();
  select.innerHTML = '<option value="">All Clients</option>';
  clients.forEach(function (client) {
    var opt = document.createElement("option");
    opt.value = client;
    opt.innerText = client;
    select.appendChild(opt);
  });
  if (clients.indexOf(currentValue) !== -1) select.value = currentValue;
}

// ---- Capture button (colors/fonts/textstyles) ----
document.getElementById("captureBtn").addEventListener("click", function () {
  var form = document.getElementById("addForm");
  if (!form.classList.contains("hidden")) { form.classList.add("hidden"); pendingCapture = null; return; }
  var captureCall = captureFunctionMap[currentTab];
  document.getElementById("output").innerText = "Capturing from selected layer...";
  csInterface.evalScript(captureCall, function (resultStr) {
    var result;
    try { result = JSON.parse(resultStr); }
    catch (e) { document.getElementById("output").innerText = "Capture failed."; return; }
    if (result.error) { document.getElementById("output").innerText = "Capture failed: " + result.error; return; }
    pendingCapture = result;
    showCaptureForm(result);
    document.getElementById("output").innerText = "Captured. Fill in name and client, then save.";
  });
});

// ---- FFX toggle button (effects tab) ----
document.getElementById("ffxToggleBtn").addEventListener("click", function () {
  var form = document.getElementById("ffxForm");
  form.classList.toggle("hidden");
});

function showCaptureForm(captured) {
  var form = document.getElementById("addForm");
  var preview = document.getElementById("capturePreview");
  form.classList.remove("hidden");
  if (currentTab === "colors") {
    preview.innerHTML = '<div class="swatch" style="background-color:' + captured.hex + '"></div><span>' + captured.hex + '</span>';
  } else if (currentTab === "fonts") {
    preview.innerHTML = '<span>' + captured.name + '</span>';
  } else if (currentTab === "textstyles") {
    var effectCount = ((captured.effects ? captured.effects.length : 0) + (captured.layerStyles ? captured.layerStyles.length : 0));
    preview.innerHTML = '<div class="swatch" style="background-color:' + (captured.color || "#888") + '"></div><span>' + (captured.font || "") + ' \u00b7 ' + (captured.size || "") + (effectCount > 0 ? ' \u00b7 ' + effectCount + ' fx' : '') + '</span>';
  }
  document.getElementById("newName").value = "";
  document.getElementById("newClient").value = "";
  document.getElementById("newName").focus();
}

document.getElementById("cancelBtn").addEventListener("click", function () {
  document.getElementById("addForm").classList.add("hidden");
  pendingCapture = null;
});

document.getElementById("saveBtn").addEventListener("click", function () {
  if (!pendingCapture) return;
  var name = document.getElementById("newName").value.trim();
  var client = document.getElementById("newClient").value.trim();
  if (!name) { document.getElementById("output").innerText = "Please enter a name."; return; }
  var docData = Object.assign({}, pendingCapture, { name: name, client: client || "General" });
  document.getElementById("output").innerText = "Saving...";
  db.collection(collectionMap[currentTab]).add(docData)
    .then(function () {
      document.getElementById("output").innerText = "Saved!";
      document.getElementById("addForm").classList.add("hidden");
      pendingCapture = null;
      loadLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
});

document.getElementById("ffxCancelBtn").addEventListener("click", function () {
  document.getElementById("ffxForm").classList.add("hidden");
  document.getElementById("ffxName").value = "";
  document.getElementById("ffxClient").value = "";
  document.getElementById("ffxFilename").value = "";
});

document.getElementById("ffxSaveBtn").addEventListener("click", function () {
  var name = document.getElementById("ffxName").value.trim();
  var client = document.getElementById("ffxClient").value.trim();
  var filename = document.getElementById("ffxFilename").value.trim();
  if (!name) { document.getElementById("output").innerText = "Please enter a name."; return; }
  if (!filename) { document.getElementById("output").innerText = "Please enter the .ffx filename."; return; }
  if (filename.indexOf(".ffx") === -1) filename = filename + ".ffx";
  var docData = {
    name: name,
    client: client || "General",
    filename: filename,
    type: "ffx",
    url: GITHUB_RAW_BASE + "/presets/" + filename
  };
  document.getElementById("output").innerText = "Saving...";
  db.collection("effects").add(docData)
    .then(function () {
      document.getElementById("output").innerText = "Saved! Push " + filename + " to GitHub presets/ folder.";
      document.getElementById("ffxForm").classList.add("hidden");
      document.getElementById("ffxName").value = "";
      document.getElementById("ffxClient").value = "";
      document.getElementById("ffxFilename").value = "";
      loadLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
});

function loadLibrary(tab) {
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = "Loading...";
  db.collection(collectionMap[tab]).get()
    .then(function (snapshot) {
      currentData = [];
      snapshot.forEach(function (doc) { currentData.push({ id: doc.id, data: doc.data() }); });
      populateClientFilter(currentData);
      if (currentData.length === 0) { contentEl.innerHTML = "No items yet."; return; }
      renderItems(currentData, tab);
    })
    .catch(function (err) { contentEl.innerHTML = "Error: " + err.message; });
}

function makeColorHandler(hexValue) {
  return function () { applyToAE('applyColor("' + hexValue + '")'); };
}
function makeFontHandler(fontValue) {
  return function () { applyToAE('applyFont("' + fontValue + '")'); };
}
function makeTextStyleHandler(fontValue, sizeValue, colorValue, effectsJson) {
  return function () {
    var sizeNum = sizeValue.toString().replace("px", "");
    var escaped = effectsJson.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    applyToAE('applyTextStyle("' + fontValue + '", ' + sizeNum + ', "' + colorValue + '", "' + escaped + '")');
  };
}

function makeFfxHandler(url, filename) {
  return function () {
    var outputEl = document.getElementById("output");
    outputEl.innerText = "Downloading preset...";
    fetch(url + "?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("File not found on GitHub. Push it to presets/ folder first.");
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        csInterface.evalScript("getPresetsFolder()", function (presetsFolder) {
          if (!presetsFolder || presetsFolder.indexOf("ERROR") !== -1) {
            outputEl.innerText = "Could not find AE presets folder.";
            return;
          }
          var localPath = (presetsFolder + "/" + filename).replace(/\\/g, "/");
          var uint8 = new Uint8Array(buffer);
          var binary = "";
          for (var i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
          var base64 = btoa(binary);
          var writeScript = [
            'var f = new File("' + localPath + '");',
            'f.encoding = "BINARY";',
            'f.open("w");',
            'var b64 = "' + base64 + '";',
            'var map = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";',
            'var bin = "";',
            'for(var i = 0; i < b64.length; i += 4) {',
            '  var a=map.indexOf(b64[i]),b=map.indexOf(b64[i+1]),c=map.indexOf(b64[i+2]),d=map.indexOf(b64[i+3]);',
            '  bin+=String.fromCharCode((a<<2)|(b>>4));',
            '  if(b64[i+2]!=="=")bin+=String.fromCharCode(((b&15)<<4)|(c>>2));',
            '  if(b64[i+3]!=="=")bin+=String.fromCharCode(((c&3)<<6)|d);',
            '}',
            'f.write(bin); f.close(); "written"'
          ].join("\n");
          csInterface.evalScript(writeScript, function (writeResult) {
            if (writeResult !== "written") { outputEl.innerText = "Write failed: " + writeResult; return; }
            csInterface.evalScript('applyFfxPreset("' + localPath + '")', function (applyResult) {
              outputEl.innerText = applyResult;
            });
          });
        });
      })
      .catch(function (err) { outputEl.innerText = "Download failed: " + err.message; });
  };
}

function makeEffectWithPropsHandler(effectData) {
  return function () {
    var escaped = JSON.stringify(effectData).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    applyToAE('applyEffectWithProps("' + escaped + '")');
  };
}

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

function renderItems(items, tab) {
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = "";
  if (items.length === 0) { contentEl.innerHTML = "No matches."; return; }

  for (var idx = 0; idx < items.length; idx++) {
    var entry = items[idx];
    var data = entry.data;
    var card = document.createElement("div");
    card.className = "card clickable";

    if (tab === "colors") {
      card.innerHTML =
        '<div class="swatch" style="background-color:' + data.hex + '"></div>' +
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + data.hex + ' \u00b7 ' + data.client + '</div></div>';
      card.addEventListener("click", makeColorHandler(data.hex));
    } else if (tab === "fonts") {
      card.innerHTML =
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + (data.weight || "") + ' \u00b7 ' + data.client + '</div></div>';
      card.addEventListener("click", makeFontHandler(data.name));
    } else if (tab === "textstyles") {
      var effectCount = ((data.effects ? data.effects.length : 0) + (data.layerStyles ? data.layerStyles.length : 0));
      var effectsBadge = effectCount > 0 ? ' \u00b7 ' + effectCount + ' fx' : '';
      card.innerHTML =
        '<div class="swatch" style="background-color:' + (data.color || "#888") + '"></div>' +
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + data.font + ' \u00b7 ' + data.size + effectsBadge + ' \u00b7 ' + data.client + '</div></div>';
      var allEffects = (data.effects || []).concat(data.layerStyles || []);
      card.addEventListener("click", makeTextStyleHandler(data.font, data.size, data.color, JSON.stringify(allEffects)));
    } else if (tab === "effects") {
      var badge = data.type === "ffx" ? "\u2605 FFX" : "Effect";
      card.innerHTML =
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + badge + ' \u00b7 ' + data.client + '</div></div>';
      if (data.type === "ffx") {
        card.addEventListener("click", makeFfxHandler(data.url, data.filename));
      } else {
        card.addEventListener("click", makeEffectWithPropsHandler({ matchName: data.matchName || data.type, props: data.props || [] }));
      }
    }

    addLongPressHandler(card, entry);
    contentEl.appendChild(card);
  }
}

function showContextMenu(x, y) {
  var menu = document.getElementById("contextMenu");
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.classList.remove("hidden");
}
function hideContextMenu() {
  document.getElementById("contextMenu").classList.add("hidden");
}
document.addEventListener("click", function () { hideContextMenu(); });

document.getElementById("ctxDelete").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeContextId) return;
  document.getElementById("output").innerText = "Deleting...";
  db.collection(collectionMap[currentTab]).doc(activeContextId).delete()
    .then(function () {
      document.getElementById("output").innerText = "Deleted.";
      hideContextMenu();
      loadLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Delete failed: " + err.message; });
});

document.getElementById("ctxEdit").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeContextId || !activeContextItem) return;
  hideContextMenu();
  document.getElementById("editName").value = activeContextItem.name || "";
  document.getElementById("editClient").value = activeContextItem.client || "";
  document.getElementById("editForm").classList.remove("hidden");
});

document.getElementById("editCancelBtn").addEventListener("click", function () {
  document.getElementById("editForm").classList.add("hidden");
});

document.getElementById("editSaveBtn").addEventListener("click", function () {
  if (!activeContextId) return;
  var newName = document.getElementById("editName").value.trim();
  var newClient = document.getElementById("editClient").value.trim();
  if (!newName) { document.getElementById("output").innerText = "Name cannot be empty."; return; }
  document.getElementById("output").innerText = "Updating...";
  db.collection(collectionMap[currentTab]).doc(activeContextId).update({
    name: newName, client: newClient || "General"
  })
    .then(function () {
      document.getElementById("output").innerText = "Updated.";
      document.getElementById("editForm").classList.add("hidden");
      loadLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Update failed: " + err.message; });
});

function applyToAE(scriptCall) {
  csInterface.evalScript(scriptCall, function (result) {
    document.getElementById("output").innerText = result;
  });
}

function getLocalVersion() {
  try { return JSON.parse(nodeFs.readFileSync(localVersionPath, "utf8")).version || "0.0.0"; }
  catch (e) { return "0.0.0"; }
}
function setLocalVersion(version) {
  try { nodeFs.writeFileSync(localVersionPath, JSON.stringify({ version: version }), "utf8"); }
  catch (e) {}
}

function checkForUpdate() {
  var localVersion = getLocalVersion();
  fetch(GITHUB_RAW_BASE + "/version.json?t=" + Date.now())
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.version && data.version !== localVersion) showUpdateBanner(data.version);
    })
    .catch(function () {});
}

function showUpdateBanner(newVersion) {
  if (document.getElementById("updateBanner")) return;
  var banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.innerHTML = '<span>Update available: v' + newVersion + '</span><button id="updateNowBtn">Update Now</button>';
  document.body.insertBefore(banner, document.body.firstChild);
  document.getElementById("updateNowBtn").addEventListener("click", function () { performUpdate(newVersion); });
}

function performUpdate(newVersion) {
  var banner = document.getElementById("updateBanner");
  banner.innerHTML = '<span>Updating... please wait</span>';
  var filesToUpdate = [
    { remote: "/index.html", local: "/index.html" },
    { remote: "/js/main.js", local: "/js/main.js" },
    { remote: "/css/style.css", local: "/css/style.css" },
    { remote: "/jsx/hostscript.jsx", local: "/jsx/hostscript.jsx" }
  ];
  var completed = 0;
  var failed = [];
  filesToUpdate.forEach(function (file) {
    fetch(GITHUB_RAW_BASE + file.remote + "?t=" + Date.now())
      .then(function (res) { return res.text(); })
      .then(function (content) {
        nodeFs.writeFileSync(extensionPath + file.local, content, "utf8");
        completed++;
        if (completed + failed.length === filesToUpdate.length) finishUpdate(newVersion, banner, failed);
      })
      .catch(function () {
        failed.push(file.local);
        completed++;
        if (completed + failed.length === filesToUpdate.length) finishUpdate(newVersion, banner, failed);
      });
  });
}

function finishUpdate(newVersion, banner, failed) {
  if (failed.length > 0) {
    banner.innerHTML = '<span>Update partially failed: ' + failed.join(", ") + '</span>';
  } else {
    setLocalVersion(newVersion);
    banner.innerHTML = '<span>Updated to v' + newVersion + '! Close and reopen DopeTool.</span>';
  }
}

window.addEventListener("DOMContentLoaded", function () {
  updateTabUI();
  setTimeout(checkForUpdate, 1000);
  setTimeout(function () { loadLibrary(currentTab); }, 300);
});
