function testConnection() {
  return "Connected to AE version: " + app.version;
}

function hexToRgb(hex) {
  hex = hex.toString();
  hex = hex.replace(/#/g, "");
  hex = hex.replace(/\s/g, "");
  if (hex.length !== 6) {
    return { rgb: [1, 1, 1], debug: "BAD LENGTH: '" + hex + "' len=" + hex.length };
  }
  var r = parseInt(hex.substr(0, 2), 16) / 255;
  var g = parseInt(hex.substr(2, 2), 16) / 255;
  var b = parseInt(hex.substr(4, 2), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { rgb: [1, 1, 1], debug: "NaN PARSE" };
  }
  return { rgb: [r, g, b], debug: "OK" };
}

function rgbToHexUpper(rgb) {
  function toHex(val) {
    var h = Math.round(val * 255).toString(16);
    return h.length === 1 ? "0" + h : h;
  }
  return ("#" + toHex(rgb[0]) + toHex(rgb[1]) + toHex(rgb[2])).toUpperCase();
}

function applyColor(hex) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return "DEBUG: No active composition.";
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return "DEBUG: No layer selected.";
    }
    var result = hexToRgb(hex);
    var rgb = result.rgb;
    var appliedCount = 0;

    app.beginUndoGroup("DopeTool Apply Color");

    for (var i = 0; i < selectedLayers.length; i++) {
      var layer = selectedLayers[i];
      if (layer instanceof TextLayer) {
        var textProp = layer.property("Source Text");
        var textDocument = textProp.value;
        textDocument.fillColor = rgb;
        textProp.setValue(textDocument);
        appliedCount++;
      } else if (layer instanceof ShapeLayer) {
        var contents = layer.property("Contents");
        var found = false;
        for (var j = 1; j <= contents.numProperties; j++) {
          var groupItem = contents.property(j);
          var fillProp = findFillInGroup(groupItem);
          if (fillProp) {
            fillProp.setValue(rgb);
            found = true;
          }
        }
        if (found) appliedCount++;
      }
    }

    app.endUndoGroup();
    return "Applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString() + " (line " + e.line + ")";
  }
}

function findFillInGroup(group) {
  if (!group || !group.property) return null;
  try {
    var contents = group.property("Contents");
    if (contents) {
      for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        if (item.matchName === "ADBE Vector Graphic - Fill") {
          return item.property("Color");
        }
      }
    }
  } catch (e) {}
  return null;
}

function resolveFontName(displayName) {
  return [
    displayName.replace(/\s/g, ""),
    displayName.replace(/\s/g, "-"),
    displayName.replace(/\s/g, "") + "-Regular",
    displayName.replace(/\s/g, "-") + "-Regular"
  ];
}

function applyFont(fontName) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return "DEBUG: No active composition.";
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return "DEBUG: No layer selected.";
    }
    var appliedCount = 0;
    var lastError = "";
    app.beginUndoGroup("DopeTool Apply Font");
    var guesses = resolveFontName(fontName);
    for (var i = 0; i < selectedLayers.length; i++) {
      var layer = selectedLayers[i];
      if (layer instanceof TextLayer) {
        var textProp = layer.property("Source Text");
        var textDocument = textProp.value;
        var success = false;
        for (var g = 0; g < guesses.length; g++) {
          try {
            textDocument.font = guesses[g];
            textProp.setValue(textDocument);
            success = true;
            break;
          } catch (fontErr) {
            lastError = fontErr.toString();
          }
        }
        if (success) appliedCount++;
      }
    }
    app.endUndoGroup();
    if (appliedCount === 0) {
      return "DEBUG: Font not found. Last error: " + lastError;
    }
    return "Font applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString() + " (line " + e.line + ")";
  }
}

function applyTextStyle(fontName, size, hex) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return "DEBUG: No active composition.";
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return "DEBUG: No layer selected.";
    }
    var result = hexToRgb(hex);
    var guesses = resolveFontName(fontName);
    var appliedCount = 0;
    app.beginUndoGroup("DopeTool Apply Text Style");
    for (var i = 0; i < selectedLayers.length; i++) {
      var layer = selectedLayers[i];
      if (layer instanceof TextLayer) {
        var textProp = layer.property("Source Text");
        var textDocument = textProp.value;
        for (var g = 0; g < guesses.length; g++) {
          try {
            textDocument.font = guesses[g];
            break;
          } catch (e) {}
        }
        textDocument.fontSize = parseFloat(size);
        textDocument.fillColor = result.rgb;
        textProp.setValue(textDocument);
        appliedCount++;
      }
    }
    app.endUndoGroup();
    if (appliedCount === 0) {
      return "DEBUG: No text layer selected.";
    }
    return "Text style applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString() + " (line " + e.line + ")";
  }
}

// Apply effect using its real matchName (e.g. "ADBE Glo2", "ADBE Drop Shadow")
function applyEffect(matchName) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return "No active composition.";
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return "No layer selected.";
    }

    var appliedCount = 0;
    var lastError = "";
    app.beginUndoGroup("DopeTool Apply Effect");

    for (var i = 0; i < selectedLayers.length; i++) {
      var layer = selectedLayers[i];
      try {
        layer.property("Effects").addProperty(matchName);
        appliedCount++;
      } catch (e) {
        lastError = e.toString();
      }
    }

    app.endUndoGroup();

    if (appliedCount === 0) {
      return "DEBUG: Could not apply effect '" + matchName + "'. Error: " + lastError;
    }
    return "Effect applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString();
  }
}

function captureColor() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return JSON.stringify({ error: "No active composition." });
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return JSON.stringify({ error: "No layer selected." });
    }
    var layer = selectedLayers[0];
    if (layer instanceof TextLayer) {
      var textDocument = layer.property("Source Text").value;
      return JSON.stringify({ hex: rgbToHexUpper(textDocument.fillColor) });
    } else if (layer instanceof ShapeLayer) {
      var contents = layer.property("Contents");
      for (var j = 1; j <= contents.numProperties; j++) {
        var groupItem = contents.property(j);
        var fillProp = findFillInGroup(groupItem);
        if (fillProp) {
          return JSON.stringify({ hex: rgbToHexUpper(fillProp.value) });
        }
      }
      return JSON.stringify({ error: "No fill found on shape layer." });
    }
    return JSON.stringify({ error: "Select a Text or Shape layer." });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

function captureTextStyle() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return JSON.stringify({ error: "No active composition." });
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return JSON.stringify({ error: "No layer selected." });
    }
    var layer = selectedLayers[0];
    if (!(layer instanceof TextLayer)) {
      return JSON.stringify({ error: "Select a Text layer." });
    }
    var textDocument = layer.property("Source Text").value;
    return JSON.stringify({
      font: textDocument.font,
      size: Math.round(textDocument.fontSize) + "px",
      color: rgbToHexUpper(textDocument.fillColor)
    });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

function captureFont() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return JSON.stringify({ error: "No active composition." });
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return JSON.stringify({ error: "No layer selected." });
    }
    var layer = selectedLayers[0];
    if (!(layer instanceof TextLayer)) {
      return JSON.stringify({ error: "Select a Text layer." });
    }
    var textDocument = layer.property("Source Text").value;
    return JSON.stringify({ name: textDocument.font, weight: "Regular" });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

// Capture ALL effects on the selected layer, store matchName as "type"
function captureEffects() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return JSON.stringify({ error: "No active composition." });
    }
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) {
      return JSON.stringify({ error: "No layer selected." });
    }
    var layer = selectedLayers[0];
    var effectsProp = layer.property("Effects");

    if (!effectsProp || effectsProp.numProperties === 0) {
      return JSON.stringify({ error: "No effects applied on this layer." });
    }

    var firstEffect = effectsProp.property(1);
    return JSON.stringify({ name: firstEffect.name, type: firstEffect.matchName });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

// Delete a document's worth of data isn't done here - deletion happens via Firebase from JS side.
// This function exists so future effect-stacking could be added later.
