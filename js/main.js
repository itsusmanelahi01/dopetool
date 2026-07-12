window.onerror = function(msg, url, line, col, error) {
  var out = document.getElementById("output") || document.getElementById("hubVersion");
  if (out) {
    out.style.color = "#ff5566";
    out.innerText = "JS ERROR line " + line + ": " + msg;
  }
  console.log("JS ERROR line " + line + ": " + msg);
  return false;
};

// DopeTool main.js — v2.15.1

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
try {
  if (typeof db !== "undefined" && db && db.settings) {
    db.settings({ experimentalForceLongPolling: true });
  }
} catch (e) {}

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

// ---- VIEW NAVIGATION ----
// Host-aware: shows viewId and hides only the OTHER views living in the same
// pane body, so each split pane navigates independently.
function showView(viewId) {
  var el = document.getElementById(viewId);
  if (!el) return;
  var host = el.parentNode;
  var views = ["hubView","homeView","clientView","captionView","toolkitView","smoothView","autoCapView"];
  views.forEach(function (v) {
    var e = document.getElementById(v);
    if (e && e.parentNode === host) e.classList.toggle("hidden", v !== viewId);
  });
}

// ═══════════════════════════════════════════════════════════
// DOCK — two stacked panes: top (main) and bottom (split).
// Each pane holds one OR MORE tabs in its own strip; a tab lives
// in exactly one pane. The top pane's strip IS the top tab bar.
// ═══════════════════════════════════════════════════════════
var TAB_TITLES = { library: "Library", captions: "Captions", autocap: "Auto Captions", toolkit: "Toolkit", smooth: "Smoooth" };
var TAB_VIEWS = { library: ["homeView", "clientView"], captions: ["captionView"], autocap: ["autoCapView"], toolkit: ["toolkitView"], smooth: ["smoothView"] };
var ALL_VIEWS = ["hubView", "homeView", "clientView", "captionView", "autoCapView", "toolkitView", "smoothView"];
var ALL_TABS = ["library", "captions", "autocap", "toolkit", "smooth"];

var panes = {
  top:    { tabs: ["library", "captions", "autocap", "toolkit", "smooth"], active: "library" },
  bottom: { tabs: [], active: null }
};
var splitOpen = false;
var splitRatio = 0.55;      // top pane's share of the height
var focusedPane = "top";
var dockDragTab = null;     // tab key currently being dragged

function viewsFor(tab) { return TAB_VIEWS[tab] || []; }
function activeViewId(tab) {
  if (tab === "library") return currentClient ? "clientView" : "homeView";
  if (tab === "captions") return "captionView";
  if (tab === "autocap") return "autoCapView";
  if (tab === "toolkit") return "toolkitView";
  if (tab === "smooth") return "smoothView";
  return "homeView";
}
// Each tab's data is fetched ONCE (the first time it becomes visible) and then
// left alone — switching tabs or re-docking never re-fetches or re-renders it.
var loadedTabs = {};
function loadForTab(tab) {
  // Smoooth's canvas must be re-drawn whenever it's shown (its size depends on
  // the current layout) — but that's a cheap local redraw, not a data reload.
  if (tab === "smooth" && typeof smoothDraw === "function") smoothDraw();
  if (loadedTabs[tab]) return;
  loadedTabs[tab] = true;
  if (tab === "library") { if (!currentClient) loadAllClients(); }
  else if (tab === "captions") loadCaptionStyles();
  else if (tab === "autocap") { if (typeof loadAutoCapStyles === "function") loadAutoCapStyles(); }
  else if (tab === "smooth") { if (typeof loadSmoothPresets === "function") loadSmoothPresets(); }
}
function paneOf(tab) {
  if (panes.top.tabs.indexOf(tab) !== -1) return "top";
  if (panes.bottom.tabs.indexOf(tab) !== -1) return "bottom";
  return null;
}
function ensureActive(pane) {
  var p = panes[pane];
  if (p.tabs.indexOf(p.active) === -1) p.active = p.tabs[0] || null;
}
function currentActiveTab() {
  return (panes[focusedPane] && panes[focusedPane].active) || panes.top.active || "library";
}

// Activate a tab within its pane and focus that pane. This is a LIGHT update:
// it just flips the active tab-button and shows/hides views — no DOM rebuild and
// no data reload — so switching tabs never re-fetches or re-renders a panel.
function activateTab(tab) {
  var pane = paneOf(tab);
  if (!pane) return;
  panes[pane].active = tab;
  focusedPane = pane;
  refreshPaneActive(pane);
  persistDock();
}

function refreshPaneActive(pane) {
  var p = panes[pane];
  // active tab-button in this pane's strip
  var strip = document.querySelector(pane === "top" ? "#topTabScroll" : '[data-strip="bottom"]');
  if (strip) {
    var btns = strip.querySelectorAll(".paneTabBtn");
    for (var i = 0; i < btns.length; i++) {
      var t = btns[i].getAttribute("data-tab");
      btns[i].classList.toggle("active", t === p.active);
      if (t === p.active && pane === "top") { try { btns[i].scrollIntoView({ inline: "center", block: "nearest" }); } catch (e) {} }
    }
  }
  // show only the active tab's view in this pane's body
  var body = document.querySelector('[data-pane-body="' + pane + '"]');
  if (body) {
    p.tabs.forEach(function (tab) {
      var showId = (tab === p.active) ? activeViewId(tab) : null;
      viewsFor(tab).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.toggle("hidden", id !== showId);
      });
    });
  }
  // move the focus ring to this pane
  var all = document.querySelectorAll(".dockPane");
  for (var k = 0; k < all.length; k++) all[k].classList.toggle("focused", all[k].contains(body));
  loadForTab(p.active);
  if (typeof updateTopTabFades === "function") updateTopTabFades();
}

// Move a tab into a pane (single-instance). `index` is optional insert position.
// The top pane must always keep at least one tab; emptying the bottom closes the split.
function moveTab(tab, dest, index) {
  var from = paneOf(tab);
  if (!from) return;
  if (from === "top" && dest === "bottom" && panes.top.tabs.length <= 1) return; // top must keep a tab
  var wasIndex = panes[from].tabs.indexOf(tab);
  panes[from].tabs = panes[from].tabs.filter(function (t) { return t !== tab; });
  if (typeof index !== "number") index = panes[dest].tabs.length;
  // same-pane reorder: account for the removed slot
  if (from === dest && wasIndex < index) index--;
  index = Math.max(0, Math.min(index, panes[dest].tabs.length));
  panes[dest].tabs.splice(index, 0, tab);
  panes[dest].active = tab;
  ensureActive(from);
  focusedPane = dest;
  if (dest === "bottom") splitOpen = true;
  if (panes.bottom.tabs.length === 0) splitOpen = false;
  buildDock();
}

// Split button: send the CURRENT (active) tab down into a new bottom pane,
// leaving the remaining tabs up top. Or close the split if already open.
function openSplit() {
  if (splitOpen && panes.bottom.tabs.length) return;
  if (panes.top.tabs.length <= 1) return; // only one tab total — nothing to split
  splitOpen = true;
  moveTab(panes.top.active, "bottom");
}
function closeSplit() {
  panes.bottom.tabs.slice().forEach(function (t) {
    panes.bottom.tabs = panes.bottom.tabs.filter(function (x) { return x !== t; });
    panes.top.tabs.push(t);
  });
  panes.bottom.active = null;
  splitOpen = false;
  focusedPane = "top";
  ensureActive("top");
  buildDock();
}

// ---- Render ----
function buildDock() {
  var root = document.getElementById("dockRoot");
  var limbo = document.getElementById("dockLimbo");
  if (!root || !limbo) return;
  ensureActive("top"); ensureActive("bottom");
  if (panes.bottom.tabs.length === 0) splitOpen = false;
  // Park all views in limbo so clearing dockRoot doesn't destroy them
  for (var i = 0; i < ALL_VIEWS.length; i++) { var el = document.getElementById(ALL_VIEWS[i]); if (el) limbo.appendChild(el); }
  root.innerHTML = "";

  var topPane = makePaneEl("top", false);
  root.appendChild(topPane);

  if (splitOpen && panes.bottom.tabs.length) {
    var divider = document.createElement("div");
    divider.className = "dockDivider dockDivHorz";
    root.appendChild(divider);
    var bottomPane = makePaneEl("bottom", true);
    root.appendChild(bottomPane);
    topPane.style.flex = "1 1 " + (splitRatio * 100) + "%";
    bottomPane.style.flex = "1 1 " + ((1 - splitRatio) * 100) + "%";
    setupDividerDrag(divider, root, topPane, bottomPane);
  } else {
    topPane.style.flex = "1 1 auto";
  }

  renderTopStrip();
  placeViews();
  persistDock();
}

function persistDock() {
  try { localStorage.setItem("dopetool_dock2", JSON.stringify({ panes: panes, splitOpen: splitOpen, ratio: splitRatio, focused: focusedPane })); } catch (e) {}
}

// A pane element: (optional strip +) body. The top pane's strip lives in the
// top tab bar, so top panes render body-only here.
function makePaneEl(pane, withStrip) {
  var el = document.createElement("div");
  el.className = "dockPane" + (focusedPane === pane ? " focused" : "");
  // Focus on mousedown, but WITHOUT a full rebuild (that would destroy the
  // element being clicked before its click event fires).
  el.addEventListener("mousedown", function () {
    if (focusedPane === pane) return;
    focusedPane = pane;
    var others = document.querySelectorAll(".dockPane");
    for (var k = 0; k < others.length; k++) others[k].classList.remove("focused");
    el.classList.add("focused");
    persistDock();
  });
  if (withStrip) el.appendChild(makePaneStrip(pane));
  var body = document.createElement("div");
  body.className = "dockPaneBody paneBody";
  body.setAttribute("data-pane-body", pane);
  el.appendChild(body);
  return el;
}

function makeTabBtn(pane, tab) {
  var b = document.createElement("button");
  b.className = "paneTabBtn" + (panes[pane].active === tab ? " active" : "");
  b.setAttribute("data-tab", tab);
  b.setAttribute("draggable", "true");
  b.textContent = TAB_TITLES[tab] || tab;
  b.addEventListener("click", function () { activateTab(tab); });
  b.addEventListener("dragstart", function (e) {
    dockDragTab = tab; b.classList.add("dragging");
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tab); } catch (err) {}
  });
  b.addEventListener("dragend", function () { b.classList.remove("dragging"); dockDragTab = null; });
  return b;
}

// "+" button: pull a tab out of the OTHER pane into this one. The menu is
// rendered into <body> (fixed-positioned) so the scrolling strip can't clip it.
function closeAddMenu() {
  var m = document.getElementById("activeAddMenu");
  if (m && m.parentNode) m.parentNode.removeChild(m);
}
function makeAddBtn(pane) {
  var other = pane === "top" ? "bottom" : "top";
  var btn = document.createElement("button");
  btn.className = "paneAddBtn";
  btn.innerHTML = "+";
  btn.title = "Add a tab to this panel";
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    var open = document.getElementById("activeAddMenu");
    closeAddMenu();
    if (open) return; // toggle off if it was already showing
    var menu = document.createElement("div");
    menu.className = "paneAddMenu"; menu.id = "activeAddMenu";
    panes[other].tabs.forEach(function (tab) {
      if (other === "top" && panes.top.tabs.length <= 1) return; // can't empty the top pane
      var it = document.createElement("div");
      it.className = "paneAddItem";
      it.textContent = TAB_TITLES[tab] || tab;
      it.addEventListener("click", function (ev) { ev.stopPropagation(); closeAddMenu(); moveTab(tab, pane); });
      menu.appendChild(it);
    });
    if (!menu.children.length) return;
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - menu.offsetWidth - 4)) + "px";
    menu.style.top = (pane === "top") ? (r.bottom + 2) + "px" : (r.top - menu.offsetHeight - 2) + "px";
  });
  return btn;
}

function stripCanPull(pane) {
  var other = pane === "top" ? "bottom" : "top";
  return other === "top" ? panes.top.tabs.length > 1 : panes.bottom.tabs.length > 0;
}

// The bottom pane's own strip.
function makePaneStrip(pane) {
  var strip = document.createElement("div");
  strip.className = "paneStrip";
  strip.setAttribute("data-strip", pane);
  panes[pane].tabs.forEach(function (tab) { strip.appendChild(makeTabBtn(pane, tab)); });
  if (stripCanPull(pane)) strip.appendChild(makeAddBtn(pane));
  var spacer = document.createElement("div"); spacer.className = "paneStripSpacer"; strip.appendChild(spacer);
  var close = document.createElement("button");
  close.className = "paneStripClose"; close.innerHTML = "&times;"; close.title = "Close split";
  close.addEventListener("click", function (e) { e.stopPropagation(); closeSplit(); });
  strip.appendChild(close);
  setupStripDrop(strip, pane);
  return strip;
}

// The top tab bar acts as the top pane's strip.
function renderTopStrip() {
  var strip = document.getElementById("topTabScroll");
  if (!strip) return;
  strip.innerHTML = "";
  panes.top.tabs.forEach(function (tab) { strip.appendChild(makeTabBtn("top", tab)); });
  if (stripCanPull("top")) strip.appendChild(makeAddBtn("top"));
  setupStripDrop(strip, "top");
  var act = strip.querySelector(".paneTabBtn.active");
  if (act) { try { act.scrollIntoView({ inline: "center", block: "nearest" }); } catch (e) {} }
  if (typeof updateTopTabFades === "function") updateTopTabFades();
}

function placeViews() {
  ["top", "bottom"].forEach(function (pane) {
    var body = document.querySelector('[data-pane-body="' + pane + '"]');
    if (!body) return;
    var p = panes[pane];
    p.tabs.forEach(function (tab) {
      var showId = (tab === p.active) ? activeViewId(tab) : null;
      viewsFor(tab).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { body.appendChild(el); el.classList.toggle("hidden", id !== showId); }
      });
    });
    if (p.active) loadForTab(p.active);
  });
}

// ---- Drop a dragged tab onto a strip (move it into that pane / reorder) ----
function setupStripDrop(strip, pane) {
  strip.addEventListener("dragover", function (e) {
    if (!dockDragTab) return;
    e.preventDefault();
    strip.classList.add("stripDrop");
  });
  strip.addEventListener("dragleave", function (e) { if (e.target === strip) strip.classList.remove("stripDrop"); });
  strip.addEventListener("drop", function (e) {
    if (!dockDragTab) return;
    e.preventDefault(); e.stopPropagation();
    strip.classList.remove("stripDrop");
    moveTab(dockDragTab, pane, dropIndex(strip, e.clientX));
    dockDragTab = null;
  });
}
function dropIndex(strip, x) {
  var btns = strip.querySelectorAll(".paneTabBtn");
  for (var i = 0; i < btns.length; i++) {
    var r = btns[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return i;
  }
  return btns.length;
}

// ---- Divider resize (vertical) ----
function setupDividerDrag(divider, container, topEl, bottomEl) {
  divider.addEventListener("mousedown", function (e) {
    e.preventDefault();
    document.body.style.userSelect = "none";
    function onMove(ev) {
      var rect = container.getBoundingClientRect();
      var ratio = (ev.clientY - rect.top) / rect.height;
      ratio = Math.max(0.15, Math.min(0.85, ratio));
      splitRatio = ratio;
      topEl.style.flex = "1 1 " + (ratio * 100) + "%";
      bottomEl.style.flex = "1 1 " + ((1 - ratio) * 100) + "%";
      if (typeof smoothDraw === "function") smoothDraw();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      persistDock();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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


// ---- LOAD ALL CLIENTS ----
function loadAllClients() {
  var grid = document.getElementById("clientGrid");
  grid.innerHTML = '<div style="color:#333348;padding:20px;text-align:center;font-size:11px;">Loading...</div>';
  var collections = ["colors","fonts","textstyles","effects","animations","assets"];
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
  var collections = ["colors","fonts","textstyles","effects","animations","assets"];
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
  var collections = ["colors","fonts","textstyles","effects","animations","assets"];
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
  document.getElementById("manualColorForm").classList.add("hidden");
  document.getElementById("assetForm").classList.add("hidden");
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
    document.getElementById("manualColorForm").classList.add("hidden");
    document.getElementById("assetForm").classList.add("hidden");
    hideContextMenu();
    updateTabUI();
    loadClientLibrary(currentTab);
  });
});

function updateTabUI() {
  var isEffects = currentTab === "effects";
  var isAnimations = currentTab === "animations";
  var isTextStyles = currentTab === "textstyles";
  var isAssets = currentTab === "assets";
  var isFfxTab = isEffects || isAnimations;
  document.getElementById("captureBtn").classList.toggle("hidden", isFfxTab || isAssets);
  document.getElementById("ffxToggleBtn").classList.toggle("hidden", !isFfxTab);
  document.getElementById("quickCaptureBtn").classList.toggle("hidden", !isEffects);
  document.getElementById("ffxStyleToggleBtn").classList.toggle("hidden", !isTextStyles);
  document.getElementById("manualColorBtn").classList.toggle("hidden", currentTab !== "colors");
  document.getElementById("assetToggleBtn").classList.toggle("hidden", !isAssets);
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
        contentEl.classList.remove("library--grid");
        contentEl.innerHTML = '<div class="emptyState">No ' + tab + ' saved yet.<br>Use the buttons above to add.</div>';
        return;
      }
      renderCurrent();
    })
    .catch(function (err) {
      contentEl.classList.remove("library--grid");
      contentEl.innerHTML = '<div style="color:#ff5566;padding:12px;font-size:11px;">Error: ' + err.message + '</div>';
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

// Re-sort and re-render the already-loaded items (no refetch).
function renderCurrent() {
  var sorted = currentData.slice().sort(compareItems);
  renderItems(sorted, currentTab);
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
var GROQ_STT_MODEL = "whisper-large-v3-turbo";
var GROQ_LLM_MODEL = "llama-3.3-70b-versatile";
var acChild = require("child_process");

function getGroqKey() { try { return localStorage.getItem("dopetool_groq_key") || ""; } catch (e) { return ""; } }
function acProgress(msg) { var el = document.getElementById("autoCapProgress"); if (el) el.innerText = msg; }
function acStatus(msg) { var el = document.getElementById("autoCapStatus"); if (el) el.innerText = msg; }

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
  var args = [
    "-s", "-S", "--max-time", "600",
    "https://api.groq.com/openai/v1/audio/transcriptions",
    "-H", "Authorization: Bearer " + key,
    "-F", "file=@" + audioPath,
    "-F", "model=" + GROQ_STT_MODEL,
    "-F", "response_format=verbose_json",
    "-F", "timestamp_granularities[]=word",
    "-F", "timestamp_granularities[]=segment"
  ];
  if (lang && lang !== "auto") args.push("-F", "language=" + lang);
  acExecJson(args, cb);
}

function groqChat(key, systemPrompt, userContent, cb) {
  var body = JSON.stringify({
    model: GROQ_LLM_MODEL, temperature: 0.2,
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

function acExecJson(args, cb) {
  acChild.execFile("curl", args, { maxBuffer: 1024 * 1024 * 64 }, function (err, stdout, stderr) {
    if (err && !stdout) { cb(stderr || err.message || "Request failed"); return; }
    var data;
    try { data = JSON.parse(stdout); } catch (e) { cb("Bad response: " + (stdout || "").slice(0, 200)); return; }
    if (data && data.error) { cb(data.error.message || JSON.stringify(data.error)); return; }
    cb(null, data);
  });
}

// ---- Audio prep: compress to 16kHz mono MP3 with ffmpeg (also extracts audio
// from video) so we stay under Groq's ~25 MB upload limit and Whisper gets its
// preferred format. Returns the original path if ffmpeg isn't available. ----
var GROQ_MAX_BYTES = 24 * 1024 * 1024;
function acFindFfmpeg(cb) {
  var candidates = ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
  var i = 0;
  (function tryNext() {
    if (i >= candidates.length) { cb(null); return; }
    var c = candidates[i++];
    acChild.execFile(c, ["-version"], { timeout: 8000 }, function (err) { if (err) tryNext(); else cb(c); });
  })();
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
    segs.push({ inSec: chunk[0].start, outSec: chunk[chunk.length - 1].end, text: txt });
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

// Romanize each segment's text to Hinglish/Roman, preserving segmentation & timing
function acRomanize(key, segs, cb) {
  acTick("Romanizing to Hinglish");
  var lines = segs.map(function (s, i) { return (i + 1) + ". " + s.text; }).join("\n");
  var sys = "You convert Hindi/Urdu subtitle lines into natural Roman script (Hinglish) exactly as Indian/Pakistani content creators type on social media. Rules: keep the SAME language, do NOT translate to English — only transliterate to Roman letters. Keep existing English words as-is. Return EXACTLY the same number of lines, each prefixed with its number and a period, same order. No extra commentary.";
  groqChat(key, sys, lines, function (err, data) {
    acStopTick();
    if (err) { cb(err); return; }
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) { cb("Empty romanize response"); return; }
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
      if (roman) acRomanize(key, segs, function (e2, r) { if (e2) acProgress("Romanize failed: " + e2); else acImportSegments(r); });
      else acImportSegments(segs);
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
    acProgress(v ? "Groq key saved." : "Groq key cleared.");
  });

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
  if (runBtn) runBtn.addEventListener("click", autoCapRun);
})();

// ---- SORT CONTROL ----
document.getElementById("sortSelect").addEventListener("change", function () {
  currentSort = this.value;
  if (currentData && currentData.length) renderCurrent();
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
function renderItems(items, tab) {
  var contentEl = document.getElementById("libraryContent");
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
      addLongPressHandler(tile, cEntry);
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
    banner.innerHTML = '<span>Update partially failed: ' + failed.join(", ") + '</span>';
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
  loadAllClients();
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

// ---- PERSISTENT TOP TAB BAR NAVIGATION ----
function switchTopTab(tab) { activateTab(tab); }

// Toggle the left/right edge fades based on scroll position
function updateTopTabFades() {
  var strip = document.getElementById("topTabScroll");
  var bar = document.getElementById("topTabBar");
  if (!strip || !bar) return;
  var maxScroll = strip.scrollWidth - strip.clientWidth;
  bar.classList.toggle("moreLeft", strip.scrollLeft > 2);
  bar.classList.toggle("moreRight", strip.scrollLeft < maxScroll - 2);
}

(function () {
  // Restore saved layout (validate: every tab present exactly once, top non-empty)
  try {
    var saved = JSON.parse(localStorage.getItem("dopetool_dock2") || "null");
    if (saved && saved.panes && saved.panes.top && saved.panes.bottom) {
      var seen = {}, ok = true;
      ["top", "bottom"].forEach(function (p) {
        (saved.panes[p].tabs || []).forEach(function (t) { if (seen[t] || TAB_TITLES[t] === undefined) ok = false; seen[t] = 1; });
      });
      var allThere = ALL_TABS.every(function (t) { return seen[t]; });
      if (ok && allThere && saved.panes.top.tabs.length >= 1) {
        panes = saved.panes;
        splitOpen = !!saved.splitOpen && panes.bottom.tabs.length > 0;
        splitRatio = saved.ratio || 0.55;
        focusedPane = (saved.focused === "bottom" && panes.bottom.tabs.length) ? "bottom" : "top";
      }
    }
  } catch (e) {}

  // Split button: open a bottom pane (or close it if already split)
  var splitBtn = document.getElementById("splitBtn");
  if (splitBtn) {
    splitBtn.title = "Split — show a second panel below";
    splitBtn.addEventListener("click", function () { if (splitOpen) closeSplit(); else openSplit(); });
  }

  var strip = document.getElementById("topTabScroll");
  if (strip) {
    // Mouse wheel steps the top pane through its own tabs
    strip.addEventListener("wheel", function (e) {
      e.preventDefault();
      var list = panes.top.tabs;
      var i = list.indexOf(panes.top.active);
      var dir = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
      var ni = i + dir;
      if (ni >= 0 && ni < list.length) activateTab(list[ni]);
    });
    strip.addEventListener("scroll", updateTopTabFades);
    window.addEventListener("resize", updateTopTabFades);
  }

  // Close any open "+" add-menu when clicking elsewhere
  document.addEventListener("click", closeAddMenu);

  buildDock();
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

  var alignBtns = view.querySelectorAll("[data-align]");
  for (var k = 0; k < alignBtns.length; k++) {
    alignBtns[k].addEventListener("click", function () {
      tkEval('alignLayers("' + this.getAttribute("data-align") + '")');
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
