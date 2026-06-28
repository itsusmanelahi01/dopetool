// DopeTool main.js — v2.3.1

var csInterface = new CSInterface();
var currentTab = "colors";
var currentClient = null;
var currentData = [];
var allClientsData = {};
var pendingCapture = null;
var activeContextId = null;
var activeContextItem = null;
var activeClientName = null;
var selectedCaptionStyle = null;
var currentSrtPath = "";

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
var nodePath = require("path");
var extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
var localVersionPath = extensionPath + "/local_version.json";

// ---- PATH UTILITIES ----
// Always convert to forward slashes for ExtendScript File() — works on Mac and Windows
function toJsxPath(p) {
  // On Windows, CEP returns paths like /C/Users/... — convert to C:/Users/...
  p = p.replace(/\\/g, "/");
  if (/^\/[A-Za-z]\//.test(p)) {
    p = p.charAt(1).toUpperCase() + ":" + p.slice(2);
  }
  return p;
}

function getPresetsDir() {
  return nodePath.join(nodeOs.homedir(), "Documents", "DopeTool_Presets");
}

// ---- VERSION ----
function getLocalVersion() {
  try { return JSON.parse(nodeFs.readFileSync(localVersionPath, "utf8")).version || "0.0.0"; }
  catch (e) { return "0.0.0"; }
}
function setLocalVersion(v) {
  try { nodeFs.writeFileSync(localVersionPath, JSON.stringify({ version: v }), "utf8"); } catch (e) {}
}
function showVersion() {
  var v = getLocalVersion();
  var tag = document.getElementById("versionTag");
  if (tag) tag.innerText = "v" + v;
  var hubTag = document.getElementById("hubVersion");
  if (hubTag) hubTag.innerText = "v" + v;
}

function clientColor(name) {
  var colors = ["#4c72ff","#ff5577","#33cc88","#ff9944","#aa55ff","#00cccc","#ff4488","#66bb33","#ff6644","#4499ff","#cc44aa","#88cc00"];
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function clientInitial(name) { return name.trim().charAt(0).toUpperCase(); }

// ---- VIEW NAVIGATION ----
function showView(viewId) {
  var views = ["hubView","homeView","clientView","captionView"];
  views.forEach(function (v) {
    document.getElementById(v).classList.toggle("hidden", v !== viewId);
  });
}

// ---- TOOL HUB ----
document.getElementById("openLibraryBtn").addEventListener("click", function () {
  showView("homeView");
  loadAllClients();
});

document.getElementById("openCaptionBtn").addEventListener("click", function () {
  showView("captionView");
  loadCaptionStyles();
});

document.getElementById("backToHubBtn").addEventListener("click", function () { showView("hubView"); });
document.getElementById("backToCaptionHubBtn").addEventListener("click", function () { showView("hubView"); });

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
          if (data.placeholder) return;
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
    addClientLongPress(card, client);
    grid.appendChild(card);
  });
  allClientsData = clientMap;
}

// ---- CLIENT LONG PRESS ----
function addClientLongPress(element, clientName) {
  var timer = null;
  var didLongPress = false;
  element.addEventListener("mousedown", function (e) {
    didLongPress = false;
    timer = setTimeout(function () {
      didLongPress = true;
      activeClientName = clientName;
      showClientContextMenu(e.pageX, e.pageY);
    }, 600);
  });
  element.addEventListener("mouseup", function () { clearTimeout(timer); });
  element.addEventListener("mouseleave", function () { clearTimeout(timer); });
  element.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    activeClientName = clientName;
    showClientContextMenu(e.pageX, e.pageY);
  });
  element.addEventListener("click", function (e) {
    if (didLongPress) { e.stopImmediatePropagation(); didLongPress = false; }
  }, true);
}

function showClientContextMenu(x, y) {
  hideContextMenu();
  var menu = document.getElementById("clientContextMenu");
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.classList.remove("hidden");
}

document.addEventListener("click", function () {
  hideContextMenu();
  document.getElementById("clientContextMenu").classList.add("hidden");
});

document.getElementById("ctxClientRename").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeClientName) return;
  document.getElementById("clientContextMenu").classList.add("hidden");
  document.getElementById("clientRenameName").value = activeClientName;
  document.getElementById("clientRenameForm").classList.remove("hidden");
  document.getElementById("clientRenameName").focus();
});

document.getElementById("clientRenameCancelBtn").addEventListener("click", function () {
  document.getElementById("clientRenameForm").classList.add("hidden");
  activeClientName = null;
});

document.getElementById("clientRenameSaveBtn").addEventListener("click", function () {
  var newName = document.getElementById("clientRenameName").value.trim();
  if (!newName || !activeClientName) return;
  if (newName === activeClientName) { document.getElementById("clientRenameForm").classList.add("hidden"); return; }
  var collections = ["colors","fonts","textstyles","effects","animations"];
  var pending = collections.length;
  var oldName = activeClientName;
  collections.forEach(function (col) {
    db.collection(col).where("client", "==", oldName).get()
      .then(function (snapshot) {
        var batch = db.batch();
        snapshot.forEach(function (doc) { batch.update(doc.ref, { client: newName }); });
        return batch.commit();
      })
      .then(function () {
        pending--;
        if (pending === 0) {
          document.getElementById("clientRenameForm").classList.add("hidden");
          activeClientName = null;
          loadAllClients();
        }
      })
      .catch(function () { pending--; });
  });
});

document.getElementById("ctxClientDelete").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeClientName) return;
  document.getElementById("clientContextMenu").classList.add("hidden");
  var confirmed = confirm("Delete client \"" + activeClientName + "\" and ALL their items? This cannot be undone.");
  if (!confirmed) return;
  var collections = ["colors","fonts","textstyles","effects","animations"];
  var pending = collections.length;
  var clientToDelete = activeClientName;
  collections.forEach(function (col) {
    db.collection(col).where("client", "==", clientToDelete).get()
      .then(function (snapshot) {
        var batch = db.batch();
        snapshot.forEach(function (doc) { batch.delete(doc.ref); });
        return batch.commit();
      })
      .then(function () { pending--; if (pending === 0) { activeClientName = null; loadAllClients(); } })
      .catch(function () { pending--; });
  });
});

// ---- OPEN CLIENT ----
function openClient(clientName, color) {
  currentClient = clientName;
  showView("clientView");
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

document.getElementById("backBtn").addEventListener("click", function () {
  currentClient = null;
  document.getElementById("addForm").classList.add("hidden");
  document.getElementById("ffxForm").classList.add("hidden");
  document.getElementById("ffxStyleForm").classList.add("hidden");
  document.getElementById("editForm").classList.add("hidden");
  showView("homeView");
  loadAllClients();
});

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
    document.getElementById("ffxStyleForm").classList.add("hidden");
    hideContextMenu();
    updateTabUI();
    loadClientLibrary(currentTab);
  });
});

function updateTabUI() {
  var isEffects = currentTab === "effects";
  var isAnimations = currentTab === "animations";
  var isTextStyles = currentTab === "textstyles";
  var isFfxTab = isEffects || isAnimations;
  document.getElementById("captureBtn").classList.toggle("hidden", isFfxTab);
  document.getElementById("ffxToggleBtn").classList.toggle("hidden", !isFfxTab);
  document.getElementById("quickCaptureBtn").classList.toggle("hidden", !isEffects);
  document.getElementById("ffxStyleToggleBtn").classList.toggle("hidden", !isTextStyles);
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
        if (data.placeholder) return;
        currentData.push({ id: doc.id, data: data });
      });
      document.getElementById("clientViewCount").innerText = currentData.length + " " + tab;
      if (currentData.length === 0) {
        contentEl.innerHTML = '<div style="color:#333348;padding:20px;text-align:center;font-size:11px;">No ' + tab + ' saved yet.<br>Use the buttons above to add.</div>';
        return;
      }
      renderItems(currentData, tab);
    })
    .catch(function (err) {
      contentEl.innerHTML = '<div style="color:#ff5566;padding:12px;font-size:11px;">Error: ' + err.message + '</div>';
    });
}

// ---- CAPTURE ----
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

document.getElementById("ffxToggleBtn").addEventListener("click", function () {
  document.getElementById("ffxForm").classList.toggle("hidden");
  document.getElementById("addForm").classList.add("hidden");
  document.getElementById("ffxStyleForm").classList.add("hidden");
});

document.getElementById("ffxStyleToggleBtn").addEventListener("click", function () {
  document.getElementById("ffxStyleForm").classList.toggle("hidden");
  document.getElementById("addForm").classList.add("hidden");
  document.getElementById("ffxForm").classList.add("hidden");
});

document.getElementById("ffxStyleCancelBtn").addEventListener("click", function () {
  document.getElementById("ffxStyleForm").classList.add("hidden");
  document.getElementById("ffxStyleName").value = "";
  document.getElementById("ffxStyleFilename").value = "";
});

document.getElementById("ffxStyleSaveBtn").addEventListener("click", function () {
  var name = document.getElementById("ffxStyleName").value.trim();
  var filename = document.getElementById("ffxStyleFilename").value.trim();
  if (!name) { document.getElementById("output").innerText = "Please enter a name."; return; }
  if (!filename) { document.getElementById("output").innerText = "Please enter filename."; return; }
  if (filename.indexOf(".ffx") === -1) filename = filename + ".ffx";
  db.collection("textstyles").add({
    name: name, client: currentClient, filename: filename, type: "ffx",
    url: GITHUB_RAW_BASE + "/presets/" + encodeURIComponent(filename)
  })
    .then(function () {
      document.getElementById("output").innerText = "Saved! Push " + filename + " to GitHub presets/.";
      document.getElementById("ffxStyleForm").classList.add("hidden");
      document.getElementById("ffxStyleName").value = "";
      document.getElementById("ffxStyleFilename").value = "";
      loadClientLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
});

function showCaptureForm(captured) {
  var form = document.getElementById("addForm");
  var preview = document.getElementById("capturePreview");
  form.classList.remove("hidden");
  document.getElementById("ffxForm").classList.add("hidden");
  document.getElementById("ffxStyleForm").classList.add("hidden");
  if (currentTab === "colors") {
    preview.innerHTML = '<div class="swatch" style="background-color:' + captured.hex + '"></div><span>' + captured.hex + '</span>';
  } else if (currentTab === "fonts") {
    preview.innerHTML = '<span style="color:#e0e0f0;font-size:13px;font-weight:600;">' + captured.name + '</span>';
  } else if (currentTab === "textstyles") {
    var ec = (captured.effects ? captured.effects.length : 0) + (captured.layerStyles ? captured.layerStyles.length : 0);
    preview.innerHTML =
      '<div class="swatch" style="background-color:' + (captured.color || "#888") + '"></div>' +
      '<span>' + (captured.font || "") + ' ' + (captured.fontSize || "") + 'px' +
      (captured.tracking ? ' · tr:' + captured.tracking : '') +
      (ec > 0 ? ' · ' + ec + ' fx' : '') + '</span>';
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
      document.getElementById("output").innerText = "Saved! Push " + filename + " to GitHub presets/.";
      document.getElementById("ffxForm").classList.add("hidden");
      document.getElementById("ffxName").value = "";
      document.getElementById("ffxFilename").value = "";
      loadClientLibrary(currentTab);
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
});

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

// ---- CAPTION IMPORTER ----
function loadCaptionStyles() {
  var grid = document.getElementById("captionStyleGrid");
  grid.innerHTML = '<div style="color:#333348;font-size:11px;padding:8px;">Loading styles...</div>';
  selectedCaptionStyle = null;

  db.collection("textstyles").get()
    .then(function (snapshot) {
      var styles = [];
      snapshot.forEach(function (doc) {
        var data = doc.data();
        if (data.placeholder || data.type === "ffx") return;
        styles.push(data);
      });

      if (styles.length === 0) {
        grid.innerHTML = '<div style="color:#333348;font-size:11px;padding:8px;">No text styles saved yet.<br>Add styles in the Style Library first.</div>';
        return;
      }

      grid.innerHTML = "";
      styles.forEach(function (style) {
        var card = document.createElement("div");
        card.className = "captionStyleCard";
        card.innerHTML =
          '<div class="captionSwatch" style="background-color:' + (style.color || "#888") + '"></div>' +
          '<div class="captionStyleInfo">' +
            '<div class="captionStyleName">' + style.name + '</div>' +
            '<div class="captionStyleMeta">' + (style.font || "") + ' · ' + (style.fontSize || "") + 'px · ' + (style.client || "") + '</div>' +
          '</div>';

        card.addEventListener("click", function () {
          document.querySelectorAll(".captionStyleCard").forEach(function (c) { c.classList.remove("selected"); });
          card.classList.add("selected");
          selectedCaptionStyle = style;
          document.getElementById("captionStatus").innerText = "Style: " + style.name;
        });

        grid.appendChild(card);
      });
    })
    .catch(function (err) {
      grid.innerHTML = '<div style="color:#ff5566;font-size:11px;padding:8px;">Error: ' + err.message + '</div>';
    });
}

document.getElementById("browseSrtBtn").addEventListener("click", function () {
  csInterface.evalScript("pickSrtFile()", function (result) {
    if (result && result !== "" && result !== "undefined") {
      currentSrtPath = result;
      var parts = result.split(/[\/\\]/);
      document.getElementById("srtFilePath").innerText = parts[parts.length - 1];
      document.getElementById("srtFilePath").title = result;
      document.getElementById("captionStatus").innerText = "File: " + parts[parts.length - 1];
    } else {
      document.getElementById("captionStatus").innerText = "No file selected.";
    }
  });
});

document.getElementById("importCaptionsBtn").addEventListener("click", function () {
  if (!currentSrtPath) { document.getElementById("captionStatus").innerText = "Please select an SRT file first."; return; }
  if (!selectedCaptionStyle) { document.getElementById("captionStatus").innerText = "Please select a text style first."; return; }

  document.getElementById("captionStatus").innerText = "Importing...";

  var cfg = {
    srtPath: toJsxPath(currentSrtPath),
    font: selectedCaptionStyle.font || "Arial",
    fontSize: selectedCaptionStyle.fontSize || 72,
    textColor: (selectedCaptionStyle.color || "#FFFFFF").replace("#", ""),
    strokeColor: selectedCaptionStyle.strokeColor || "000000",
    strokeWidth: selectedCaptionStyle.strokeWidth || 0,
    tracking: selectedCaptionStyle.tracking || 0,
    autoLeading: selectedCaptionStyle.autoLeading !== false,
    leading: selectedCaptionStyle.leading || 0,
    verticalOffset: parseFloat(document.getElementById("captionVOffset").value) || 200,
    fadeFrames: parseInt(document.getElementById("captionFade").value) || 0,
    useNull: document.getElementById("captionUseNull").checked
  };

  var cfgEscaped = JSON.stringify(cfg).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  csInterface.evalScript('importCaptions("' + cfgEscaped + '")', function (result) {
    if (result && result.indexOf("ok:") === 0) {
      var count = result.split(":")[1];
      document.getElementById("captionStatus").innerText = "✓ " + count + " captions imported!";
    } else {
      document.getElementById("captionStatus").innerText = result || "Import failed.";
    }
  });
});

// ---- HANDLER FACTORIES ----
function makeColorHandler(hexValue) {
  return function (e) {
    var script = e.shiftKey ? 'applyStrokeColor("' + hexValue + '")' : 'applyColorSmart("' + hexValue + '")';
    csInterface.evalScript(script, function (result) { document.getElementById("output").innerText = result; });
  };
}

function makeFontHandler(fontValue, familyName) {
  return function () {
    ensureFontInstalled(fontValue, familyName || null, function (readyNow) {
      if (!readyNow) return; // font was missing — installed, needs AE restart
      csInterface.evalScript('applyFont("' + fontValue + '")', function (result) {
        document.getElementById("output").innerText = result;
      });
    });
  };
}

// Text style now passes full JSON so all properties are applied
function makeTextStyleHandler(styleData) {
  return function () {
    var fontName = styleData.font || "";
    var familyName = styleData.family || null;
    ensureFontInstalled(fontName, familyName, function (readyNow) {
      if (!readyNow) return; // font was missing — installed, needs AE restart
      var json = JSON.stringify(styleData);
      var escaped = json.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      csInterface.evalScript('applyTextStyle("' + escaped + '")', function (result) {
        document.getElementById("output").innerText = result;
      });
    });
  };
}

}

function makeFfxHandler(url, filename) {
  return function () {
    var outputEl = document.getElementById("output");
    var presetsDir = getPresetsDir();
    var localPath = nodePath.join(presetsDir, filename);
    var jsxPath = toJsxPath(localPath);

    if (nodeFs.existsSync(localPath)) {
      outputEl.innerText = "Applying...";
      csInterface.evalScript('applyFfxPreset("' + jsxPath + '")', function (result) { outputEl.innerText = result; });
      return;
    }

    outputEl.innerText = "Downloading...";
    fetch(url + "?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("Not on GitHub yet (HTTP " + res.status + "). Push " + filename + " to presets/ first.");
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        try { if (!nodeFs.existsSync(presetsDir)) nodeFs.mkdirSync(presetsDir, { recursive: true }); }
        catch (e) { outputEl.innerText = "Could not create folder: " + e.message; return; }
        try { nodeFs.writeFileSync(localPath, Buffer.from(new Uint8Array(buffer))); }
        catch (e) { outputEl.innerText = "Write failed: " + e.message; return; }
        if (!nodeFs.existsSync(localPath)) { outputEl.innerText = "File not found after write."; return; }
        outputEl.innerText = "Applying...";
        csInterface.evalScript('applyFfxPreset("' + jsxPath + '")', function (result) { outputEl.innerText = result; });
      })
      .catch(function (err) { outputEl.innerText = "Download failed: " + err.message; });
  };
}

function makeEffectWithPropsHandler(effectData) {
  return function () {
    var escaped = JSON.stringify(effectData).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    csInterface.evalScript('applyEffectWithProps("' + escaped + '")', function (result) { document.getElementById("output").innerText = result; });
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
      card.addEventListener("click", makeFontHandler(data.name, data.family || null));
    } else if (tab === "textstyles") {
      if (data.type === "ffx") {
        card.innerHTML =
          '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
          '<div class="cardSub">FFX Style</div></div>' +
          '<span class="badge ffx">FFX</span>';
        card.addEventListener("click", makeFfxHandler(data.url, data.filename));
      } else {
        var ec = (data.effects ? data.effects.length : 0) + (data.layerStyles ? data.layerStyles.length : 0);
        var meta = [];
        if (data.font) meta.push(data.font);
        if (data.fontSize) meta.push(data.fontSize + "px");
        if (data.tracking) meta.push("tr:" + data.tracking);
        if (ec > 0) meta.push(ec + " fx");
        card.innerHTML =
          '<div class="swatch" style="background-color:' + (data.color || "#888") + '"></div>' +
          '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
          '<div class="cardSub">' + meta.join(" · ") + '</div></div>';
        card.addEventListener("click", makeTextStyleHandler(data));
      }
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

// ---- LONG PRESS (cards) ----
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
  document.getElementById("clientContextMenu").classList.add("hidden");
  var menu = document.getElementById("contextMenu");
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.classList.remove("hidden");
}
function hideContextMenu() { document.getElementById("contextMenu").classList.add("hidden"); }

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
    showVersion();
    banner.innerHTML = '<span>✓ Updated to v' + newVersion + ' — reopen DopeTool</span>';
  }
}

// ---- INIT ----
window.addEventListener("DOMContentLoaded", function () {
  showVersion();
  setTimeout(checkForUpdate, 1000);
});

// ---- FONT AUTO-INSTALLATION ----
var GITHUB_FONTS_BASE = "https://raw.githubusercontent.com/itsusmanelahi01/dopetool/main/fonts";
var GITHUB_FONTS_API = "https://api.github.com/repos/itsusmanelahi01/dopetool/contents/fonts";

function getFontsDir() {
  var platform = navigator.platform || "";
  if (platform.indexOf("Win") !== -1) {
    // Windows user fonts folder — no admin required
    return nodePath.join(nodeOs.homedir(), "AppData", "Local", "Microsoft", "Windows", "Fonts");
  } else {
    // Mac user fonts folder — no admin required
    return nodePath.join(nodeOs.homedir(), "Library", "Fonts");
  }
}

function isFontFileInstalled(filename) {
  var fontsDir = getFontsDir();
  return nodeFs.existsSync(nodePath.join(fontsDir, filename));
}

function installFontFamily(familyName, onDone) {
  // familyName = folder name in GitHub fonts/ e.g. "BarlowCondensed"
  var outputEl = document.getElementById("output");
  if (outputEl) outputEl.innerText = "Checking font: " + familyName + "...";

  var apiUrl = GITHUB_FONTS_API + "/" + encodeURIComponent(familyName);

  fetch(apiUrl)
    .then(function (res) {
      if (!res.ok) throw new Error("Font family '" + familyName + "' not found in GitHub fonts/ folder.");
      return res.json();
    })
    .then(function (files) {
      if (!Array.isArray(files) || files.length === 0) throw new Error("No font files found for " + familyName);

      var fontsDir = getFontsDir();
      try {
        if (!nodeFs.existsSync(fontsDir)) nodeFs.mkdirSync(fontsDir, { recursive: true });
      } catch (e) {}

      var pending = 0;
      var installed = 0;
      var skipped = 0;

      // Only download font files
      var fontFiles = files.filter(function (f) {
        var name = (f.name || "").toLowerCase();
        return name.indexOf(".ttf") !== -1 || name.indexOf(".otf") !== -1 || name.indexOf(".woff") !== -1;
      });

      if (fontFiles.length === 0) {
        if (outputEl) outputEl.innerText = "No font files found in " + familyName + " folder.";
        if (onDone) onDone(false);
        return;
      }

      pending = fontFiles.length;

      fontFiles.forEach(function (fontFile) {
        var localPath = nodePath.join(fontsDir, fontFile.name);

        // Skip if already installed
        if (nodeFs.existsSync(localPath)) {
          skipped++;
          pending--;
          if (pending === 0) finishFontInstall(familyName, installed, skipped, outputEl, onDone);
          return;
        }

        // Download and install
        fetch(fontFile.download_url)
          .then(function (res) {
            if (!res.ok) throw new Error("Failed to download " + fontFile.name);
            return res.arrayBuffer();
          })
          .then(function (buffer) {
            try {
              nodeFs.writeFileSync(localPath, Buffer.from(new Uint8Array(buffer)));
              installed++;
            } catch (e) {
              // write failed
            }
            pending--;
            if (pending === 0) finishFontInstall(familyName, installed, skipped, outputEl, onDone);
          })
          .catch(function () {
            pending--;
            if (pending === 0) finishFontInstall(familyName, installed, skipped, outputEl, onDone);
          });
      });
    })
    .catch(function (err) {
      if (outputEl) outputEl.innerText = "Font install failed: " + err.message;
      if (onDone) onDone(false);
    });
}

function finishFontInstall(familyName, installed, skipped, outputEl, onDone) {
  if (installed > 0) {
    if (outputEl) outputEl.innerText = "✓ " + familyName + " installed (" + installed + " files). Restart AE to use it.";
  } else if (skipped > 0) {
    if (outputEl) outputEl.innerText = "✓ " + familyName + " already installed.";
  } else {
    if (outputEl) outputEl.innerText = "Font install completed for " + familyName + ".";
  }
  if (onDone) onDone(installed > 0);
}

// Check if font is installed in AE, install if missing
function ensureFontInstalled(fontName, familyName, onReady) {
  var outputEl = document.getElementById("output");

  csInterface.evalScript('checkFontInstalled("' + fontName + '")', function (result) {
    if (result === "installed") {
      // Font is available — proceed immediately
      if (onReady) onReady(true);
    } else {
      // Font missing — install family then notify
      if (familyName) {
        if (outputEl) outputEl.innerText = "Font missing — installing " + familyName + "...";
        installFontFamily(familyName, function (didInstall) {
          if (onReady) onReady(false); // false = needs AE restart
        });
      } else {
        if (outputEl) outputEl.innerText = "Font '" + fontName + "' not installed. Add it to GitHub fonts/ folder.";
        if (onReady) onReady(false);
      }
    }
  });
}
