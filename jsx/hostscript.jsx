function testConnection() {
  return "Connected to AE version: " + app.version;
}

function hexToRgb(hex) {
  hex = hex.toString();
  hex = hex.replace(/#/g, "");
  hex = hex.replace(/\s/g, "");
  if (hex.length !== 6) {
    return { rgb: [1, 1, 1], debug: "BAD LENGTH" };
  }
  var r = parseInt(hex.substr(0, 2), 16) / 255;
  var g = parseInt(hex.substr(2, 2), 16) / 255;
  var b = parseInt(hex.substr(4, 2), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { rgb: [1, 1, 1], debug: "NaN" };
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
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return "No layer selected.";
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
          var fillProp = findFillInGroup(contents.property(j));
          if (fillProp) { fillProp.setValue(rgb); found = true; }
        }
        if (found) appliedCount++;
      }
    }
    app.endUndoGroup();
    return "Color applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString();
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
    displayName,
    displayName.replace(/\s/g, ""),
    displayName.replace(/\s/g, "-"),
    displayName.replace(/\s/g, "") + "-Regular",
    displayName.replace(/\s/g, "-") + "-Regular"
  ];
}

function applyFont(fontName) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return "No layer selected.";
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
          } catch (fontErr) { lastError = fontErr.toString(); }
        }
        if (success) appliedCount++;
      }
    }
    app.endUndoGroup();
    if (appliedCount === 0) return "Font not found. Last error: " + lastError;
    return "Font applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString();
  }
}

// Apply text style including any captured effects
function applyTextStyle(fontName, size, hex, effectsJsonStr) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return "No layer selected.";

    var result = hexToRgb(hex);
    var guesses = resolveFontName(fontName);
    var appliedCount = 0;

    var effects = [];
    try { effects = JSON.parse(effectsJsonStr); } catch (e) {}

    app.beginUndoGroup("DopeTool Apply Text Style");

    for (var i = 0; i < selectedLayers.length; i++) {
      var layer = selectedLayers[i];
      if (layer instanceof TextLayer) {
        var textProp = layer.property("Source Text");
        var textDocument = textProp.value;

        for (var g = 0; g < guesses.length; g++) {
          try { textDocument.font = guesses[g]; break; } catch (e) {}
        }
        textDocument.fontSize = parseFloat(size);
        textDocument.fillColor = result.rgb;
        textProp.setValue(textDocument);

        // Apply captured effects
        if (effects && effects.length > 0) {
          for (var ef = 0; ef < effects.length; ef++) {
            try {
              layer.property("Effects").addProperty(effects[ef].matchName);
            } catch (e) {}
          }
        }

        appliedCount++;
      }
    }

    app.endUndoGroup();
    if (appliedCount === 0) return "No text layer selected.";
    return "Text style applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString();
  }
}

function applyEffect(matchName) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return "No layer selected.";
    var appliedCount = 0;
    var lastError = "";
    app.beginUndoGroup("DopeTool Apply Effect");
    for (var i = 0; i < selectedLayers.length; i++) {
      try {
        selectedLayers[i].property("Effects").addProperty(matchName);
        appliedCount++;
      } catch (e) { lastError = e.toString(); }
    }
    app.endUndoGroup();
    if (appliedCount === 0) return "Could not apply effect. Error: " + lastError;
    return "Effect applied to " + appliedCount + " layer(s).";
  } catch (e) {
    return "JSX ERROR: " + e.toString();
  }
}

function captureColor() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = selectedLayers[0];
    if (layer instanceof TextLayer) {
      var textDocument = layer.property("Source Text").value;
      return JSON.stringify({ hex: rgbToHexUpper(textDocument.fillColor) });
    } else if (layer instanceof ShapeLayer) {
      var contents = layer.property("Contents");
      for (var j = 1; j <= contents.numProperties; j++) {
        var fillProp = findFillInGroup(contents.property(j));
        if (fillProp) return JSON.stringify({ hex: rgbToHexUpper(fillProp.value) });
      }
      return JSON.stringify({ error: "No fill found on shape layer." });
    }
    return JSON.stringify({ error: "Select a Text or Shape layer." });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

// Capture text style INCLUDING all layer effects and layer styles
function captureTextStyle() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = selectedLayers[0];
    if (!(layer instanceof TextLayer)) return JSON.stringify({ error: "Select a Text layer." });

    var textDocument = layer.property("Source Text").value;
    var hex = rgbToHexUpper(textDocument.fillColor);
    var font = textDocument.font;
    var size = Math.round(textDocument.fontSize) + "px";

    // Capture all effects + layer styles on the layer
    var effects = [];
    var effectsProp = layer.property("Effects");
    if (effectsProp) {
      for (var i = 1; i <= effectsProp.numProperties; i++) {
        try {
          var fx = effectsProp.property(i);
          effects.push({ name: fx.name, matchName: fx.matchName });
        } catch (e) {}
      }
    }

    // Also capture layer styles (drop shadow, gradient overlay etc)
    var layerStyles = [];
    try {
      var stylesProp = layer.property("Layer Styles");
      if (stylesProp) {
        for (var s = 1; s <= stylesProp.numProperties; s++) {
          try {
            var style = stylesProp.property(s);
            if (style.enabled) {
              layerStyles.push({ name: style.name, matchName: style.matchName });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return JSON.stringify({
      font: font,
      size: size,
      color: hex,
      effects: effects,
      layerStyles: layerStyles
    });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

function captureFont() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = selectedLayers[0];
    if (!(layer instanceof TextLayer)) return JSON.stringify({ error: "Select a Text layer." });
    var textDocument = layer.property("Source Text").value;
    return JSON.stringify({ name: textDocument.font, weight: "Regular" });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

function captureEffects() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = selectedLayers[0];
    var effectsProp = layer.property("Effects");
    if (!effectsProp || effectsProp.numProperties === 0) return JSON.stringify({ error: "No effects on this layer." });
    var firstEffect = effectsProp.property(1);
    return JSON.stringify({ name: firstEffect.name, type: firstEffect.matchName });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}
