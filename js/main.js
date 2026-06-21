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

document.querySelectorAll(".tabBtn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tabBtn").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");
    currentTab = btn.getAttribute("data-tab");
    document.getElementById("searchBox").value = "";
    document.getElementById("clientFilter").value = "";
    hideForm();
    hideContextMenu();
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
    if (item.data.client && clients.indexOf(item.data.client) === -1) {
      clients.push(item.data.client);
    }
  });
  clients.sort();

  select.innerHTML = '<option value="">All Clients</option>';
  clients.forEach(function (client) {
    var opt = document.createElement("option");
    opt.value = client;
    opt.innerText = client;
    select.appendChild(opt);
  });

  if (clients.indexOf(currentValue) !== -1) {
    select.value = currentValue;
  }
}

// ---- Capture button ----
document.getElementById("captureBtn").addEventListener("click", function () {
  var captureCall = captureFunctionMap[currentTab];
  document.getElementById("output").innerText = "Capturing from selected layer...";

  csInterface.evalScript(captureCall, function (resultStr) {
    var result;
    try {
      result = JSON.parse(resultStr);
    } catch (e) {
      document.getElementById("output").innerText = "Capture failed: invalid response.";
      return;
    }

    if (result.error) {
      document.getElementById("output").innerText = "Capture failed: " + result.error;
      return;
    }

    pendingCapture = result;
    showForm(result);
    document.getElementById("output").innerText = "Captured. Fill in name and client, then save.";
  });
});

function showForm(captured) {
  var form = document.getElementById("addForm");
  var preview = document.getElementById("capturePreview");
  form.classList.remove("hidden");

  if (currentTab === "colors") {
    preview.innerHTML = '<div class="swatch" style="background-color:' + captured.hex + '"></div><span>' + captured.hex + '</span>';
  } else if (currentTab === "fonts") {
    preview.innerHTML = '<span>' + captured.name + '</span>';
  } else if (currentTab === "textstyles") {
    preview.innerHTML = '<div class="swatch" style="background-color:' + captured.color + '"></div><span>' + captured.font + ' \u00b7 ' + captured.size + '</span>';
  } else if (currentTab === "effects") {
    preview.innerHTML = '<span>' + captured.name + '</span>';
  }

  document.getElementById("newName").value = "";
  document.getElementById("newClient").value = "";
  document.getElementById("newName").focus();
}

function hideForm() {
  document.getElementById("addForm").classList.add("hidden");
  pendingCapture = null;
}

document.getElementById("cancelBtn").addEventListener("click", hideForm);

document.getElementById("saveBtn").addEventListener("click", function () {
  if (!pendingCapture) return;

  var name = document.getElementById("newName").value.trim();
  var client = document.getElementById("newClient").value.trim();

  if (!name) {
    document.getElementById("output").innerText = "Please enter a name.";
    return;
  }

  var docData = Object.assign({}, pendingCapture, { name: name, client: client || "General" });
  var collectionName = collectionMap[currentTab];
  document.getElementById("output").innerText = "Saving to Firebase...";

  db.collection(collectionName).add(docData)
    .then(function () {
      document.getElementById("output").innerText = "Saved to " + collectionName + "!";
      hideForm();
      loadLibrary(currentTab);
    })
    .catch(function (err) {
      document.getElementById("output").innerText = "Save failed: " + err.message;
    });
});

// ---- Load from Firebase (now tracks doc IDs) ----
function loadLibrary(tab) {
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = "Loading...";

  var collectionName = collectionMap[tab];

  db.collection(collectionName).get()
    .then(function (snapshot) {
      currentData = [];
      snapshot.forEach(function (doc) {
        currentData.push({ id: doc.id, data: doc.data() });
      });

      populateClientFilter(currentData);

      if (currentData.length === 0) {
        contentEl.innerHTML = "No items in " + collectionName + " yet.";
        return;
      }

      renderItems(currentData, tab);
    })
    .catch(function (err) {
      contentEl.innerHTML = "Error: " + err.message;
    });
}

function makeColorHandler(hexValue) {
  return function () {
    applyToAE('applyColor("' + hexValue + '")');
  };
}
function makeFontHandler(fontValue) {
  return function () {
    applyToAE('applyFont("' + fontValue + '")');
  };
}
function makeTextStyleHandler(fontValue, sizeValue, colorValue) {
  return function () {
    var sizeNum = sizeValue.toString().replace("px", "");
    applyToAE('applyTextStyle("' + fontValue + '", ' + sizeNum + ', "' + colorValue + '")');
  };
}
function makeEffectHandler(typeValue) {
  return function () {
    applyToAE('applyEffect("' + typeValue + '")');
  };
}

function renderItems(items, tab) {
  var contentEl = document.getElementById("libraryContent");
  contentEl.innerHTML = "";

  if (items.length === 0) {
    contentEl.innerHTML = "No matches.";
    return;
  }

  for (var idx = 0; idx < items.length; idx++) {
    var entry = items[idx];
    var data = entry.data;
    var card = document.createElement("div");
    card.className = "card clickable";

    if (tab === "colors") {
      card.innerHTML =
        '<div class="swatch" style="background-color:' + data.hex + '"></div>' +
        '<div class="cardInfo">' +
          '<div class="cardTitle">' + data.name + '</div>' +
          '<div class="cardSub">' + data.hex + ' \u00b7 ' + data.client + '</div>' +
        '</div>';
      card.addEventListener("click", makeColorHandler(data.hex));
    } else if (tab === "fonts") {
      card.innerHTML =
        '<div class="cardInfo">' +
          '<div class="cardTitle">' + data.name + '</div>' +
          '<div class="cardSub">' + (data.weight || "") + ' \u00b7 ' + data.client + '</div>' +
        '</div>';
      card.addEventListener("click", makeFontHandler(data.name));
    } else if (tab === "textstyles") {
      card.innerHTML =
        '<div class="swatch" style="background-color:' + (data.color || "#888") + '"></div>' +
        '<div class="cardInfo">' +
          '<div class="cardTitle">' + data.name + '</div>' +
          '<div class="cardSub">' + data.font + ' \u00b7 ' + data.size + ' \u00b7 ' + data.client + '</div>' +
        '</div>';
      card.addEventListener("click", makeTextStyleHandler(data.font, data.size, data.color));
    } else if (tab === "effects") {
      card.innerHTML =
        '<div class="cardInfo">' +
          '<div class="cardTitle">' + data.name + '</div>' +
          '<div class="cardSub">' + (data.type || "") + ' \u00b7 ' + data.client + '</div>' +
        '</div>';
      card.addEventListener("click", makeEffectHandler(data.type));
    }

    // Right-click context menu
    card.addEventListener("contextmenu", function (entryRef) {
      return function (e) {
        e.preventDefault();
        activeContextId = entryRef.id;
        activeContextItem = entryRef.data;
        showContextMenu(e.pageX, e.pageY);
      };
    }(entry));

    contentEl.appendChild(card);
  }
}

// ---- Context menu (right-click) ----
function showContextMenu(x, y) {
  var menu = document.getElementById("contextMenu");
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.classList.remove("hidden");
}

function hideContextMenu() {
  document.getElementById("contextMenu").classList.add("hidden");
}

document.addEventListener("click", function () {
  hideContextMenu();
});

document.getElementById("ctxDelete").addEventListener("click", function (e) {
  e.stopPropagation();
  if (!activeContextId) return;

  var collectionName = collectionMap[currentTab];
  document.getElementById("output").innerText = "Deleting...";

  db.collection(collectionName).doc(activeContextId).delete()
    .then(function () {
      document.getElementById("output").innerText = "Deleted.";
      hideContextMenu();
      loadLibrary(currentTab);
    })
    .catch(function (err) {
      document.getElementById("output").innerText = "Delete failed: " + err.message;
    });
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

  if (!newName) {
    document.getElementById("output").innerText = "Name cannot be empty.";
    return;
  }

  var collectionName = collectionMap[currentTab];
  document.getElementById("output").innerText = "Updating...";

  db.collection(collectionName).doc(activeContextId).update({
    name: newName,
    client: newClient || "General"
  })
    .then(function () {
      document.getElementById("output").innerText = "Updated.";
      document.getElementById("editForm").classList.add("hidden");
      loadLibrary(currentTab);
    })
    .catch(function (err) {
      document.getElementById("output").innerText = "Update failed: " + err.message;
    });
});

function applyToAE(scriptCall) {
  csInterface.evalScript(scriptCall, function (result) {
    document.getElementById("output").innerText = result;
  });
}

window.addEventListener("DOMContentLoaded", function () {
  setTimeout(function () {
    loadLibrary(currentTab);
  }, 300);
});
