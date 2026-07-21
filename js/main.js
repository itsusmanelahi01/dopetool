window.onerror = function(msg, url, line, col, error) {
  var out = document.getElementById("output") || document.getElementById("hubVersion");
  if (out) {
    out.style.color = "#ff5566";
    out.innerText = "JS ERROR line " + line + ": " + msg;
  }
  console.log("JS ERROR line " + line + ": " + msg);
  return false;
};

// DopeTool main.js — v2.31.4

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
var currentSort = "name";

var collectionMap = {
  colors: "colors", fonts: "fonts", textstyles: "textstyles",
  effects: "effects", animations: "animations", assets: "assets"
};

var captureFunctionMap = {
  colors: "captureColor()", fonts: "captureFont()",
  textstyles: "captureTextStyle()", effects: null, animations: null, assets: null
};

var nodeFs = require("fs");
var nodeOs = require("os");
var nodePath = require("path");
var extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
var localVersionPath = extensionPath + "/local_version.json";

// ---- FIRESTORE TRANSPORT FIX ----
// In a CEP panel (Node-integrated context) the browser Image global isn't a
// real constructor, so Firestore's default WebChannel transport throws
// "Image is not a constructor". Forcing long-polling avoids that transport and
// works reliably inside After Effects. Must run before any Firestore query
// (this executes at load, before DOMContentLoaded fires the first read).
var dbSettingsError = null;
try {
  if (typeof db !== "undefined" && db && db.settings) {
    db.settings({ experimentalForceLongPolling: true });
  }
} catch (e) { dbSettingsError = (e && (e.message || e.code)) || String(e); }

// ---- UPDATE CHANNEL ----
// channel.json decides which GitHub branch this panel pulls its code, version,
// changelog, presets and fonts from. Production ships {"branch":"main"}; the
// tester panel ships {"branch":"dev"}. The auto-updater never overwrites
// channel.json, so each installed panel keeps its own channel across updates.
// If the file is missing (e.g. older installs), we safely default to main.
var GITHUB_REPO = "itsusmanelahi01/dopetool";
function getChannel() {
  try {
    var c = JSON.parse(nodeFs.readFileSync(extensionPath + "/channel.json", "utf8"));
    return { branch: (c.branch || "main"), label: (c.label || "DopeTool") };
  } catch (e) { return { branch: "main", label: "DopeTool" }; }
}
var CHANNEL = getChannel();
var GITHUB_BRANCH = CHANNEL.branch;
var GITHUB_RAW_BASE = "https://raw.githubusercontent.com/" + GITHUB_REPO + "/" + GITHUB_BRANCH;

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

// ---- ASSETS (stored as GitHub Release assets — free, no repo bloat) ----
// The lead drag-drops files onto a Release tagged "assets"; the panel builds
// the public download URL from the filename. Assets are shared across channels,
// so this always points at the main repo (no branch).
var GITHUB_ASSETS_TAG = "assets";
function getAssetsDir() {
  return nodePath.join(nodeOs.homedir(), "Documents", "DopeTool_Assets");
}
function assetUrl(filename) {
  return "https://github.com/" + GITHUB_REPO + "/releases/download/" + GITHUB_ASSETS_TAG + "/" + encodeURIComponent(filename);
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
  // On non-production channels, show the branch so you can tell the tester
  // panel apart from the production one at a glance.
  var suffix = (GITHUB_BRANCH !== "main") ? " · " + GITHUB_BRANCH : "";
  var tag = document.getElementById("versionTag");
  if (tag) tag.innerText = "v" + v + suffix;
  var hubTag = document.getElementById("hubVersion");
  if (hubTag) hubTag.innerText = "v" + v + suffix;
}

function clientColor(name) {
  var colors = ["#4c72ff","#ff5577","#33cc88","#ff9944","#aa55ff","#00cccc","#ff4488","#66bb33","#ff6644","#4499ff","#cc44aa","#88cc00"];
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function clientInitial(name) { return name.trim().charAt(0).toUpperCase(); }

// ---- VIEW NAVIGATION (one view at a time; a left rail switches tools) ----
var ALL_VIEWS = ["homeView", "clientView", "captionView", "autoCapView", "toolkitView", "textAnimView", "smoothView"];
var TAB_TITLES = { library: "Library", toolkit: "Toolkit", textanim: "Text Anim", captions: "Captions", autocap: "Auto Cap", smooth: "Smoooth" };
var VIEW_TAB = { homeView: "library", clientView: "library", captionView: "captions", autoCapView: "autocap", toolkitView: "toolkit", textAnimView: "textanim", smoothView: "smooth" };

// Rail order + icons (also defines what appears in the nav)
var TOOLS = [
  { tab: "library",  label: "Library",   icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v13H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h12"/><path d="M9 7h5"/></svg>' },
  { tab: "toolkit",  label: "Toolkit",   icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.3-.6-.6-2.3z"/></svg>' },
  { tab: "textanim", label: "Text Anim", icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7V5h11v2"/><path d="M10.5 5v13"/><path d="M8.5 18h4"/><path d="M18 10l3 3-3 3"/></svg>' },
  { tab: "captions", label: "Captions",  icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12.5a2 2 0 1 0 0-1"/><path d="M14 12.5a2 2 0 1 0 0-1"/></svg>' },
  { tab: "autocap",  label: "Auto Cap",  icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/><path d="M9 21h6"/></svg>' },
  { tab: "smooth",   label: "Smoooth",   icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c5 0 4-10 9-10s4 6 9 6"/><circle cx="3" cy="17" r="1.4" fill="currentColor" stroke="none"/><circle cx="21" cy="13" r="1.4" fill="currentColor" stroke="none"/></svg>' }
];

function activeViewId(tab) {
  if (tab === "library") return currentClient ? "clientView" : "homeView";
  if (tab === "captions") return "captionView";
  if (tab === "autocap") return "autoCapView";
  if (tab === "toolkit") return "toolkitView";
  if (tab === "textanim") return "textAnimView";
  if (tab === "smooth") return "smoothView";
  return "homeView";
}

// Each tab's data is fetched once (first time it becomes visible) then left alone.
var loadedTabs = {};
function loadForTab(tab) {
  if (tab === "smooth" && typeof smoothDraw === "function") setTimeout(smoothDraw, 0);
  if (loadedTabs[tab]) return;
  loadedTabs[tab] = true;
  if (tab === "library") { if (!currentClient) loadAllClients(); }
  else if (tab === "captions") loadCaptionStyles();
  else if (tab === "autocap") { if (typeof loadAutoCapStyles === "function") loadAutoCapStyles(); }
  else if (tab === "textanim") { if (typeof loadTextAnims === "function") loadTextAnims(); }
  else if (tab === "smooth") { if (typeof loadSmoothPresets === "function") loadSmoothPresets(); }
}

var currentTab = "library";

// Show exactly one view, update the rail highlight, lazy-load the tab's data.
function showView(viewId) {
  for (var i = 0; i < ALL_VIEWS.length; i++) {
    var e = document.getElementById(ALL_VIEWS[i]);
    if (e) e.classList.toggle("hidden", ALL_VIEWS[i] !== viewId);
  }
  var tab = VIEW_TAB[viewId] || currentTab;
  currentTab = tab;
  setRailActive(tab);
  loadForTab(tab);
  var m = document.getElementById("appMain");
  if (m) m.scrollTop = 0;
  try { localStorage.setItem("dopetool_tab", tab); } catch (e) {}
}

function navTo(tab) { showView(activeViewId(tab)); }

function setRailActive(tab) {
  var wrap = document.getElementById("appRailTabs");
  if (!wrap) return;
  var btns = wrap.querySelectorAll(".railBtn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle("active", btns[i].getAttribute("data-tab") === tab);
  }
}

// User-customizable rail order (drag to reorder), persisted in localStorage.
// New tools not present in a saved order are appended so nothing disappears.
function railOrder() {
  var saved = [];
  try { saved = JSON.parse(localStorage.getItem("dopetool_rail_order") || "[]"); } catch (e) {}
  var byTab = {};
  TOOLS.forEach(function (t) { byTab[t.tab] = t; });
  var out = [], seen = {};
  saved.forEach(function (tab) { if (byTab[tab] && !seen[tab]) { out.push(byTab[tab]); seen[tab] = 1; } });
  TOOLS.forEach(function (t) { if (!seen[t.tab]) out.push(t); });
  return out;
}
function saveRailOrder(list) {
  try { localStorage.setItem("dopetool_rail_order", JSON.stringify(list.map(function (t) { return t.tab; }))); } catch (e) {}
}
function indexOfTab(list, tab) {
  for (var i = 0; i < list.length; i++) if (list[i].tab === tab) return i;
  return -1;
}
var railDragTab = null;
function reorderRail(dragTab, beforeTab) {
  if (dragTab === beforeTab) return;
  var order = railOrder();
  var di = indexOfTab(order, dragTab);
  if (di < 0) return;
  var moved = order.splice(di, 1)[0];
  var ti = (beforeTab == null) ? order.length : indexOfTab(order, beforeTab);
  if (ti < 0) ti = order.length;
  order.splice(ti, 0, moved);
  saveRailOrder(order);
  renderRail();
  setRailActive(currentTab);
}

function renderRail() {
  var wrap = document.getElementById("appRailTabs");
  if (!wrap) return;
  wrap.innerHTML = "";
  railOrder().forEach(function (t) {
    var b = document.createElement("button");
    b.className = "railBtn";
    b.setAttribute("data-tab", t.tab);
    b.setAttribute("draggable", "true");
    b.title = t.label + " — drag to reorder";
    b.innerHTML = t.icon + '<span class="railLabel">' + t.label + '</span>';
    b.addEventListener("click", function () {
      if (b.getAttribute("data-just-dragged")) return; // ignore the click after a drag
      navTo(t.tab);
    });
    b.addEventListener("dragstart", function (e) {
      railDragTab = t.tab;
      b.classList.add("railDragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.tab); } catch (x) {}
    });
    b.addEventListener("dragend", function () {
      b.classList.remove("railDragging");
      railDragTab = null;
      var all = wrap.querySelectorAll(".railBtn");
      for (var i = 0; i < all.length; i++) all[i].classList.remove("railDropInto");
      b.setAttribute("data-just-dragged", "1");
      setTimeout(function () { b.removeAttribute("data-just-dragged"); }, 60);
    });
    b.addEventListener("dragover", function (e) {
      if (!railDragTab || railDragTab === t.tab) return;
      e.preventDefault();
      b.classList.add("railDropInto");
    });
    b.addEventListener("dragleave", function () { b.classList.remove("railDropInto"); });
    b.addEventListener("drop", function (e) {
      if (!railDragTab) return;
      e.preventDefault();
      b.classList.remove("railDropInto");
      reorderRail(railDragTab, t.tab); // insert dragged button before this one
    });
    wrap.appendChild(b);
  });
}

// ---- Compatibility shims: old dock/tab API is gone, keep old callers working ----
function activateTab(tab) { navTo(tab); }
function switchTopTab(tab) { navTo(tab); }
function currentActiveTab() { return currentTab; }
function buildDock() {}
function updateTopTabFades() {}


// ---- LOAD ALL CLIENTS ----
// Fetched once, then served from cache. Pass force=true after a mutation
// (add/delete/rename a client) to refresh; plain navigation reuses the cache.
var clientsLoaded = false;
function loadAllClients(force, isRetry) {
  if (!force && clientsLoaded) { renderClientGrid(allClientsData); return; }
  var grid = document.getElementById("clientGrid");
  grid.innerHTML = '<div style="color:#333348;padding:20px;text-align:center;font-size:11px;">Loading...</div>';
  var collections = ["colors","textstyles","effects","assets"];
  var clientMap = {};
  var pending = collections.length, anyFailed = false, firstErr = null;

  function done() {
    if (--pending !== 0) return;
    if (anyFailed) {
      // Never cache a failed/partial load — retry once, then surface the error.
      if (!isRetry) { setTimeout(function () { loadAllClients(true, true); }, 1200); return; }
      var detail = (firstErr && (firstErr.code || firstErr.message)) ? (firstErr.code || firstErr.message) : "";
      if (dbSettingsError) detail = "settings: " + dbSettingsError + (detail ? " · " + detail : "");
      grid.innerHTML =
        '<div style="color:#8a8aa8;padding:24px 16px;text-align:center;font-size:11px;line-height:1.6;">' +
        'Couldn\'t reach the library.<br>Check your connection, then <b id="clientRetryBtn" style="color:var(--accent);cursor:pointer;text-decoration:underline;">retry</b>.' +
        (detail ? '<div style="margin-top:10px;color:#5b5b78;font-size:9.5px;word-break:break-word;">' + detail + '</div>' : '') +
        '</div>';
      var rb = document.getElementById("clientRetryBtn");
      if (rb) rb.addEventListener("click", function () { loadAllClients(true); });
      return;
    }
    clientsLoaded = true; // only cache a clean, complete load
    renderClientGrid(clientMap);
  }

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
      })
      .catch(function (e) { anyFailed = true; if (!firstErr) firstErr = e; })
      .then(done);
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
    if (data.types.textstyles) typeSummary.push(data.types.textstyles + " styles");
    if (data.types.effects) typeSummary.push(data.types.effects + " fx");
    if (data.types.assets) typeSummary.push(data.types.assets + " assets");

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
  var collections = ["colors","textstyles","effects","assets"];
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
          loadAllClients(true);
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
  var collections = ["colors","textstyles","effects","assets"];
  var pending = collections.length;
  var clientToDelete = activeClientName;
  collections.forEach(function (col) {
    db.collection(col).where("client", "==", clientToDelete).get()
      .then(function (snapshot) {
        var batch = db.batch();
        snapshot.forEach(function (doc) { batch.delete(doc.ref); });
        return batch.commit();
      })
      .then(function () { pending--; if (pending === 0) { activeClientName = null; delete clientLibCache[clientToDelete]; loadAllClients(true); } })
      .catch(function () { pending--; });
  });
});

// ---- OPEN CLIENT ----
// Per-client library cache: first open fetches, later opens reuse it. Any
// add/edit/delete inside a client re-fetches (loadClientLibrary) and refreshes
// this cache, so it stays correct without reloading on every open.
var clientLibCache = {};
function openClient(clientName, color) {
  currentClient = clientName;
  showView("clientView");
  document.getElementById("clientViewName").innerText = clientName;
  document.getElementById("clientViewInitial").innerText = clientInitial(clientName);
  document.getElementById("clientViewInitial").style.background = color;
  document.getElementById("clientView").style.setProperty("--current-client-color", color);
  currentTab = "colors";
  if (clientLibCache[clientName]) {
    clientData = clientLibCache[clientName];
    renderAllSections();
  } else {
    loadClientLibrary();
  }
}

document.getElementById("backBtn").addEventListener("click", function () {
  currentClient = null;
  document.getElementById("addForm").classList.add("hidden");
  document.getElementById("ffxForm").classList.add("hidden");
  document.getElementById("ffxStyleForm").classList.add("hidden");
  document.getElementById("manualColorForm").classList.add("hidden");
  document.getElementById("assetForm").classList.add("hidden");
  document.getElementById("editForm").classList.add("hidden");
  showView("homeView");
  loadAllClients();
});

// Search filters the cached list (no re-fetch per keystroke).
document.getElementById("clientSearch").addEventListener("input", function () {
  if (clientsLoaded) renderClientGrid(allClientsData);
  else loadAllClients();
});

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
      loadAllClients(true);
      setTimeout(function () { openClient(name, clientColor(name)); }, 600);
    })
    .catch(function (err) { document.getElementById("newClientName").placeholder = "Error: " + err.message; });
});

// The four library categories, shown all at once as stacked sections.
// Each section header carries "+ add" buttons that proxy-click the (hidden)
// real add buttons after pointing currentTab at that category.
var LIB_SECTIONS = [
  { cat: "colors",     title: "Colors", adds: [{ proxy: "captureBtn", label: "+ Capture" }, { proxy: "manualColorBtn", label: "+ Color" }] },
  { cat: "textstyles", title: "Styles", adds: [{ proxy: "captureBtn", label: "+ Capture" }, { proxy: "ffxStyleToggleBtn", label: "+ FFX" }] },
  { cat: "effects",    title: "FX",     adds: [{ proxy: "quickCaptureBtn", label: "+ Capture" }, { proxy: "ffxToggleBtn", label: "+ FFX" }] },
  { cat: "assets",     title: "Assets", adds: [{ proxy: "assetToggleBtn", label: "+ Add" }] }
];
// Loaded items per category: { colors:[...], textstyles:[...], effects:[...], assets:[...] }
var clientData = {};

function updateTabUI() {} // no-op: add buttons now live in section headers

// ---- LOAD CLIENT LIBRARY (all categories at once) ----
function loadClientLibrary() {
  if (!currentClient) return;
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = '<div style="color:#333348;padding:16px;text-align:center;font-size:11px;">Loading…</div>';
  clientData = {};
  var cats = LIB_SECTIONS.map(function (s) { return s.cat; });
  var pending = cats.length, failed = null;
  cats.forEach(function (cat) {
    db.collection(collectionMap[cat]).where("client", "==", currentClient).get()
      .then(function (snapshot) {
        var arr = [];
        snapshot.forEach(function (doc) {
          var data = doc.data();
          if (data.placeholder) return;
          arr.push({ id: doc.id, data: data });
        });
        clientData[cat] = arr;
      })
      .catch(function (err) { failed = err; clientData[cat] = []; })
      .then(function () {
        if (--pending === 0) {
          if (failed) { contentEl.innerHTML = '<div style="color:#ff5566;padding:12px;font-size:11px;">Error: ' + failed.message + '</div>'; return; }
          clientLibCache[currentClient] = clientData; // cache for instant re-open
          renderAllSections();
        }
      });
  });
}

// Sort: favorites always pinned first, then by the chosen mode.
function compareItems(a, b) {
  var af = a.data.favorite ? 1 : 0, bf = b.data.favorite ? 1 : 0;
  if (af !== bf) return bf - af;
  if (currentSort === "recent") return (b.data.createdAt || 0) - (a.data.createdAt || 0);
  var an = (a.data.name || "").toLowerCase(), bn = (b.data.name || "").toLowerCase();
  return an < bn ? -1 : an > bn ? 1 : 0;
}

// Build every section (divider header + grid) from the cached data.
function renderAllSections() {
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = "";
  var total = 0;
  LIB_SECTIONS.forEach(function (sec) {
    var items = (clientData[sec.cat] || []).slice().sort(compareItems);
    total += items.length;

    var section = document.createElement("div");
    section.className = "libSection";
    section.setAttribute("data-cat", sec.cat);

    var head = document.createElement("div");
    head.className = "libSectionHead";
    var addHtml = sec.adds.map(function (a) {
      return '<button class="libAddBtn" data-proxy="' + a.proxy + '" data-cat="' + sec.cat + '">' + a.label + '</button>';
    }).join("");
    head.innerHTML =
      '<span class="libSectionTitle">' + sec.title +
      ' <span class="libSectionCount">' + items.length + '</span></span>' +
      '<span class="libSectionAdds">' + addHtml + '</span>';
    section.appendChild(head);

    var grid = document.createElement("div");
    grid.className = "libSectionGrid" + (sec.cat === "colors" ? " library--grid" : "");
    if (items.length === 0) {
      grid.innerHTML = '<div class="emptyState emptyStateSmall">Nothing here yet</div>';
    }
    section.appendChild(grid);
    contentEl.appendChild(section);

    if (items.length) renderItems(items, sec.cat, grid);
  });
  document.getElementById("clientViewCount").innerText = total + (total === 1 ? " item" : " items");
}

// Re-render everything from the cached data (used after sort changes).
function renderCurrent() { renderAllSections(); }

// Section header "+ add" proxies: point currentTab at the section, then click
// the matching (hidden) real add button so all existing logic just works.
document.getElementById("libraryContent").addEventListener("click", function (e) {
  var btn = e.target.closest ? e.target.closest(".libAddBtn") : null;
  if (!btn) return;
  currentTab = btn.getAttribute("data-cat");
  hideContextMenu();
  var real = document.getElementById(btn.getAttribute("data-proxy"));
  if (real) real.click();
});

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
  var docData = Object.assign({}, pendingCapture, { name: name, client: currentClient, createdAt: Date.now() });
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

      var allCaptionStyles = styles;
      var captionClients = [];
      allCaptionStyles.forEach(function (s) {
        var c = s.client || "Unassigned";
        if (captionClients.indexOf(c) === -1) captionClients.push(c);
      });
      captionClients.sort();

      var activeCaptionFilter = "All";

      function renderCaptionPills() {
        var filterBar = document.getElementById("captionClientFilter");
        filterBar.innerHTML = "";
        var allPill = document.createElement("div");
        allPill.className = "captionClientPill" + (activeCaptionFilter === "All" ? " active" : "");
        allPill.innerText = "All";
        allPill.addEventListener("click", function () { activeCaptionFilter = "All"; renderCaptionPills(); renderCaptionGrid(); });
        filterBar.appendChild(allPill);

        captionClients.forEach(function (c) {
          var pill = document.createElement("div");
          pill.className = "captionClientPill" + (activeCaptionFilter === c ? " active" : "");
          pill.innerText = c;
          pill.addEventListener("click", function () { activeCaptionFilter = c; renderCaptionPills(); renderCaptionGrid(); });
          filterBar.appendChild(pill);
        });
      }

      function renderCaptionGrid() {
        grid.innerHTML = "";
        var filtered = activeCaptionFilter === "All" ? allCaptionStyles : allCaptionStyles.filter(function (s) { return (s.client || "Unassigned") === activeCaptionFilter; });

        if (filtered.length === 0) {
          grid.innerHTML = '<div style="color:#333348;font-size:11px;padding:8px;">No styles for this client.</div>';
          return;
        }

        filtered.forEach(function (style) {
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
      }

      renderCaptionPills();
      renderCaptionGrid();
    })
    .catch(function (err) {
      grid.innerHTML = '<div style="color:#ff5566;font-size:11px;padding:8px;">Error: ' + err.message + '</div>';
    });
}

document.getElementById("browseSrtBtn").addEventListener("click", function () {
  csInterface.evalScript("pickSrtFile()", function (result) {
    if (result && result !== "" && result !== "undefined") {
      setSrtFile(result);
    } else {
      document.getElementById("captionStatus").innerText = "No file selected.";
    }
  });
});

function setSrtFile(path) {
  currentSrtPath = path;
  var parts = path.split(/[\/\\]/);
  var name = parts[parts.length - 1];
  document.getElementById("srtFilePath").innerText = name;
  document.getElementById("srtFilePath").title = path;
  document.getElementById("captionStatus").innerText = "File: " + name;
}

// ---- SRT DRAG & DROP (Mac + Windows) ----
// CEP's Node-integrated Chromium exposes the dropped file's absolute path on
// the File object (file.path), which works on both platforms.
(function () {
  var zone = document.getElementById("srtFilePath");
  if (!zone) return;

  function stop(e) { e.preventDefault(); e.stopPropagation(); }

  ["dragenter", "dragover"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { stop(e); zone.classList.add("dropActive"); });
  });
  ["dragleave", "dragend"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { stop(e); zone.classList.remove("dropActive"); });
  });

  zone.addEventListener("drop", function (e) {
    stop(e);
    zone.classList.remove("dropActive");
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    var f = files[0];
    var path = f.path || "";
    if (!path) { document.getElementById("captionStatus").innerText = "Couldn't read the dropped file's path."; return; }
    if (!/\.srt$/i.test(f.name) && !/\.srt$/i.test(path)) {
      document.getElementById("captionStatus").innerText = "Please drop a .srt file.";
      return;
    }
    setSrtFile(path);
  });

  // Stop the panel from navigating when a file is dropped outside the zone
  window.addEventListener("dragover", function (e) { e.preventDefault(); }, false);
  window.addEventListener("drop", function (e) { e.preventDefault(); }, false);
})();

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
    effects: selectedCaptionStyle.effects || [],
    layerStyles: selectedCaptionStyle.layerStyles || [],
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

// ═══════════════════════════════════════════════════════════
// AUTO CAPTIONS — Groq Whisper transcription → styled captions
// Runs curl on the editor's machine (Node child_process): no CORS, no manual
// multipart, works on Mac + Windows 10+. Reuses importCaptions() for styling.
// ═══════════════════════════════════════════════════════════
var autoCapAudioPath = "";
var selectedAutoStyle = null;
var GROQ_STT_MODEL = "whisper-large-v3"; // faithful multilingual transcription (turbo tends to translate to English)
// The text model used for Roman-Urdu / cleanup. Editor-selectable (Groq deprecated
// llama-3.3-70b; gpt-oss-120b is the strong current default).
var GROQ_LLM_DEFAULT = "openai/gpt-oss-120b";
var acChild = require("child_process");

function getGroqKey() { try { return localStorage.getItem("dopetool_groq_key") || ""; } catch (e) { return ""; } }
function getGroqModel() { try { return localStorage.getItem("dopetool_groq_model") || GROQ_LLM_DEFAULT; } catch (e) { return GROQ_LLM_DEFAULT; } }
function acProgress(msg) { var el = document.getElementById("autoCapProgress"); if (el) el.innerText = msg; }
// The old separate top status bar is gone — selection feedback now shares the
// single progress line so there's only one place to look.
function acStatus(msg) { acProgress(msg); }

// Live elapsed-time ticker for long steps (Groq gives no upload progress)
var acTimer = null, acT0 = 0;
function acTick(label) {
  acStopTick();
  acT0 = Date.now();
  acProgress(label + " — 0s");
  acTimer = setInterval(function () { acProgress(label + " — " + Math.round((Date.now() - acT0) / 1000) + "s"); }, 500);
}
function acStopTick() { if (acTimer) { clearInterval(acTimer); acTimer = null; } }

function refreshGroqKeyState() {
  var st = document.getElementById("autoCapKeyState");
  var input = document.getElementById("autoCapKey");
  var key = getGroqKey();
  if (st) { st.innerText = key ? "✓ saved" : "not set"; st.style.color = key ? "#8fe0c0" : "#8888aa"; }
  if (input && key && !input.value) input.value = key;
}

// Style picker (mirrors the Caption Importer, rendered into the Auto Captions grid)
function loadAutoCapStyles() {
  var grid = document.getElementById("autoCapStyleGrid");
  if (!grid) return;
  refreshGroqKeyState();
  acRefreshFfmpegState();
  acRenderUsage();
  grid.innerHTML = '<div style="color:#333348;font-size:11px;padding:8px;">Loading styles...</div>';
  selectedAutoStyle = null;
  db.collection("textstyles").get().then(function (snapshot) {
    var styles = [];
    snapshot.forEach(function (doc) { var d = doc.data(); if (d.placeholder || d.type === "ffx") return; styles.push(d); });
    if (!styles.length) { grid.innerHTML = '<div style="color:#333348;font-size:11px;padding:8px;">No text styles saved yet.<br>Add styles in the Style Library first.</div>'; return; }
    var clients = [];
    styles.forEach(function (s) { var c = s.client || "Unassigned"; if (clients.indexOf(c) === -1) clients.push(c); });
    clients.sort();
    var filter = "All";
    var filterBar = document.getElementById("autoCapClientFilter");
    function pills() {
      filterBar.innerHTML = "";
      ["All"].concat(clients).forEach(function (c) {
        var pill = document.createElement("div");
        pill.className = "captionClientPill" + (filter === c ? " active" : "");
        pill.innerText = c;
        pill.addEventListener("click", function () { filter = c; pills(); render(); });
        filterBar.appendChild(pill);
      });
    }
    function render() {
      grid.innerHTML = "";
      var list = filter === "All" ? styles : styles.filter(function (s) { return (s.client || "Unassigned") === filter; });
      if (!list.length) { grid.innerHTML = '<div style="color:#333348;font-size:11px;padding:8px;">No styles for this client.</div>'; return; }
      list.forEach(function (style) {
        var card = document.createElement("div");
        card.className = "captionStyleCard";
        card.innerHTML =
          '<div class="captionSwatch" style="background-color:' + (style.color || "#888") + '"></div>' +
          '<div class="captionStyleInfo"><div class="captionStyleName">' + style.name + '</div>' +
          '<div class="captionStyleMeta">' + (style.font || "") + ' · ' + (style.fontSize || "") + 'px · ' + (style.client || "") + '</div></div>';
        card.addEventListener("click", function () {
          var cards = document.querySelectorAll("#autoCapStyleGrid .captionStyleCard");
          for (var i = 0; i < cards.length; i++) cards[i].classList.remove("selected");
          card.classList.add("selected");
          selectedAutoStyle = style;
          acStatus("Style: " + style.name);
        });
        grid.appendChild(card);
      });
    }
    pills(); render();
  }).catch(function (err) { grid.innerHTML = '<div style="color:#ff5566;font-size:11px;padding:8px;">Error: ' + err.message + '</div>'; });
}

function setAutoCapFile(path) {
  autoCapAudioPath = path;
  var parts = path.split(/[\/\\]/);
  var el = document.getElementById("autoCapFile");
  if (el) { el.innerText = parts[parts.length - 1]; el.title = path; }
  acStatus("Audio: " + parts[parts.length - 1]);
}

// ---- Groq requests via curl ----
function groqTranscribe(key, audioPath, lang, cb) {
  var hdr = require("path").join(require("os").tmpdir(), "dopetool_hdr_" + Date.now() + ".txt");
  var args = [
    "-s", "-S", "--max-time", "600",
    "-D", hdr,
    "https://api.groq.com/openai/v1/audio/transcriptions",
    "-H", "Authorization: Bearer " + key,
    "-F", "file=@" + audioPath,
    "-F", "model=" + GROQ_STT_MODEL,
    "-F", "response_format=verbose_json",
    "-F", "temperature=0",
    "-F", "timestamp_granularities[]=word",
    "-F", "timestamp_granularities[]=segment"
  ];
  if (lang && lang !== "auto") args.push("-F", "language=" + lang);
  acExecJson(args, cb, hdr);
}

function groqChat(key, systemPrompt, userContent, cb) {
  var body = JSON.stringify({
    model: getGroqModel(), temperature: 0.2,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }]
  });
  acExecJson([
    "-s", "-S", "--max-time", "120",
    "https://api.groq.com/openai/v1/chat/completions",
    "-H", "Authorization: Bearer " + key,
    "-H", "Content-Type: application/json",
    "-d", body
  ], cb);
}

function acExecJson(args, cb, headerPath) {
  acChild.execFile("curl", args, { maxBuffer: 1024 * 1024 * 64 }, function (err, stdout, stderr) {
    if (headerPath) { try { acParseRateLimits(require("fs").readFileSync(headerPath, "utf8")); } catch (e) {} try { require("fs").unlinkSync(headerPath); } catch (e2) {} }
    if (err && !stdout) { cb(stderr || err.message || "Request failed"); return; }
    var data;
    try { data = JSON.parse(stdout); } catch (e) { cb("Bad response: " + (stdout || "").slice(0, 200)); return; }
    if (data && data.error) { cb(data.error.message || JSON.stringify(data.error)); return; }
    cb(null, data);
  });
}

// ---- Groq usage (read live from rate-limit response headers) ----
var acRateLimits = null;
try { acRateLimits = JSON.parse(localStorage.getItem("dopetool_groq_limits") || "null"); } catch (e) {}

function acParseRateLimits(txt) {
  function g(name) { var m = new RegExp(name + ":\\s*([^\\r\\n]+)", "i").exec(txt); return m ? m[1].replace(/^\s+|\s+$/g, "") : null; }
  acRateLimits = {
    remReq: g("x-ratelimit-remaining-requests"),
    limReq: g("x-ratelimit-limit-requests"),
    resetReq: g("x-ratelimit-reset-requests"),
    remAudio: g("x-ratelimit-remaining-audio-seconds"),
    limAudio: g("x-ratelimit-limit-audio-seconds"),
    resetAudio: g("x-ratelimit-reset-audio-seconds")
  };
  try { localStorage.setItem("dopetool_groq_limits", JSON.stringify(acRateLimits)); } catch (e) {}
  acRenderUsage();
}
function acFmtSeconds(s) {
  var n = parseFloat(s);
  if (isNaN(n)) return null;
  if (n >= 3600) return (n / 3600).toFixed(1) + " hr";
  if (n >= 60) return Math.round(n / 60) + " min";
  return Math.round(n) + " s";
}
function acRenderUsage() {
  var el = document.getElementById("acUsage");
  if (!el) return;
  var rl = acRateLimits;
  if (!rl || (rl.remReq == null && rl.remAudio == null)) { el.innerText = ""; return; }
  var parts = [];
  if (rl.remAudio != null) {
    var a = acFmtSeconds(rl.remAudio);
    // Groq's audio budget is a rolling bucket that refills continuously — only
    // surface the reset countdown when you're actually running low.
    var lowAudio = rl.limAudio && parseFloat(rl.remAudio) < parseFloat(rl.limAudio) * 0.25;
    if (a) parts.push(a + " of audio left" + (lowAudio && rl.resetAudio ? " (resets in " + rl.resetAudio + ")" : ""));
  }
  if (rl.remReq != null) {
    var lowReq = rl.limReq && parseFloat(rl.remReq) < parseFloat(rl.limReq) * 0.25;
    parts.push(rl.remReq + (rl.limReq ? " / " + rl.limReq : "") + " requests left" + (lowReq && rl.resetReq ? " (resets in " + rl.resetReq + ")" : ""));
  }
  el.innerText = parts.length ? "Groq quota — " + parts.join(" · ") : "";
}

// ---- Audio prep: compress to 16kHz mono MP3 with ffmpeg (also extracts audio
// from video) so we stay under Groq's ~25 MB upload limit and Whisper gets its
// preferred format. Returns the original path if ffmpeg isn't available. ----
var GROQ_MAX_BYTES = 24 * 1024 * 1024;

// DopeTool keeps its own ffmpeg in the user's home dir (survives panel updates,
// no admin needed). We check that first, then the system PATH / common dirs.
function acFfmpegDir() { var os = require("os"), p = require("path"); return p.join(os.homedir(), ".dopetool", "bin"); }
function acBundledFfmpegPath() { var os = require("os"), p = require("path"); return p.join(acFfmpegDir(), os.platform() === "win32" ? "ffmpeg.exe" : "ffmpeg"); }

function acFindFfmpeg(cb) {
  var bundled = acBundledFfmpegPath();
  try { if (require("fs").existsSync(bundled)) { cb(bundled); return; } } catch (e) {}
  var candidates = ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
  var i = 0;
  (function tryNext() {
    if (i >= candidates.length) { cb(null); return; }
    var c = candidates[i++];
    acChild.execFile(c, ["-version"], { timeout: 8000 }, function (err) { if (err) tryNext(); else cb(c); });
  })();
}

// ---- One-click ffmpeg install (downloads a static build for this OS) ----
function acFfmpegMsg(m) { var el = document.getElementById("acFfmpegProgress"); if (el) el.innerText = m; }
function acFindFileRecursive(dir, name) {
  var fsx = require("fs"), pathx = require("path"), stack = [dir];
  while (stack.length) {
    var d = stack.pop(), items;
    try { items = fsx.readdirSync(d); } catch (e) { continue; }
    for (var i = 0; i < items.length; i++) {
      var full = pathx.join(d, items[i]), st;
      try { st = fsx.statSync(full); } catch (e2) { continue; }
      if (st.isDirectory()) stack.push(full);
      else if (items[i].toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}
function acVerifyBundledFfmpeg(target) {
  acChild.execFile(target, ["-version"], { timeout: 10000 }, function (err) {
    if (err) { acFfmpegMsg("Installed, but couldn't run it: " + (err.message || "")); return; }
    acFfmpegMsg("✓ ffmpeg ready!");
    acRefreshFfmpegState();
  });
}
function acInstallFfmpeg() {
  var os = require("os"), fsx = require("fs"), pathx = require("path");
  var isWin = os.platform() === "win32";
  var dir = acFfmpegDir(), target = acBundledFfmpegPath();
  try { fsx.mkdirSync(dir, { recursive: true }); } catch (e) { acFfmpegMsg("Can't create folder: " + e.message); return; }
  var url = isWin
    ? "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    : "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
  var zip = pathx.join(os.tmpdir(), "dopetool_ffmpeg_" + Date.now() + ".zip");
  acFfmpegMsg("Downloading ffmpeg… (can take a minute)");
  acChild.execFile("curl", ["-L", "-s", "-S", "--max-time", "600", "-o", zip, url], { maxBuffer: 1024 * 1024 * 8 }, function (err) {
    if (err) { acFfmpegMsg("Download failed: " + (err.message || err)); return; }
    acFfmpegMsg("Extracting…");
    if (isWin) {
      var outdir = pathx.join(os.tmpdir(), "dopetool_ff_" + Date.now());
      try { fsx.mkdirSync(outdir, { recursive: true }); } catch (e2) {}
      acChild.exec('tar -xf "' + zip + '" -C "' + outdir + '"', function (e3) {
        if (e3) { acFfmpegMsg("Extract failed: " + e3.message); return; }
        var found = acFindFileRecursive(outdir, "ffmpeg.exe");
        if (!found) { acFfmpegMsg("Couldn't find ffmpeg.exe in the download."); return; }
        try { fsx.copyFileSync(found, target); } catch (e4) { acFfmpegMsg("Copy failed: " + e4.message); return; }
        acVerifyBundledFfmpeg(target);
      });
    } else {
      acChild.exec('unzip -o "' + zip + '" -d "' + dir + '"', function (e3) {
        if (e3) { acFfmpegMsg("Extract failed: " + e3.message); return; }
        try { fsx.chmodSync(target, parseInt("755", 8)); } catch (e4) {}
        acVerifyBundledFfmpeg(target);
      });
    }
  });
}

// ---- Setup state (key + ffmpeg) reflected in the modal and the tab summary ----
function acRefreshFfmpegState() {
  acFindFfmpeg(function (ff) {
    var st = document.getElementById("acFfmpegState");
    if (st) { st.innerText = ff ? "✓ ready" : "not installed"; st.style.color = ff ? "#8fe0c0" : "#8888aa"; }
    acUpdateSetupSummary(ff);
  });
}
function acUpdateSetupSummary(ff) {
  var el = document.getElementById("acSetupSummary");
  if (!el) return;
  var key = getGroqKey();
  el.innerHTML = "Key " + (key ? "✓" : "✗") + " · ffmpeg " + (ff ? "✓" : "✗");
  el.style.color = (key && ff) ? "#8fe0c0" : "#8888aa";
}
function acPrepareAudio(inputPath, cb) {
  var os = require("os"), fsx = require("fs"), pathx = require("path");
  var size = 0;
  try { size = fsx.statSync(inputPath).size; } catch (e) {}
  acFindFfmpeg(function (ff) {
    if (!ff) {
      // No ffmpeg — send the file as-is, but warn early if it's clearly too big
      if (size > GROQ_MAX_BYTES) {
        cb("File is " + Math.round(size / 1048576) + " MB — over Groq's ~25 MB limit. Install ffmpeg so DopeTool can compress it, or use a smaller/compressed audio file.");
      } else { cb(null, inputPath, null); }
      return;
    }
    acTick("Preparing audio");
    var out = pathx.join(os.tmpdir(), "dopetool_ac_" + Date.now() + ".mp3");
    var args = ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out];
    acChild.execFile(ff, args, { maxBuffer: 1024 * 1024 * 16, timeout: 300000 }, function (err) {
      acStopTick();
      if (err) { cb(null, inputPath, null); return; } // fall back to original on transcode failure
      var osize = 0; try { osize = fsx.statSync(out).size; } catch (e2) {}
      if (osize > GROQ_MAX_BYTES) {
        cb("Even compressed, this is " + Math.round(osize / 1048576) + " MB (over ~25 MB). Try a shorter clip.");
        return;
      }
      cb(null, out, out); // third arg = temp file to clean up later
    });
  });
}

// Group Whisper words into N-word caption segments
function acGroupWords(words, n) {
  var segs = [];
  for (var i = 0; i < words.length; i += n) {
    var chunk = words.slice(i, i + n);
    var txt = chunk.map(function (w) { return (w.word || "").replace(/^\s+|\s+$/g, ""); }).join(" ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!txt) continue;
    var a = chunk[0].start, b = chunk[chunk.length - 1].end;
    if (typeof a !== "number") a = (segs.length ? segs[segs.length - 1].outSec : 0);
    if (typeof b !== "number" || b <= a) b = a + 0.3;
    segs.push({ inSec: a, outSec: b, text: txt });
  }
  // Hold each caption until the next one starts (removes flicker on tiny gaps),
  // but don't linger more than ~1.2s into a real pause.
  for (var k = 0; k < segs.length - 1; k++) {
    var gap = segs[k + 1].inSec - segs[k].outSec;
    if (gap > 0) segs[k].outSec = (gap <= 1.2) ? segs[k + 1].inSec : segs[k].outSec + 0.4;
  }
  return segs;
}

function acSecToTC(s) {
  if (s < 0 || isNaN(s)) s = 0;
  var ms = Math.floor((s % 1) * 1000), t = Math.floor(s);
  function p(n, w) { n = "" + n; while (n.length < w) n = "0" + n; return n; }
  return p(Math.floor(t / 3600), 2) + ":" + p(Math.floor((t % 3600) / 60), 2) + ":" + p(t % 60, 2) + "," + p(ms, 3);
}

function acBuildSrt(segs) {
  var out = [];
  for (var i = 0; i < segs.length; i++) {
    out.push((i + 1) + "\n" + acSecToTC(segs[i].inSec) + " --> " + acSecToTC(segs[i].outSec) + "\n" + segs[i].text);
  }
  return out.join("\n\n") + "\n";
}

// After transcription: either show the editable review, or create straight away.
var acSegments = [];
function acFinish(segs) {
  var chk = document.getElementById("autoCapReviewChk");
  if (chk && chk.checked) acShowReview(segs);
  else acImportSegments(segs);
}

function acShortTC(s) {
  if (s < 0 || isNaN(s)) s = 0;
  var t = Math.floor(s), mm = Math.floor(t / 60), ss = t % 60;
  return (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
}

// Editable review: one row per caption (timecode + text field). Fix words, then create.
function acShowReview(segs) {
  acSegments = segs.slice();
  var list = document.getElementById("autoCapReviewList");
  var panel = document.getElementById("autoCapReview");
  if (!list || !panel) { acImportSegments(segs); return; }
  list.innerHTML = "";
  acSegments.forEach(function (seg, i) {
    var row = document.createElement("div");
    row.className = "acReviewRow";
    var tc = document.createElement("span");
    tc.className = "acReviewTC";
    tc.innerText = acShortTC(seg.inSec);
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "acReviewInput";
    inp.value = seg.text;
    inp.setAttribute("data-idx", i);
    row.appendChild(tc);
    row.appendChild(inp);
    list.appendChild(row);
  });
  panel.classList.remove("hidden");
  acProgress("Review " + acSegments.length + " captions, fix any words, then Create.");
  try { panel.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {}
}

function acHideReview() {
  var panel = document.getElementById("autoCapReview");
  if (panel) panel.classList.add("hidden");
  acSegments = [];
}

// Pull the latest edits from the review inputs into acSegments
function acSyncReviewToSegments() {
  var inputs = document.querySelectorAll("#autoCapReviewList .acReviewInput");
  for (var i = 0; i < inputs.length; i++) {
    var idx = parseInt(inputs[i].getAttribute("data-idx"), 10);
    if (acSegments[idx]) acSegments[idx].text = (inputs[i].value || "").replace(/^\s+|\s+$/g, "");
  }
}

function acCreateFromReview() {
  acSyncReviewToSegments();
  var segs = acSegments.filter(function (s) { return s.text; });
  var panel = document.getElementById("autoCapReview");
  if (panel) panel.classList.add("hidden");
  acImportSegments(segs);
}

// ---- Full transcript view (one caption per line; copyable + editable) ----
function acShowTranscript() {
  acSyncReviewToSegments();
  var ta = document.getElementById("acTranscriptText");
  var overlay = document.getElementById("acTranscriptOverlay");
  var count = document.getElementById("acTranscriptCount");
  if (!ta || !overlay) return;
  ta.value = acSegments.map(function (s) { return s.text; }).join("\n");
  if (count) count.innerText = acSegments.length + " captions";
  overlay.classList.remove("hidden");
  try { ta.focus(); } catch (e) {}
}
function acApplyTranscript() {
  var ta = document.getElementById("acTranscriptText");
  if (!ta) return;
  var lines = ta.value.split(/\r?\n/).map(function (l) { return l.replace(/^\s+|\s+$/g, ""); }).filter(function (l) { return l.length; });
  // Map back by position (keeps each caption's timing)
  for (var i = 0; i < acSegments.length; i++) { if (i < lines.length) acSegments[i].text = lines[i]; }
  acShowReview(acSegments); // re-render the editable rows with the applied text
  var overlay = document.getElementById("acTranscriptOverlay");
  if (overlay) overlay.classList.add("hidden");
  if (lines.length !== acSegments.length) acProgress("Applied — note: line count changed, captions matched by position.");
}
function acCopyTranscript() {
  var ta = document.getElementById("acTranscriptText");
  if (!ta) return;
  try { ta.select(); ta.setSelectionRange(0, ta.value.length); } catch (e) {}
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  var btn = document.getElementById("acTranscriptCopy");
  if (btn) { var t = btn.innerText; btn.innerText = ok ? "✓ Copied" : "Press Ctrl/Cmd+C"; setTimeout(function () { btn.innerText = t; }, 1400); }
}

// Write a temp SRT and reuse importCaptions() with the picked style
function acImportSegments(segs) {
  if (!segs.length) { acProgress("No speech found in the audio."); return; }
  var os = require("os"), fsx = require("fs"), pathx = require("path");
  var tmp = pathx.join(os.tmpdir(), "dopetool_autocap_" + Date.now() + ".srt");
  try { fsx.writeFileSync(tmp, acBuildSrt(segs), "utf8"); } catch (e) { acProgress("Couldn't write temp SRT: " + e.message); return; }
  var style = selectedAutoStyle || {};
  var cfg = {
    srtPath: toJsxPath(tmp),
    font: style.font || "Arial",
    fontSize: style.fontSize || 72,
    textColor: (style.color || "#FFFFFF").replace("#", ""),
    strokeColor: style.strokeColor || "000000",
    strokeWidth: style.strokeWidth || 0,
    tracking: style.tracking || 0,
    autoLeading: style.autoLeading !== false,
    leading: style.leading || 0,
    effects: style.effects || [],
    layerStyles: style.layerStyles || [],
    verticalOffset: parseFloat(document.getElementById("autoCapVOffset").value) || 200,
    fadeFrames: parseInt(document.getElementById("autoCapFade").value) || 0,
    useNull: document.getElementById("autoCapUseNull").checked
  };
  acProgress("Creating " + segs.length + " caption layers…");
  var esc = JSON.stringify(cfg).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  csInterface.evalScript('importCaptions("' + esc + '")', function (result) {
    if (result && result.indexOf("ok:") === 0) acProgress("✓ " + result.split(":")[1] + " captions created!");
    else acProgress(result || "Caption import failed.");
  });
}

// Roman-Urdu house style (from the Adeel Burki caption guide) — the exact
// spelling fingerprint the romanizer should follow.
// Roman-Urdu house style (from the Adeel Burki caption guide) — spelling rules
// for the URDU/HINDI words only (English words are handled by RULE 2 below).
var ROMAN_URDU_STYLE =
  "- all lowercase, EXCEPT proper nouns (Abba, Lahore, Patriata). Never auto-capitalize the first word of a line.\n" +
  "- Spell these function words EXACTLY like this: tou (=to/then, never 'to' or 'toh'); keh (=that/ke); aap/ap/apka/apki/apko; hai/hain/hoon; tha/thi/thay (never 'the'); mai/main/mainay/meine; nahi (never 'nahin'/'nhi'); he or hi (=only/just); per (=on, never 'par'); se; ka/ki; bohut (never 'bahut'); itna/itni; zyada (not 'ziada'); aur; phir; lekin; kyun keh (=because); yeh/ye; woh/wohi; aik (=one, prefer over 'ek'); beta.\n" +
  "- Long vowels: aa (aap, yaad, maangi, awaaz), oo (pooray, sukoon, hoon, zaroor), ee/i (cheez, achi). Use '-ay' endings (pooray, hamaray, kaisay, thay, gey). Diphthong ai (aisa, hai, aik).\n" +
  "- Aspiration as digraphs: kh, gh, ph, bh, ch, th, jh, sh (khawab, ghar, phir, bhi, mujhe, shishay). Double a consonant for hard sounds (abba, takk). Apostrophe only for a syllable break (ban'nay).\n" +
  "- Nasal endings vary — dropped (doosro, logo, nahi), '-ein' (cheezein, karein, milein), or '-on/-un/-an/-in' (cheezon, kahan, hoon, hain, mein). Do NOT over-normalize; this casual inconsistency is correct.\n" +
  "- Minimal punctuation: no commas or periods between phrases; keep question marks (kaisay ban sakti hoon?).\n";

// Romanize each segment's text to Roman Urdu / Hinglish, preserving segmentation & timing
function acRomanize(key, segs, cb) {
  acTick("Romanizing to Roman Urdu");
  var sys =
    "You convert spoken Urdu/Hindi subtitles into a specific channel's Roman-Urdu house style. Apply ALL rules below to EVERY line and EVERY word — process the whole transcript, never skip lines.\n\n" +
    "RULE 1 — Latin letters only: output ONLY the Latin alphabet (a-z). NEVER output Devanagari (e.g. हिंदी) or Urdu/Arabic (e.g. اردو) script anywhere.\n\n" +
    "RULE 2 — ENGLISH WORDS STAY ENGLISH (strict): any word that is actually an English word — a normal English word, a brand, or a common borrowed tech/business term — MUST be written in its correct, standard English spelling. NEVER spell an English word phonetically in Urdu style. This applies EVEN IF the transcription rendered that English word in Urdu/Hindi script or mis-spelled it: recognise it and restore the real English spelling. E.g. kansistantli->consistently, bijness->business, mobail->mobile, vidiyo->video, seve->save, inwest->invest, kantent->content, budjet->budget, markeeting->marketing. Words like: consistently, business, content, video, mobile, invest, save, decide, deserve, venue, book, management, stage, moisturiser, plan, link, bill, school, budget, market, profit, brand, growth, system, phone — always in English.\n\n" +
    "RULE 3 — Roman-Urdu spelling for the Urdu/Hindi words:\n" + ROMAN_URDU_STYLE +
    "\nDo NOT translate Urdu/Hindi words into English, and do NOT add, drop, merge or reorder words. Keep the same words in the same order.\n\n" +
    "Example input: 1. मैं ने तो business में consistently invest करना था\n" +
    "Example output: 1. mainay tou business mein consistently invest karna tha\n" +
    "Return EXACTLY the same number of lines, each prefixed with its number and a period, same order, Latin letters only. No commentary.";
  var NON_LATIN = /[\u0900-\u097F\u0600-\u06FF]/; // Devanagari or Arabic/Urdu
  var CHUNK = 40; // process in batches so long transcripts never get truncated
  // Start from a copy (raw text) so any un-processed line still ships something.
  var out = segs.map(function (s) { return { inSec: s.inSec, outSec: s.outSec, text: s.text }; });
  var pos = 0;

  function processChunk() {
    if (pos >= segs.length) { acStopTick(); cb(null, out); return; }
    var base = pos;
    var slice = segs.slice(base, base + CHUNK);
    var lines = slice.map(function (s, i) { return (i + 1) + ". " + s.text; }).join("\n");
    attemptChunk(slice, base, lines, 1, function () { pos = base + slice.length; processChunk(); });
  }

  function attemptChunk(slice, base, lines, triesLeft, done) {
    groqChat(key, sys, lines, function (err, data) {
      if (err) { if (triesLeft > 0) { attemptChunk(slice, base, lines, triesLeft - 1, done); return; } done(); return; }
      var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) { if (triesLeft > 0) { attemptChunk(slice, base, lines, triesLeft - 1, done); return; } done(); return; }
      var map = {};
      content.split(/\n+/).forEach(function (ln) { var m = ln.match(/^\s*(\d+)\.\s*(.+)$/); if (m) map[parseInt(m[1], 10)] = m[2].replace(/^\s+|\s+$/g, ""); });
      var bad = 0;
      for (var i = 0; i < slice.length; i++) { if (map[i + 1] != null) out[base + i].text = map[i + 1]; if (NON_LATIN.test(out[base + i].text)) bad++; }
      // If this chunk still has lots of Hindi/Urdu script, retry it once
      if (bad > slice.length * 0.2 && triesLeft > 0) { attemptChunk(slice, base, lines, triesLeft - 1, done); return; }
      done();
    });
  }
  processChunk();
}

// Conservative cleanup: fix clear mis-transcriptions without romanizing,
// translating, or altering the language/script/word order.
function acCorrect(key, segs, cb) {
  acTick("Cleaning up transcript");
  var lines = segs.map(function (s, i) { return (i + 1) + ". " + s.text; }).join("\n");
  var sys =
    "You lightly clean subtitle lines from a speech transcript. Fix ONLY clear errors: " +
    "mis-spelled or phonetically-wrong words (e.g. 'seve' -> 'save', 'kansistantli' -> 'consistently'), " +
    "wrong homophones, and obvious capitalization/punctuation. Keep the SAME language and script, the SAME words in the SAME order — " +
    "do not translate, rephrase, add, drop, merge or reorder words. " +
    "Return EXACTLY the same number of lines, each prefixed with its number and a period, in the same order. No commentary.";
  groqChat(key, sys, lines, function (err, data) {
    acStopTick();
    if (err) { cb(null, segs); return; } // never block on cleanup — fall back to raw
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) { cb(null, segs); return; }
    var map = {};
    content.split(/\n+/).forEach(function (ln) { var m = ln.match(/^\s*(\d+)\.\s*(.+)$/); if (m) map[parseInt(m[1], 10)] = m[2].replace(/^\s+|\s+$/g, ""); });
    cb(null, segs.map(function (s, i) { return { inSec: s.inSec, outSec: s.outSec, text: map[i + 1] || s.text }; }));
  });
}

function autoCapRun() {
  var key = getGroqKey();
  if (!key) { acProgress("Enter your Groq API key first."); return; }
  if (!autoCapAudioPath) { acProgress("Drop or browse an audio/video file first."); return; }
  if (!selectedAutoStyle) { acProgress("Pick a text style first."); return; }
  var n = Math.max(1, Math.min(12, parseInt(document.getElementById("autoCapWords").value, 10) || 4));
  var lang = document.getElementById("autoCapLang").value;
  var roman = document.getElementById("autoCapRoman").checked;

  function cleanup(tmp) { if (!tmp) return; try { require("fs").unlinkSync(tmp); } catch (e) {} }

  acProgress("Preparing audio…");
  acPrepareAudio(autoCapAudioPath, function (prepErr, uploadPath, tmpFile) {
    if (prepErr) { acStopTick(); acProgress(prepErr); return; }
    acTick("Transcribing with Groq Whisper");
    groqTranscribe(key, uploadPath, lang, function (err, data) {
      acStopTick();
      cleanup(tmpFile);
      if (err) { acProgress("Transcription failed: " + err); return; }
      var words = (data && data.words) || [];
      var segs;
      if (words.length) {
        segs = acGroupWords(words, n);
      } else {
        var segsOnly = (data && data.segments) || [];
        if (!segsOnly.length) { acProgress("No speech detected."); return; }
        segs = segsOnly.map(function (s) { return { inSec: s.start, outSec: s.end, text: (s.text || "").replace(/^\s+|\s+$/g, "") }; });
      }
      if (roman) acRomanize(key, segs, function (e2, r) { if (e2) acProgress("Romanize failed: " + e2); else acFinish(r); });
      else acCorrect(key, segs, function (e2, r) { acFinish(r || segs); });
    });
  });
}

(function () {
  var keyInput = document.getElementById("autoCapKey");
  var keySave = document.getElementById("autoCapKeySave");
  if (keySave) keySave.addEventListener("click", function () {
    var v = (keyInput.value || "").replace(/^\s+|\s+$/g, "");
    try { localStorage.setItem("dopetool_groq_key", v); } catch (e) {}
    refreshGroqKeyState();
    acRefreshFfmpegState();
    acProgress(v ? "Groq key saved." : "Groq key cleared.");
  });

  // Setup modal open / close
  var setupOverlay = document.getElementById("acSetupOverlay");
  var setupOpen = document.getElementById("acSetupOpen");
  var setupClose = document.getElementById("acSetupClose");
  if (setupOpen) setupOpen.addEventListener("click", function () {
    if (setupOverlay) setupOverlay.classList.remove("hidden");
    refreshGroqKeyState();
    acRefreshFfmpegState();
  });
  if (setupClose) setupClose.addEventListener("click", function () { if (setupOverlay) setupOverlay.classList.add("hidden"); });
  if (setupOverlay) setupOverlay.addEventListener("click", function (e) { if (e.target === setupOverlay) setupOverlay.classList.add("hidden"); });

  var ffInstall = document.getElementById("acFfmpegInstall");
  if (ffInstall) ffInstall.addEventListener("click", acInstallFfmpeg);

  // Cleanup / Roman-Urdu model picker
  var modelSel = document.getElementById("autoCapModel");
  if (modelSel) {
    var savedModel = getGroqModel();
    var hasOpt = false;
    for (var mo = 0; mo < modelSel.options.length; mo++) if (modelSel.options[mo].value === savedModel) hasOpt = true;
    if (hasOpt) modelSel.value = savedModel;
    modelSel.addEventListener("change", function () {
      try { localStorage.setItem("dopetool_groq_model", this.value); } catch (e) {}
      acProgress("Model set to " + this.options[this.selectedIndex].text.split(" — ")[0] + ".");
    });
  }

  var browse = document.getElementById("autoCapBrowse");
  if (browse) browse.addEventListener("click", function () {
    csInterface.evalScript("pickAudioFile()", function (r) { if (r && r !== "undefined" && r !== "") setAutoCapFile(r); });
  });

  var zone = document.getElementById("autoCapFile");
  if (zone) {
    function stop(e) { e.preventDefault(); e.stopPropagation(); }
    ["dragenter", "dragover"].forEach(function (ev) { zone.addEventListener(ev, function (e) { stop(e); zone.classList.add("dropActive"); }); });
    ["dragleave", "dragend"].forEach(function (ev) { zone.addEventListener(ev, function (e) { stop(e); zone.classList.remove("dropActive"); }); });
    zone.addEventListener("drop", function (e) {
      stop(e); zone.classList.remove("dropActive");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var p = files[0].path || "";
      if (!p) { acProgress("Couldn't read the dropped file's path."); return; }
      setAutoCapFile(p);
    });
  }

  var runBtn = document.getElementById("autoCapRunBtn");
  if (runBtn) runBtn.addEventListener("click", function () { acHideReview(); autoCapRun(); });

  var createBtn = document.getElementById("autoCapCreateBtn");
  if (createBtn) createBtn.addEventListener("click", acCreateFromReview);
  var reviewCancel = document.getElementById("autoCapReviewCancel");
  if (reviewCancel) reviewCancel.addEventListener("click", function () { acHideReview(); acProgress("Ready"); });

  // Full transcript modal
  var trBtn = document.getElementById("autoCapTranscriptBtn");
  if (trBtn) trBtn.addEventListener("click", acShowTranscript);
  var trCopy = document.getElementById("acTranscriptCopy");
  if (trCopy) trCopy.addEventListener("click", acCopyTranscript);
  var trApply = document.getElementById("acTranscriptApply");
  if (trApply) trApply.addEventListener("click", acApplyTranscript);
  var trClose = document.getElementById("acTranscriptClose");
  if (trClose) trClose.addEventListener("click", function () { var o = document.getElementById("acTranscriptOverlay"); if (o) o.classList.add("hidden"); });
  var trOverlay = document.getElementById("acTranscriptOverlay");
  if (trOverlay) trOverlay.addEventListener("click", function (e) { if (e.target === trOverlay) trOverlay.classList.add("hidden"); });
})();

// ---- SORT CONTROL ----
document.getElementById("sortSelect").addEventListener("change", function () {
  currentSort = this.value;
  if (currentClient) renderCurrent();
});

// ---- MANUAL COLOR ADD ----
function normalizeHex(v) {
  if (!v) return null;
  v = v.toString().replace(/[^0-9a-fA-F]/g, "");
  if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
  if (v.length !== 6) return null;
  return "#" + v.toUpperCase();
}

function syncManualColor(hex) {
  var norm = normalizeHex(hex);
  var preview = document.getElementById("manualColorPreview");
  if (norm) {
    preview.style.backgroundColor = norm;
    document.getElementById("manualColorPicker").value = norm.toLowerCase();
    preview.classList.remove("invalid");
  } else {
    preview.classList.add("invalid");
  }
}

document.getElementById("manualColorBtn").addEventListener("click", function () {
  var form = document.getElementById("manualColorForm");
  document.getElementById("addForm").classList.add("hidden");
  var willShow = form.classList.contains("hidden");
  form.classList.toggle("hidden");
  if (willShow) {
    document.getElementById("manualColorName").value = "";
    document.getElementById("manualColorHex").value = "#4C72FF";
    syncManualColor("#4C72FF");
    document.getElementById("manualColorName").focus();
  }
});

document.getElementById("manualColorPicker").addEventListener("input", function () {
  document.getElementById("manualColorHex").value = this.value.toUpperCase();
  syncManualColor(this.value);
});

document.getElementById("manualColorHex").addEventListener("input", function () {
  syncManualColor(this.value);
});

document.getElementById("manualColorCancelBtn").addEventListener("click", function () {
  document.getElementById("manualColorForm").classList.add("hidden");
});

document.getElementById("manualColorSaveBtn").addEventListener("click", function () {
  var name = document.getElementById("manualColorName").value.trim();
  var hex = normalizeHex(document.getElementById("manualColorHex").value);
  if (!name) { document.getElementById("output").innerText = "Please enter a color name."; return; }
  if (!hex) { document.getElementById("output").innerText = "Enter a valid hex, e.g. #4C72FF."; return; }
  document.getElementById("output").innerText = "Saving...";
  db.collection("colors").add({ name: name, hex: hex, client: currentClient, favorite: false, createdAt: Date.now() })
    .then(function () {
      document.getElementById("output").innerText = "Color added.";
      document.getElementById("manualColorForm").classList.add("hidden");
      loadClientLibrary("colors");
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
});

// ---- ADD ASSET (auto-listed from the GitHub 'assets' release) ----
var releaseAssetsMap = {}; // filename -> download_url

function guessCategory(filename) {
  var n = (filename || "").toLowerCase();
  if (/\.(mp4|mov|avi|mkv|webm|m4v|gif)$/.test(n)) return "video";
  if (/\.(aep|aet|zip)$/.test(n)) return "template";
  return "image";
}

function loadReleaseAssets() {
  var sel = document.getElementById("assetFilename");
  sel.innerHTML = '<option value="">Loading files…</option>';
  releaseAssetsMap = {};
  fetch("https://api.github.com/repos/" + GITHUB_REPO + "/releases/tags/" + GITHUB_ASSETS_TAG + "?t=" + Date.now())
    .then(function (res) { if (!res.ok) throw new Error(res.status === 404 ? "no 'assets' release yet" : "HTTP " + res.status); return res.json(); })
    .then(function (rel) {
      var assets = (rel && rel.assets) || [];
      if (!assets.length) { sel.innerHTML = '<option value="">No files on the release yet</option>'; return; }
      sel.innerHTML = '<option value="">Select a file…</option>';
      assets.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      assets.forEach(function (a) {
        releaseAssetsMap[a.name] = a.browser_download_url;
        var o = document.createElement("option");
        o.value = a.name;
        o.textContent = a.name;
        sel.appendChild(o);
      });
    })
    .catch(function (e) { sel.innerHTML = '<option value="">Could not load (' + e.message + ')</option>'; });
}

document.getElementById("assetToggleBtn").addEventListener("click", function () {
  var form = document.getElementById("assetForm");
  document.getElementById("addForm").classList.add("hidden");
  var willShow = form.classList.contains("hidden");
  form.classList.toggle("hidden");
  if (willShow) {
    document.getElementById("assetName").value = "";
    loadReleaseAssets();
  }
});

document.getElementById("assetRefreshBtn").addEventListener("click", loadReleaseAssets);

// Picking a file auto-fills the name + category
document.getElementById("assetFilename").addEventListener("change", function () {
  var fn = this.value;
  if (!fn) return;
  document.getElementById("assetCategory").value = guessCategory(fn);
  if (!document.getElementById("assetName").value.trim()) {
    document.getElementById("assetName").value = fn.replace(/\.[^.]+$/, "").replace(/[_.\-]+/g, " ").trim();
  }
});

document.getElementById("assetCancelBtn").addEventListener("click", function () {
  document.getElementById("assetForm").classList.add("hidden");
  document.getElementById("assetName").value = "";
});

document.getElementById("assetSaveBtn").addEventListener("click", function () {
  var name = document.getElementById("assetName").value.trim();
  var category = document.getElementById("assetCategory").value;
  var filename = document.getElementById("assetFilename").value;
  if (!filename) { document.getElementById("output").innerText = "Pick a file from the release."; return; }
  if (!name) { document.getElementById("output").innerText = "Please enter a display name."; return; }
  document.getElementById("output").innerText = "Saving...";
  db.collection("assets").add({
    name: name, client: currentClient, category: category, filename: filename,
    type: "asset", url: releaseAssetsMap[filename] || assetUrl(filename), createdAt: Date.now()
  })
    .then(function () {
      document.getElementById("output").innerText = "Asset added.";
      document.getElementById("assetForm").classList.add("hidden");
      document.getElementById("assetName").value = "";
      loadClientLibrary("assets");
    })
    .catch(function (err) { document.getElementById("output").innerText = "Save failed: " + err.message; });
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

// Download an asset from GitHub Releases (cached locally) and import it into AE.
// Images/videos are added to the active comp; templates (.aep) are imported.
function makeAssetHandler(data) {
  return function () {
    var outputEl = document.getElementById("output");
    var filename = data.filename;
    if (!filename) { outputEl.innerText = "This asset has no filename."; return; }
    var url = data.url || assetUrl(filename);
    var category = data.category || "image";
    var addToComp = (category !== "template");
    var dir = getAssetsDir();
    var localPath = nodePath.join(dir, filename);
    var jsxPath = toJsxPath(localPath);

    function doImport() {
      outputEl.innerText = "Importing…";
      csInterface.evalScript('importAsset("' + jsxPath + '", ' + (addToComp ? "true" : "false") + ')', function (r) { outputEl.innerText = r; });
    }

    if (nodeFs.existsSync(localPath)) { doImport(); return; }

    outputEl.innerText = "Downloading " + filename + "…";
    fetch(url + "?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("Not on GitHub Releases yet (HTTP " + res.status + "). Upload " + filename + " to the '" + GITHUB_ASSETS_TAG + "' release.");
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        try { if (!nodeFs.existsSync(dir)) nodeFs.mkdirSync(dir, { recursive: true }); }
        catch (e) { outputEl.innerText = "Could not create folder: " + e.message; return; }
        try { nodeFs.writeFileSync(localPath, Buffer.from(new Uint8Array(buffer))); }
        catch (e) { outputEl.innerText = "Write failed: " + e.message; return; }
        doImport();
      })
      .catch(function (err) { outputEl.innerText = "Download failed: " + err.message; });
  };
}

// Small star marker for favorited items.
function favMark(fav) {
  return fav ? '<span class="favStar" title="Favorite">★</span>' : '';
}

// ---- RENDER ITEMS ----
function renderItems(items, tab, targetEl) {
  var contentEl = targetEl || document.getElementById("libraryContent");
  contentEl.innerHTML = "";
  // Colors render as a compact swatch grid; everything else as list cards.
  contentEl.classList.toggle("library--grid", tab === "colors");
  if (items.length === 0) {
    contentEl.innerHTML = '<div class="emptyState">No items</div>';
    return;
  }

  // ---- Colors: swatch grid ----
  if (tab === "colors") {
    for (var ci = 0; ci < items.length; ci++) {
      var cEntry = items[ci];
      var cData = cEntry.data;
      var tile = document.createElement("div");
      tile.className = "colorTile" + (cData.favorite ? " isFav" : "");
      tile.innerHTML =
        '<div class="colorTileSwatch" style="background-color:' + cData.hex + '">' + favMark(cData.favorite) + '</div>' +
        '<div class="colorTileName">' + cData.name + '</div>' +
        '<div class="colorTileHex">' + cData.hex + '</div>';
      tile.addEventListener("click", makeColorHandler(cData.hex));
      addLongPressHandler(tile, cEntry, tab);
      contentEl.appendChild(tile);
    }
    return;
  }

  for (var idx = 0; idx < items.length; idx++) {
    var entry = items[idx];
    var data = entry.data;
    var card = document.createElement("div");
    card.className = "card" + (data.favorite ? " isFav" : "");

    if (tab === "fonts") {
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
      else card.addEventListener("click", makeEffectWithPropsHandler(data.effects && data.effects.length > 0 ? { effects: data.effects } : { matchName: data.matchName || data.type, props: data.props || [] }));
    } else if (tab === "animations") {
      card.innerHTML =
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">Animation Preset</div></div>' +
        '<span class="badge anim">ANIM</span>';
      card.addEventListener("click", makeFfxHandler(data.url, data.filename));
    } else if (tab === "assets") {
      var cat = data.category || "image";
      var catLabel = cat === "template" ? "TEMPLATE" : (cat === "video" ? "VIDEO" : "IMAGE");
      card.innerHTML =
        '<div class="cardInfo"><div class="cardTitle">' + data.name + '</div>' +
        '<div class="cardSub">' + (data.filename || "") + '</div></div>' +
        '<span class="badge asset ' + cat + '">' + catLabel + '</span>';
      card.addEventListener("click", makeAssetHandler(data));
    }

    // Pin a star on favorited cards
    if (data.favorite) {
      var titleEl = card.querySelector(".cardTitle");
      if (titleEl) titleEl.insertAdjacentHTML("afterbegin", favMark(true) + " ");
    }

    addLongPressHandler(card, entry, tab);
    contentEl.appendChild(card);
  }
}

// ---- LONG PRESS (cards) ----
function addLongPressHandler(element, entryRef, cat) {
  var timer = null;
  var didLongPress = false;
  function openCtx(x, y) {
    if (cat) currentTab = cat; // act on the collection this item belongs to
    activeContextId = entryRef.id;
    activeContextItem = entryRef.data;
    showContextMenu(x, y);
  }
  element.addEventListener("mousedown", function (e) {
    didLongPress = false;
    timer = setTimeout(function () { didLongPress = true; openCtx(e.pageX, e.pageY); }, 600);
  });
  element.addEventListener("mouseup", function () { clearTimeout(timer); });
  element.addEventListener("mouseleave", function () { clearTimeout(timer); });
  element.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    openCtx(e.pageX, e.pageY);
  });
  element.addEventListener("click", function (e) {
    if (didLongPress) { e.stopImmediatePropagation(); didLongPress = false; }
  }, true);
}

function showContextMenu(x, y) {
  document.getElementById("clientContextMenu").classList.add("hidden");
  var favBtn = document.getElementById("ctxFavorite");
  if (favBtn) favBtn.innerText = (activeContextItem && activeContextItem.favorite) ? "☆ Unfavorite" : "⭐ Favorite";
  var menu = document.getElementById("contextMenu");
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.classList.remove("hidden");
}
function hideContextMenu() { document.getElementById("contextMenu").classList.add("hidden"); }

document.getElementById("ctxFavorite").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeContextId) return;
  var newFav = !(activeContextItem && activeContextItem.favorite);
  hideContextMenu();
  document.getElementById("output").innerText = newFav ? "Favorited." : "Unfavorited.";
  db.collection(collectionMap[currentTab]).doc(activeContextId).update({ favorite: newFav })
    .then(function () { loadClientLibrary(currentTab); })
    .catch(function (err) { document.getElementById("output").innerText = "Update failed: " + err.message; });
});

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

// ---- RELOAD PANEL ----
// Re-loads the ExtendScript file (so updated AE-side code takes effect) and
// then reloads the HTML page — no need to close/reopen the panel.
function reloadPanel() {
  var out = document.getElementById("output");
  if (out) out.innerText = "Reloading…";
  try {
    var jsxPath = toJsxPath(extensionPath + "/jsx/hostscript.jsx");
    csInterface.evalScript('$.evalFile("' + jsxPath + '")', function () {
      window.location.reload();
    });
  } catch (e) {
    window.location.reload();
  }
}

var reloadBtnEl = document.getElementById("reloadBtn");
if (reloadBtnEl) reloadBtnEl.addEventListener("click", reloadPanel);

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

  // Fetch a file with retries + validation. Only writes when we got a real,
  // non-empty body, so a transient CDN hiccup can't leave a corrupt file.
  function fetchFile(file, attempt) {
    attempt = attempt || 1;
    var maxAttempts = 4;
    fetch(GITHUB_RAW_BASE + file.remote + "?t=" + Date.now() + "_" + attempt)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (content) {
        // GitHub raw serves "404: Not Found" as a 200-ish body on some edges.
        if (!content || content.length < 20 || content.indexOf("404: Not Found") === 0) {
          throw new Error("empty/invalid body");
        }
        nodeFs.writeFileSync(extensionPath + file.local, content, "utf8");
        done++;
        if (done + failed.length === files.length) finishUpdate(newVersion, banner, failed);
      })
      .catch(function () {
        if (attempt < maxAttempts) {
          setTimeout(function () { fetchFile(file, attempt + 1); }, attempt * 700);
          return;
        }
        failed.push(file.local); done++;
        if (done + failed.length === files.length) finishUpdate(newVersion, banner, failed);
      });
  }

  files.forEach(function (file) { fetchFile(file, 1); });
}

function showWhatsNew(version) {
  fetch(GITHUB_RAW_BASE + "/changelog.json?t=" + Date.now())
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var items = data[version];
      if (!items || items.length === 0) return;
      var overlay = document.createElement("div");
      overlay.className = "whatsNewOverlay";
      var listHtml = items.map(function (i) { return "<li>" + i + "</li>"; }).join("");
      overlay.innerHTML =
        '<div class="whatsNewModal">' +
          '<div class="whatsNewTitle">What\'s New</div>' +
          '<div class="whatsNewVersion">Version ' + version + '</div>' +
          '<ul class="whatsNewList">' + listHtml + '</ul>' +
          '<button class="whatsNewCloseBtn">Got it</button>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.querySelector(".whatsNewCloseBtn").addEventListener("click", function () { overlay.remove(); });
    })
    .catch(function () {});
}

function finishUpdate(newVersion, banner, failed) {

  if (failed.length > 0) {
    banner.innerHTML = '<span>Update partially failed: ' + failed.join(", ") + '</span><button id="retryUpdateBtn">Retry</button>';
    var retryBtn = document.getElementById("retryUpdateBtn");
    if (retryBtn) retryBtn.addEventListener("click", function () { performUpdate(newVersion); });
  } else {
    setLocalVersion(newVersion);
    showVersion();
    banner.innerHTML = '<span>✓ Updated to v' + newVersion + ' — reload to apply</span><button id="reloadNowBtn">Reload</button>';
    var reloadNowBtn = document.getElementById("reloadNowBtn");
    if (reloadNowBtn) reloadNowBtn.addEventListener("click", reloadPanel);
    showWhatsNew(newVersion);
  }
}

// ---- INIT ----
window.addEventListener("DOMContentLoaded", function () {
  showVersion();
  setTimeout(checkForUpdate, 1000);
  // The rail nav already loads the starting tab's data (loadForTab).
});

// ---- FONT AUTO-INSTALLATION ----
var GITHUB_FONTS_BASE = GITHUB_RAW_BASE + "/fonts";
var GITHUB_FONTS_API = "https://api.github.com/repos/" + GITHUB_REPO + "/contents/fonts";

function isWindows() {
  // process.platform is the most reliable signal under Node-enabled CEP;
  // fall back to navigator.platform if it is unavailable.
  try {
    if (typeof process !== "undefined" && process.platform) return process.platform === "win32";
  } catch (e) {}
  return (navigator.platform || "").indexOf("Win") !== -1;
}

function getFontsDir() {
  if (isWindows()) {
    // Windows user fonts folder — no admin required
    return nodePath.join(nodeOs.homedir(), "AppData", "Local", "Microsoft", "Windows", "Fonts");
  } else {
    // Mac user fonts folder — no admin required
    return nodePath.join(nodeOs.homedir(), "Library", "Fonts");
  }
}

// On Windows, dropping a font file into the per-user Fonts folder is NOT enough —
// the font must also be registered under HKCU so GDI apps (After Effects) can see
// it. On Mac, writing to ~/Library/Fonts is sufficient, so this is a no-op there.
function registerFontIfNeeded(localPath, filename) {
  if (!isWindows()) return;
  try {
    var childProcess = require("child_process");
    var lower = filename.toLowerCase();
    var typeTag = (lower.indexOf(".otf") !== -1) ? " (OpenType)" : " (TrueType)";
    var baseName = filename.replace(/\.[^.]+$/, "");
    var valueName = baseName + typeTag;
    var regKey = "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
    // Store the full path as the value data so it resolves regardless of the
    // per-user fonts directory being on the font search path.
    childProcess.execFile(
      "reg",
      ["add", regKey, "/v", valueName, "/t", "REG_SZ", "/d", localPath, "/f"],
      function () { /* best-effort; failure just means the user restarts AE / re-runs */ }
    );
  } catch (e) {}
}

function isFontFileInstalled(filename) {
  var fontsDir = getFontsDir();
  return nodeFs.existsSync(nodePath.join(fontsDir, filename));
}

function installFontFamily(familyName, onDone) {
  // familyName = folder name in GitHub fonts/ e.g. "BarlowCondensed"
  var outputEl = document.getElementById("output");
  if (outputEl) outputEl.innerText = "Checking font: " + familyName + "...";

  var apiUrl = GITHUB_FONTS_API + "/" + encodeURIComponent(familyName) + "?ref=" + encodeURIComponent(GITHUB_BRANCH);

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

        // Skip re-downloading if already present, but still ensure it is
        // registered on Windows (older versions wrote the file without
        // registering it, which left the font invisible to After Effects).
        if (nodeFs.existsSync(localPath)) {
          registerFontIfNeeded(localPath, fontFile.name);
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
              registerFontIfNeeded(localPath, fontFile.name);
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

// ---- LEFT RAIL NAVIGATION ----
(function () {
  renderRail();
  var start = "library";
  try {
    var saved = localStorage.getItem("dopetool_tab");
    if (saved && TAB_TITLES[saved]) start = saved;
  } catch (e) {}
  navTo(start);
})();

// ---- TOOLKIT (comp & layer utilities) ----
function tkStatus(msg) {
  var el = document.getElementById("toolkitOutput");
  if (el) el.innerText = msg;
}
function tkEval(script) {
  tkStatus("Working…");
  csInterface.evalScript(script, function (r) { tkStatus(r || "Done."); });
}

(function () {
  var view = document.getElementById("toolkitView");
  if (!view) return;

  var reframeBtns = view.querySelectorAll("[data-w]");
  for (var i = 0; i < reframeBtns.length; i++) {
    reframeBtns[i].addEventListener("click", function () {
      var w = parseInt(this.getAttribute("data-w"), 10);
      var h = parseInt(this.getAttribute("data-h"), 10);
      var mode = document.getElementById("reframeMode").value;
      tkEval('reformatComp(' + w + ',' + h + ',"' + mode + '")');
    });
  }

  var exprBtns = view.querySelectorAll("[data-expr]");
  for (var j = 0; j < exprBtns.length; j++) {
    exprBtns[j].addEventListener("click", function () {
      tkEval('applyExpression("' + this.getAttribute("data-expr") + '")');
    });
  }

  // Align reference: default follows the live selection (1 layer -> comp,
  // 2+ -> selection) until the user manually picks a value.
  var alignRefManual = false;
  var alignRefEl = document.getElementById("alignRef");
  if (alignRefEl) alignRefEl.addEventListener("change", function () { alignRefManual = true; });
  function refreshAlignRef() {
    if (alignRefManual || !alignRefEl) return;
    csInterface.evalScript("dtSelCount()", function (r) {
      if (alignRefManual) return;
      var n = parseInt(r, 10) || 0;
      alignRefEl.value = (n <= 1) ? "composition" : "selection";
    });
  }
  var alignGrid = view.querySelector(".tkAlignGrid");
  if (alignGrid) alignGrid.addEventListener("mouseenter", refreshAlignRef);

  var alignBtns = view.querySelectorAll("[data-align]");
  for (var k = 0; k < alignBtns.length; k++) {
    alignBtns[k].addEventListener("click", function () {
      var ref = alignRefEl ? alignRefEl.value : "selection";
      tkEval('alignLayers("' + this.getAttribute("data-align") + '","' + ref + '")');
    });
  }

  var distBtns = view.querySelectorAll("[data-dist]");
  for (var m = 0; m < distBtns.length; m++) {
    distBtns[m].addEventListener("click", function () {
      tkEval('distributeLayers("' + this.getAttribute("data-dist") + '")');
    });
  }

  var explodeBtn = view.querySelector("#explodeBtn");
  if (explodeBtn) explodeBtn.addEventListener("click", function () {
    var mode = document.getElementById("explodeMode").value;
    tkEval('explodeText("' + mode + '")');
  });

  var counterBtn = view.querySelector("#counterBtn");
  if (counterBtn) counterBtn.addEventListener("click", function () {
    var cfg = {
      prefix: document.getElementById("counterPrefix").value,
      postfix: document.getElementById("counterPostfix").value,
      decimals: parseInt(document.getElementById("counterDecimals").value, 10) || 0,
      commas: document.getElementById("counterCommas").checked
    };
    var escaped = JSON.stringify(cfg).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    tkEval('addSliderCounter("' + escaped + '")');
  });
})();

// ---- TOOLKIT sections: closed by default, expand on hover + search + reorder ----
(function () {
  var body = document.querySelector(".toolkitBody");
  if (!body) return;
  var sections = Array.prototype.slice.call(body.querySelectorAll(".tkSection"));
  if (!sections.length) return;
  var searching = false;
  var tkDragSec = null;

  // Give each section a stable key + wrap its body so it can animate open/closed.
  sections.forEach(function (sec) {
    var t = sec.querySelector(".tkTitle");
    sec.setAttribute("data-tool", (t ? t.textContent : "").toLowerCase());
    var head = sec.querySelector(".tkHeader");
    var wrap = document.createElement("div");
    wrap.className = "tkSectionBody";
    var kids = Array.prototype.slice.call(sec.children);
    kids.forEach(function (k) { if (k !== head) wrap.appendChild(k); });
    sec.appendChild(wrap);
  });

  // Smoothly expand/collapse by animating the wrapper's measured height.
  function setExpanded(sec, on) {
    var b = sec.querySelector(".tkSectionBody");
    if (!b) return;
    if (on) {
      sec.classList.remove("collapsed");
      b.style.maxHeight = (b.scrollHeight + 8) + "px"; // small buffer avoids clipping
      b.style.opacity = "1";
    } else {
      sec.classList.add("collapsed");
      b.style.maxHeight = "0px";
      b.style.opacity = "0";
    }
  }
  function persistToolkitOrder() {
    var keys = Array.prototype.slice.call(body.querySelectorAll(".tkSection"))
      .map(function (s) { return s.getAttribute("data-tool"); });
    try { localStorage.setItem("dopetool_tk_order", JSON.stringify(keys)); } catch (e) {}
  }
  (function applySavedOrder() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem("dopetool_tk_order") || "[]"); } catch (e) {}
    if (!saved.length) return;
    var byKey = {};
    sections.forEach(function (s) { byKey[s.getAttribute("data-tool")] = s; });
    saved.forEach(function (k) { if (byKey[k]) { body.appendChild(byKey[k]); delete byKey[k]; } });
    // any sections not in the saved list keep their place at the end
    sections.forEach(function (s) { if (byKey[s.getAttribute("data-tool")]) body.appendChild(s); });
  })();

  sections.forEach(function (sec) {
    sec.classList.add("collapsed"); // compact by default — just the header row
    // Hover reveals the full tool; leaving collapses it again (unless searching).
    sec.addEventListener("mouseenter", function () { setExpanded(sec, true); });
    sec.addEventListener("mouseleave", function () { if (!searching) setExpanded(sec, false); });

    // Drag the header to reorder tools; drop onto another to insert before it.
    var head = sec.querySelector(".tkHeader");
    if (head) head.setAttribute("draggable", "true");
    if (head) head.addEventListener("dragstart", function (e) {
      tkDragSec = sec; sec.classList.add("tkDragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", sec.getAttribute("data-tool")); } catch (x) {}
    });
    if (head) head.addEventListener("dragend", function () {
      sec.classList.remove("tkDragging"); tkDragSec = null;
      for (var i = 0; i < sections.length; i++) sections[i].classList.remove("tkDropInto");
    });
    sec.addEventListener("dragover", function (e) {
      if (!tkDragSec || tkDragSec === sec) return;
      e.preventDefault();
      sec.classList.add("tkDropInto");
    });
    sec.addEventListener("dragleave", function (e) { if (e.target === sec || !sec.contains(e.relatedTarget)) sec.classList.remove("tkDropInto"); });
    sec.addEventListener("drop", function (e) {
      if (!tkDragSec || tkDragSec === sec) return;
      e.preventDefault();
      sec.classList.remove("tkDropInto");
      body.insertBefore(tkDragSec, sec); // drop before the target section
      persistToolkitOrder();
    });
  });

  var search = document.getElementById("tkSearch");
  if (search) search.addEventListener("input", function () {
    var q = (this.value || "").toLowerCase().replace(/^\s+|\s+$/g, "");
    searching = !!q;
    if (!q) {
      // back to hover mode: hide nothing, collapse everything
      sections.forEach(function (s) { s.classList.remove("tkHiddenSearch"); setExpanded(s, false); });
      return;
    }
    sections.forEach(function (s) {
      var hit = s.getAttribute("data-tool").indexOf(q) !== -1;
      s.classList.toggle("tkHiddenSearch", !hit);
      setExpanded(s, hit); // matches open smoothly, rest collapse/hide
    });
  });
})();

// ---- TOOLKIT quick animation presets (fade/slide/scale + settings) ----
(function () {
  var bar = document.querySelector(".tkQuickBar");
  if (!bar) return;
  var DEF = { durationFrames: 15, slideDist: 200, easeOut: 30, easeIn: 70, fadeMode: "keyframes" };

  function getAnimSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem("dopetool_anim_settings") || "{}"); } catch (e) {}
    return {
      durationFrames: Number(s.durationFrames) || DEF.durationFrames,
      slideDist: (s.slideDist != null) ? Number(s.slideDist) : DEF.slideDist,
      easeOut: (s.easeOut != null) ? Number(s.easeOut) : DEF.easeOut,
      easeIn: (s.easeIn != null) ? Number(s.easeIn) : DEF.easeIn,
      fadeMode: (s.fadeMode === "linked") ? "linked" : DEF.fadeMode
    };
  }
  // Populate the settings inputs and persist on change
  var fD = document.getElementById("animDuration"),
      fS = document.getElementById("animSlideDist"),
      fEo = document.getElementById("animEaseOut"),
      fEi = document.getElementById("animEaseIn"),
      fFm = document.getElementById("animFadeMode");
  var cur = getAnimSettings();
  if (fD) fD.value = cur.durationFrames;
  if (fS) fS.value = cur.slideDist;
  if (fEo) fEo.value = cur.easeOut;
  if (fEi) fEi.value = cur.easeIn;
  if (fFm) fFm.value = cur.fadeMode;
  function saveAnimSettings() {
    var s = {
      durationFrames: parseFloat(fD && fD.value) || DEF.durationFrames,
      slideDist: parseFloat(fS && fS.value),
      easeOut: parseFloat(fEo && fEo.value),
      easeIn: parseFloat(fEi && fEi.value),
      fadeMode: (fFm && fFm.value === "linked") ? "linked" : "keyframes"
    };
    if (isNaN(s.slideDist)) s.slideDist = DEF.slideDist;
    if (isNaN(s.easeOut)) s.easeOut = DEF.easeOut;
    if (isNaN(s.easeIn)) s.easeIn = DEF.easeIn;
    try { localStorage.setItem("dopetool_anim_settings", JSON.stringify(s)); } catch (e) {}
  }
  [fD, fS, fEo, fEi, fFm].forEach(function (el) { if (el) el.addEventListener("change", saveAnimSettings); });

  // Settings toggle
  var gear = document.getElementById("tkAnimSettingsBtn");
  var panel = document.getElementById("tkAnimSettings");
  if (gear && panel) gear.addEventListener("click", function () {
    var open = panel.classList.toggle("hidden");
    gear.classList.toggle("on", !panel.classList.contains("hidden"));
  });

  // Preset buttons (quick-anim bar + Trim Paths section share the same engine)
  function applyPreset(preset) {
    var cfg = getAnimSettings();
    cfg.preset = preset;
    var esc = JSON.stringify(cfg).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    if (typeof tkStatus === "function") tkStatus("Applying " + preset + "…");
    csInterface.evalScript('applyAnimPreset("' + esc + '")', function (r) {
      if (r && r.indexOf("ok:") === 0) { if (typeof tkStatus === "function") tkStatus("✓ " + preset + " → " + r.split(":")[1] + " layer(s)"); }
      else if (typeof tkStatus === "function") tkStatus(r || "Failed.");
    });
  }
  var tkView = document.getElementById("toolkitView");
  // Preset buttons now live in the persistent quick dock (outside toolkitView).
  var btns = document.querySelectorAll("[data-preset]");
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () { applyPreset(this.getAttribute("data-preset")); });
  }

  // Quick-bar Align buttons (scoped to the bar so they don't double-bind the
  // Toolkit's Align section). Reference auto-follows selection: 1 layer ->
  // composition, 2+ -> selection.
  var qAlign = bar.querySelectorAll("[data-align]");
  for (var qa = 0; qa < qAlign.length; qa++) {
    qAlign[qa].addEventListener("click", function () {
      var mode = this.getAttribute("data-align");
      if (typeof tkStatus === "function") tkStatus("Aligning…");
      // "auto" — the host decides composition (1 layer) vs selection (2+) from
      // the live selection in a single call, so it can't mismatch.
      csInterface.evalScript('alignLayers("' + mode + '","auto")', function (res) {
        if (typeof tkStatus === "function") tkStatus(res || "Aligned.");
      });
    });
  }

  // Quick-bar Distribute buttons (scoped to the bar).
  var qDist = bar.querySelectorAll("[data-dist]");
  for (var qd = 0; qd < qDist.length; qd++) {
    qDist[qd].addEventListener("click", function () {
      var axis = this.getAttribute("data-dist");
      if (typeof tkStatus === "function") tkStatus("Distributing…");
      csInterface.evalScript('distributeLayers("' + axis + '")', function (res) {
        if (typeof tkStatus === "function") tkStatus(res || "Distributed.");
      });
    });
  }

  // Anchor point 3x3 setter (still inside the Toolkit view)
  var anchorBtns = (tkView || bar).querySelectorAll("[data-anchor]");
  for (var ai = 0; ai < anchorBtns.length; ai++) {
    anchorBtns[ai].addEventListener("click", function () {
      var name = this.getAttribute("data-anchor"); // "h-v"
      var parts = name.split("-");
      if (typeof tkStatus === "function") tkStatus("Anchor: clicked " + name + "…");
      csInterface.evalScript('setAnchor("' + parts[0] + '","' + parts[1] + '")', function (r) {
        if (typeof tkStatus !== "function") return;
        if (r && r.indexOf("ok:") === 0) {
          // r = "ok:<count>:<h-v received>:<ax,ay>"
          var seg = r.split(":");
          tkStatus("✓ clicked " + name + " → host got " + (seg[2] || "?") + " @ " + (seg[3] || "?"));
        } else { tkStatus(r || "Failed."); }
      });
    });
  }

  // Add Null (centre + parent selected layers)
  var nullBtn = bar.querySelector('.tkQuickBtn[data-action="addNull"]');
  if (nullBtn) nullBtn.addEventListener("click", function () {
    if (typeof tkStatus === "function") tkStatus("Adding null…");
    csInterface.evalScript("addNullCenter()", function (r) {
      if (r && r.indexOf("ok:") === 0) { var n = r.split(":")[1]; if (typeof tkStatus === "function") tkStatus(n > 0 ? "✓ Null added — parented " + n + " layer(s)" : "✓ Null added at centre"); }
      else if (typeof tkStatus === "function") tkStatus(r || "Failed.");
    });
  });
})();

// ═══════════════════════════════════════════════════════════
// SMOOOTH — cubic-bezier keyframe easing editor
// ═══════════════════════════════════════════════════════════
var smoothCP = [0.42, 0, 0.58, 1]; // x1, y1, x2, y2
var smoothDragIdx = -1;
var smoothGraphMode = "value"; // "value" | "speed"
var SMOOTH_SPEED_MAX = 4;      // fixed vertical scale for the speed graph (units/sec, normalized)

// Speed-graph handle knobs, derived from the bezier control points.
// Returns [ [graphX, graphY(0..1), rawSpeed], ...] for the start and end keyframe.
function smoothSpeedKnobs(cp) {
  var s0 = cp[0] > 1e-4 ? cp[1] / cp[0] : 0;              // outgoing velocity of kf 1
  var s1 = (1 - cp[2]) > 1e-4 ? (1 - cp[3]) / (1 - cp[2]) : 0; // incoming velocity of kf 2
  return [
    [cp[0], Math.min(1, s0 / SMOOTH_SPEED_MAX), s0],
    [cp[2], Math.min(1, s1 / SMOOTH_SPEED_MAX), s1]
  ];
}
var SMOOTH_PRESETS = [
  { name: "Gentle",   cp: [0.25, 0.10, 0.25, 1.0] },
  { name: "Smooth",   cp: [0.42, 0.00, 0.58, 1.0] },
  { name: "Ease",     cp: [0.50, 0.00, 0.50, 1.0] },
  { name: "Ease +",   cp: [0.65, 0.00, 0.35, 1.0] },
  { name: "Ease ++",  cp: [0.80, 0.00, 0.20, 1.0] },
  { name: "Snappy",   cp: [0.90, 0.00, 0.10, 1.0] },
  { name: "Ease Out", cp: [0.00, 0.00, 0.58, 1.0] },
  { name: "Out Fast", cp: [0.16, 1.00, 0.30, 1.0] },
  { name: "Ease In",  cp: [0.42, 0.00, 1.00, 1.0] },
  { name: "In Hard",  cp: [0.70, 0.00, 1.00, 1.0] },
  { name: "Soft",     cp: [0.33, 0.00, 0.67, 1.0] },
  { name: "Linear",   cp: [0.00, 0.00, 1.00, 1.0] }
];

function smoothMap(canvas) {
  var pad = 16;
  return { pad: pad, gw: canvas.width - 2 * pad, gh: canvas.height - 2 * pad };
}
function smoothPx(canvas, x, y) {
  var m = smoothMap(canvas);
  return [m.pad + x * m.gw, m.pad + (1 - y) * m.gh];
}
function smoothDrawInto(canvas, cp, opts) {
  opts = opts || {};
  var ctx = canvas.getContext("2d");
  var W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  var m = smoothMap(canvas);

  if (opts.grid) {
    ctx.strokeStyle = "#20202e";
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var gx = m.pad + (i / 4) * m.gw;
      ctx.beginPath(); ctx.moveTo(gx, m.pad); ctx.lineTo(gx, m.pad + m.gh); ctx.stroke();
      var gy = m.pad + (i / 4) * m.gh;
      ctx.beginPath(); ctx.moveTo(m.pad, gy); ctx.lineTo(m.pad + m.gw, gy); ctx.stroke();
    }
  }

  // Speed graph: plot dy/dx (velocity) vs time instead of value vs time.
  if (opts.mode === "speed") {
    var N = 64, pts = [];
    for (var s = 0; s <= N; s++) {
      var u = s / N, mt = 1 - u;
      var dxu = 3 * mt * mt * cp[0] + 6 * mt * u * (cp[2] - cp[0]) + 3 * u * u * (1 - cp[2]);
      var dyu = 3 * mt * mt * cp[1] + 6 * mt * u * (cp[3] - cp[1]) + 3 * u * u * (1 - cp[3]);
      var xu = 3 * mt * mt * u * cp[0] + 3 * mt * u * u * cp[2] + u * u * u;
      var spd = (dxu > 1e-6) ? dyu / dxu : 0;
      if (spd < 0) spd = 0;
      pts.push([xu, Math.min(1, spd / SMOOTH_SPEED_MAX)]);
    }
    ctx.strokeStyle = opts.curveColor || "#ffffff";
    ctx.lineWidth = opts.lineWidth || 2;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    for (var k = 0; k < pts.length; k++) {
      var pv = smoothPx(canvas, pts[k][0], pts[k][1]);
      if (k === 0) ctx.moveTo(pv[0], pv[1]); else ctx.lineTo(pv[0], pv[1]);
    }
    ctx.stroke();

    // Draggable ease handles (start & end keyframe velocities)
    if (opts.handles) {
      var kn = smoothSpeedKnobs(cp);
      var kf0 = smoothPx(canvas, 0, kn[0][1]);   // start keyframe (time 0, at its speed level)
      var kb0 = smoothPx(canvas, kn[0][0], kn[0][1]);
      var kf1 = smoothPx(canvas, 1, kn[1][1]);   // end keyframe (time 1, at its speed level)
      var kb1 = smoothPx(canvas, kn[1][0], kn[1][1]);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = "#3a5cff"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(kf0[0], kf0[1]); ctx.lineTo(kb0[0], kb0[1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(kf1[0], kf1[1]); ctx.lineTo(kb1[0], kb1[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#555a80";
      [kf0, kf1].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = "#4c72ff";
      [kb0, kb1].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 5.5, 0, Math.PI * 2); ctx.fill(); });
    }
    return;
  }

  var p0 = smoothPx(canvas, 0, 0);
  var p1 = smoothPx(canvas, cp[0], cp[1]);
  var p2 = smoothPx(canvas, cp[2], cp[3]);
  var p3 = smoothPx(canvas, 1, 1);

  if (opts.handles) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#3a5cff";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = opts.curveColor || "#ffffff";
  ctx.lineWidth = opts.lineWidth || 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  ctx.stroke();

  if (opts.handles) {
    ctx.fillStyle = "#555a80";
    [p0, p3].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = "#4c72ff";
    [p1, p2].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 5.5, 0, Math.PI * 2); ctx.fill(); });
  }
}
function smoothDraw() {
  var canvas = document.getElementById("smoothCanvas");
  if (!canvas) return;
  // Keep the on-screen aspect ratio correct once the canvas is actually visible
  if (canvas.clientWidth > 0) canvas.style.height = (canvas.clientWidth * (canvas.height / canvas.width)) + "px";
  smoothDrawInto(canvas, smoothCP, { handles: true, grid: true, curveColor: "#ffffff", lineWidth: 2, mode: smoothGraphMode });
  canvas.style.cursor = "crosshair";
  var b = document.getElementById("smoothBezier");
  if (b) {
    var r = smoothCP.map(function (n) { return Math.round(n * 100) / 100; });
    b.innerText = "cubic-bezier(" + r.join(", ") + ")";
  }
  updateSmoothInputs();
}

// Start box = outgoing influence (x1*100); End box = incoming influence ((1-x2)*100).
// Skip the box currently being typed in so the cursor doesn't jump.
function updateSmoothInputs() {
  var si = document.getElementById("smoothStart");
  var ei = document.getElementById("smoothEnd");
  if (si && si !== document.activeElement) si.value = Math.round(smoothCP[0] * 100);
  if (ei && ei !== document.activeElement) ei.value = Math.round((1 - smoothCP[2]) * 100);
}
function smoothClientToXY(canvas, clientX, clientY) {
  var rect = canvas.getBoundingClientRect();
  var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
  var px = (clientX - rect.left) * sx, py = (clientY - rect.top) * sy;
  var m = smoothMap(canvas);
  return [(px - m.pad) / m.gw, 1 - (py - m.pad) / m.gh];
}
function smoothOnDrag(e) {
  var canvas = document.getElementById("smoothCanvas");
  var xy = smoothClientToXY(canvas, e.clientX, e.clientY);
  var x = Math.max(0, Math.min(1, xy[0]));
  var y = Math.max(0, Math.min(1, xy[1]));
  if (smoothGraphMode === "speed") {
    // horizontal = influence (x1 / x2), vertical = velocity → back-solve y1 / y2
    var xk = Math.max(0.02, Math.min(0.98, x));
    var spd = y * SMOOTH_SPEED_MAX;
    if (smoothDragIdx === 0) { smoothCP[0] = xk; smoothCP[1] = Math.max(0, Math.min(1, spd * xk)); }
    else if (smoothDragIdx === 1) { smoothCP[2] = xk; smoothCP[3] = Math.max(0, Math.min(1, 1 - spd * (1 - xk))); }
  } else {
    if (smoothDragIdx === 0) { smoothCP[0] = x; smoothCP[1] = y; }
    else if (smoothDragIdx === 1) { smoothCP[2] = x; smoothCP[3] = y; }
  }
  smoothDraw();
}
function smoothApply() {
  var out = document.getElementById("smoothOutput");
  if (out) out.innerText = "Applying…";
  var cp = smoothCP;
  csInterface.evalScript("applyEase(" + cp[0] + "," + cp[1] + "," + cp[2] + "," + cp[3] + ")", function (r) {
    if (out) out.innerText = r || "Done.";
  });
}

// ---- Saved (shared) easing presets — Firestore collection "smoothpresets" ----
function loadSmoothPresets() {
  var host = document.getElementById("smoothSaved");
  if (!host) return;
  host.innerHTML = '<div class="tkHint" style="padding:4px;">Loading…</div>';
  db.collection("smoothpresets").get()
    .then(function (snap) {
      var arr = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        if (d.cp && d.cp.length === 4) arr.push({ id: doc.id, name: d.name || "Preset", cp: d.cp });
      });
      host.innerHTML = "";
      if (!arr.length) { host.innerHTML = '<div class="tkHint" style="padding:4px;">No saved presets yet — shape a curve and hit Save.</div>'; return; }
      arr.sort(function (a, b) { return (a.name || "").toLowerCase() < (b.name || "").toLowerCase() ? -1 : 1; });
      arr.forEach(function (item) {
        var d = document.createElement("div");
        d.className = "smoothPreset smoothSavedItem";
        d.title = item.name;
        var c = document.createElement("canvas");
        c.width = 64; c.height = 42;
        d.appendChild(c);
        smoothDrawInto(c, item.cp, { handles: false, grid: false, curveColor: "#8fe0c0", lineWidth: 1.6 });
        var nm = document.createElement("div");
        nm.className = "smoothPresetName";
        nm.innerText = item.name;
        d.appendChild(nm);
        var del = document.createElement("div");
        del.className = "smoothDel";
        del.innerHTML = "&times;";
        d.appendChild(del);
        d.addEventListener("click", function (e) {
          if (e.target === del) return;
          smoothCP = item.cp.slice();
          smoothDraw();
          smoothApply();
        });
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!confirm('Delete preset "' + item.name + '"?')) return;
          db.collection("smoothpresets").doc(item.id).delete().then(loadSmoothPresets);
        });
        host.appendChild(d);
      });
    })
    .catch(function (err) { host.innerHTML = '<div class="tkHint" style="padding:4px;color:#ff5566;">Error: ' + err.message + '</div>'; });
}

(function () {
  var canvas = document.getElementById("smoothCanvas");
  if (!canvas) return;

  var host = document.getElementById("smoothPresets");
  SMOOTH_PRESETS.forEach(function (preset) {
    var d = document.createElement("div");
    d.className = "smoothPreset";
    d.title = preset.name;
    var c = document.createElement("canvas");
    c.width = 64; c.height = 42;
    d.appendChild(c);
    smoothDrawInto(c, preset.cp, { handles: false, grid: false, curveColor: "#c8ccff", lineWidth: 1.6 });
    var nm = document.createElement("div");
    nm.className = "smoothPresetName";
    nm.innerText = preset.name;
    d.appendChild(nm);
    d.addEventListener("click", function () { smoothCP = preset.cp.slice(); smoothDraw(); smoothApply(); });
    host.appendChild(d);
  });

  // Value/Speed graph toggle
  var modeBtns = document.querySelectorAll(".smoothModeBtn");
  for (var mi = 0; mi < modeBtns.length; mi++) {
    modeBtns[mi].addEventListener("click", function () {
      smoothGraphMode = this.getAttribute("data-mode");
      for (var j = 0; j < modeBtns.length; j++) modeBtns[j].classList.toggle("active", modeBtns[j] === this);
      smoothDraw();
    });
  }

  // Mouse events (more reliable than pointer events in CEP); move/up on window
  // so a drag continues even when the cursor leaves the canvas. Handles are only
  // editable on the Value graph.
  canvas.addEventListener("mousedown", function (e) {
    e.preventDefault();
    var xy = smoothClientToXY(canvas, e.clientX, e.clientY);
    var d1, d2;
    if (smoothGraphMode === "speed") {
      var kn = smoothSpeedKnobs(smoothCP);
      d1 = Math.abs(xy[0] - kn[0][0]) + Math.abs(xy[1] - kn[0][1]);
      d2 = Math.abs(xy[0] - kn[1][0]) + Math.abs(xy[1] - kn[1][1]);
    } else {
      d1 = Math.abs(xy[0] - smoothCP[0]) + Math.abs(xy[1] - smoothCP[1]);
      d2 = Math.abs(xy[0] - smoothCP[2]) + Math.abs(xy[1] - smoothCP[3]);
    }
    smoothDragIdx = (d1 <= d2) ? 0 : 1;
    smoothOnDrag(e);
  });
  window.addEventListener("mousemove", function (e) { if (smoothDragIdx >= 0) smoothOnDrag(e); });
  window.addEventListener("mouseup", function () { smoothDragIdx = -1; });

  var applyBtn = document.getElementById("smoothApplyBtn");
  if (applyBtn) applyBtn.addEventListener("click", smoothApply);

  // Start / End value boxes (influence %)
  var startInput = document.getElementById("smoothStart");
  var endInput = document.getElementById("smoothEnd");
  if (startInput) startInput.addEventListener("input", function () {
    var v = Math.max(0, Math.min(100, parseFloat(this.value) || 0));
    smoothCP[0] = v / 100;
    smoothDraw();
  });
  if (endInput) endInput.addEventListener("input", function () {
    var v = Math.max(0, Math.min(100, parseFloat(this.value) || 0));
    smoothCP[2] = 1 - v / 100;
    smoothDraw();
  });

  // Save current curve as a shared preset
  var saveToggle = document.getElementById("smoothSaveToggle");
  var saveForm = document.getElementById("smoothSaveForm");
  if (saveToggle) saveToggle.addEventListener("click", function () {
    saveForm.classList.toggle("hidden");
    if (!saveForm.classList.contains("hidden")) document.getElementById("smoothSaveName").focus();
  });
  var saveCancel = document.getElementById("smoothSaveCancelBtn");
  if (saveCancel) saveCancel.addEventListener("click", function () {
    saveForm.classList.add("hidden");
    document.getElementById("smoothSaveName").value = "";
  });
  var saveBtn = document.getElementById("smoothSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", function () {
    var name = document.getElementById("smoothSaveName").value.trim();
    var out = document.getElementById("smoothOutput");
    if (!name) { if (out) out.innerText = "Enter a preset name."; return; }
    if (out) out.innerText = "Saving…";
    db.collection("smoothpresets").add({ name: name, cp: smoothCP.slice(), createdAt: Date.now() })
      .then(function () {
        if (out) out.innerText = "Preset saved.";
        saveForm.classList.add("hidden");
        document.getElementById("smoothSaveName").value = "";
        loadSmoothPresets();
      })
      .catch(function (err) { if (out) out.innerText = "Save failed: " + err.message; });
  });

  smoothDraw();
  loadSmoothPresets();
})();

// ═══════════════════════════════════════════════════════════
// TEXT ANIMATIONS — global .ffx preset library with hover preview
// ═══════════════════════════════════════════════════════════
var textAnimData = [];

function taStatus(msg) { var el = document.getElementById("textAnimStatus"); if (el) el.innerText = msg; }

function taPreviewUrl(d) {
  var p = d && d.preview;
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return (typeof assetUrl === "function") ? assetUrl(p) : null;
}
function taMotionClass(name) {
  var n = (name || "").toLowerCase();
  if (n.indexOf("up") >= 0) return "taMockUp";
  if (n.indexOf("down") >= 0) return "taMockDown";
  if (n.indexOf("left") >= 0) return "taMockLeft";
  if (n.indexOf("right") >= 0) return "taMockRight";
  if (n.indexOf("scale") >= 0 || n.indexOf("zoom") >= 0 || n.indexOf("pop") >= 0) return "taMockScale";
  if (n.indexOf("fade") >= 0) return "taMockFade";
  return "taMockPulse";
}

function loadTextAnims() {
  var grid = document.getElementById("textAnimGrid");
  if (!grid) return;
  grid.innerHTML = '<div class="emptyState">Loading…</div>';
  db.collection("animations").get().then(function (snap) {
    textAnimData = [];
    snap.forEach(function (doc) { var d = doc.data(); if (d.placeholder) return; textAnimData.push({ id: doc.id, data: d }); });
    textAnimData.sort(function (a, b) { return (a.data.name || "").toLowerCase() < (b.data.name || "").toLowerCase() ? -1 : 1; });
    renderTextAnims("");
  }).catch(function (err) { grid.innerHTML = '<div class="emptyState" style="color:var(--danger)">Error: ' + err.message + '</div>'; });
}

function renderTextAnims(q) {
  var grid = document.getElementById("textAnimGrid");
  if (!grid) return;
  grid.innerHTML = "";
  var list = textAnimData;
  if (q) list = list.filter(function (e) { return (e.data.name || "").toLowerCase().indexOf(q) !== -1; });
  if (!list.length) { grid.innerHTML = '<div class="emptyState">No animations' + (q ? ' match “' + q + '”' : ' yet — click + Add') + '.</div>'; return; }
  list.forEach(function (entry) {
    var d = entry.data;
    var card = document.createElement("div");
    card.className = "taCard";
    card.innerHTML =
      '<div class="taCardName"></div>' +
      '<div class="taCardMeta">' + (taPreviewUrl(d) ? "▶ preview" : "hover to preview") + '</div>' +
      '<div class="taDel" title="Delete">&times;</div>';
    card.querySelector(".taCardName").textContent = d.name || "Preset";
    card.addEventListener("click", function (e) { if (e.target.classList.contains("taDel")) return; taApply(d); });
    card.querySelector(".taDel").addEventListener("click", function (e) { e.stopPropagation(); taDelete(entry); });
    card.addEventListener("mouseenter", function () { taShowPreview(card, d); });
    card.addEventListener("mouseleave", taHidePreview);
    grid.appendChild(card);
  });
}

function taApply(d) {
  var out = document.getElementById("textAnimStatus");
  if (!d.filename) { if (out) out.innerText = "This preset has no .ffx filename."; return; }
  var presetsDir = getPresetsDir();
  var localPath = nodePath.join(presetsDir, d.filename);
  var jsxPath = toJsxPath(localPath);
  if (nodeFs.existsSync(localPath)) {
    if (out) out.innerText = "Applying " + d.name + "…";
    csInterface.evalScript('applyFfxPreset("' + jsxPath + '")', function (r) { if (out) out.innerText = r; });
    return;
  }
  if (out) out.innerText = "Downloading " + d.name + "…";
  fetch((d.url || "") + "?t=" + Date.now())
    .then(function (res) { if (!res.ok) throw new Error("Not on GitHub yet (HTTP " + res.status + "). Push " + d.filename + " to presets/."); return res.arrayBuffer(); })
    .then(function (buf) {
      try { if (!nodeFs.existsSync(presetsDir)) nodeFs.mkdirSync(presetsDir, { recursive: true }); } catch (e) { if (out) out.innerText = "Folder error: " + e.message; return; }
      try { nodeFs.writeFileSync(localPath, Buffer.from(new Uint8Array(buf))); } catch (e) { if (out) out.innerText = "Write failed: " + e.message; return; }
      if (out) out.innerText = "Applying " + d.name + "…";
      csInterface.evalScript('applyFfxPreset("' + jsxPath + '")', function (r) { if (out) out.innerText = r; });
    })
    .catch(function (err) { if (out) out.innerText = "Download failed: " + err.message; });
}

function taDelete(entry) {
  if (!confirm('Delete animation "' + (entry.data.name || "") + '"?')) return;
  db.collection("animations").doc(entry.id).delete().then(loadTextAnims).catch(function (e) { taStatus("Delete failed: " + e.message); });
}

function taEnsurePop() {
  var pop = document.getElementById("taPop");
  if (!pop) { pop = document.createElement("div"); pop.id = "taPop"; pop.className = "taPop hidden"; document.body.appendChild(pop); }
  return pop;
}
function taShowPreview(card, d) {
  var pop = taEnsurePop();
  var url = taPreviewUrl(d);
  if (url) {
    var isVid = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    pop.innerHTML = isVid ? '<video src="' + url + '" autoplay muted loop playsinline></video>' : '<img src="' + url + '" alt="">';
  } else {
    pop.innerHTML = '<div class="taMock ' + taMotionClass(d.name) + '"><span>Aa</span></div>';
  }
  pop.classList.remove("hidden");
  var r = card.getBoundingClientRect();
  var pw = 140, ph = 110;
  var left = Math.max(6, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 6));
  var top = r.top - ph - 8;
  if (top < 6) top = r.bottom + 8;
  pop.style.left = left + "px"; pop.style.top = top + "px";
}
function taHidePreview() { var pop = document.getElementById("taPop"); if (pop) { pop.classList.add("hidden"); pop.innerHTML = ""; } }

(function () {
  var addBtn = document.getElementById("taAddBtn");
  var form = document.getElementById("taAddForm");
  if (addBtn) addBtn.addEventListener("click", function () { form.classList.toggle("hidden"); if (!form.classList.contains("hidden")) document.getElementById("taName").focus(); });
  var cancel = document.getElementById("taCancelBtn");
  if (cancel) cancel.addEventListener("click", function () { form.classList.add("hidden"); });
  var save = document.getElementById("taSaveBtn");
  if (save) save.addEventListener("click", function () {
    var name = document.getElementById("taName").value.replace(/^\s+|\s+$/g, "");
    var file = document.getElementById("taFilename").value.replace(/^\s+|\s+$/g, "");
    var prev = document.getElementById("taPreview").value.replace(/^\s+|\s+$/g, "");
    if (!name) { taStatus("Enter a name."); return; }
    if (!file) { taStatus("Enter the .ffx filename."); return; }
    if (file.indexOf(".ffx") === -1) file += ".ffx";
    taStatus("Saving…");
    db.collection("animations").add({
      name: name, filename: file, type: "ffx", global: true,
      url: GITHUB_RAW_BASE + "/presets/" + encodeURIComponent(file),
      preview: prev || null, createdAt: Date.now()
    }).then(function () {
      document.getElementById("taName").value = ""; document.getElementById("taFilename").value = ""; document.getElementById("taPreview").value = "";
      form.classList.add("hidden");
      taStatus("Saved! Push " + file + " to presets/ (preview to the assets release).");
      loadTextAnims();
    }).catch(function (e) { taStatus("Save failed: " + e.message); });
  });
  var search = document.getElementById("taSearch");
  if (search) search.addEventListener("input", function () { renderTextAnims(this.value.toLowerCase().replace(/^\s+|\s+$/g, "")); });
})();
