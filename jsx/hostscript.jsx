// DopeTool hostscript.jsx — v2.1.0
// ExtendScript bridge between DopeTool panel and After Effects

function testConnection() {
  return "Connected: AE " + app.version;
}

// ---- COLOR UTILITIES ----
function hexToRgb(hex) {
  hex = hex.toString().replace(/#/g, "").replace(/\s/g, "");
  if (hex.length !== 6) return { rgb: [1, 1, 1], debug: "BAD HEX" };
  var r = parseInt(hex.substr(0, 2), 16) / 255;
  var g = parseInt(hex.substr(2, 2), 16) / 255;
  var b = parseInt(hex.substr(4, 2), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return { rgb: [1, 1, 1], debug: "NaN" };
  return { rgb: [r, g, b], debug: "OK" };
}

function rgbToHexUpper(rgb) {
  function toHex(val) {
    var h = Math.round(val * 255).toString(16);
    return h.length === 1 ? "0" + h : h;
  }
  return ("#" + toHex(rgb[0]) + toHex(rgb[1]) + toHex(rgb[2])).toUpperCase();
}

// ---- SHAPE FILL HELPER ----
function findFillInGroup(group) {
  if (!group || !group.property) return null;
  try {
    var contents = group.property("Contents");
    if (contents) {
      for (var i = 1; i <= contents.numProperties; i++) {
        var item = contents.property(i);
        if (item.matchName === "ADBE Vector Graphic - Fill") return item.property("Color");
      }
    }
  } catch (e) {}
  return null;
}

// ---- FONT HELPERS ----
function resolveFontName(displayName) {
  return [
    displayName,
    displayName.replace(/\s/g, ""),
    displayName.replace(/\s/g, "-"),
    displayName.replace(/\s/g, "") + "-Regular",
    displayName.replace(/\s/g, "-") + "-Regular"
  ];
}

// ---- APPLY COLOR (smart — detects layer type) ----
function applyColorSmart(hex) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length === 0) return "No layer selected.";
    var rgb = hexToRgb(hex).rgb;
    var count = 0;
    app.beginUndoGroup("DopeTool: Apply Color");
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (layer instanceof TextLayer) {
        var tp = layer.property("Source Text");
        var td = tp.value;
        td.fillColor = rgb;
        tp.setValue(td);
        count++;
      } else if (layer instanceof ShapeLayer) {
        var contents = layer.property("Contents");
        var found = false;
        for (var j = 1; j <= contents.numProperties; j++) {
          var fp = findFillInGroup(contents.property(j));
          if (fp) { fp.setValue(rgb); found = true; }
        }
        if (found) count++;
      } else if (layer.source && layer.source.mainSource && layer.source.mainSource.color !== undefined) {
        // Solid layer
        layer.source.mainSource.color = rgb;
        count++;
      } else {
        // Any other layer — add Fill effect
        try {
          var fx = layer.property("Effects").addProperty("ADBE Fill");
          fx.property("Color").setValue(rgb);
          count++;
        } catch (e) {}
      }
    }
    app.endUndoGroup();
    if (count === 0) return "No compatible layer found.";
    return "Color applied to " + count + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- APPLY STROKE COLOR (shift+click) ----
function applyStrokeColor(hex) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length === 0) return "No layer selected.";
    var rgb = hexToRgb(hex).rgb;
    var count = 0;
    app.beginUndoGroup("DopeTool: Apply Stroke");
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (layer instanceof TextLayer) {
        var tp = layer.property("Source Text");
        var td = tp.value;
        td.strokeColor = rgb;
        td.strokeOverFill = true;
        if (td.strokeWidth === 0) td.strokeWidth = 2;
        tp.setValue(td);
        count++;
      } else if (layer instanceof ShapeLayer) {
        var contents = layer.property("Contents");
        for (var j = 1; j <= contents.numProperties; j++) {
          try {
            var grp = contents.property(j);
            var gc = grp.property("Contents");
            if (gc) {
              for (var k = 1; k <= gc.numProperties; k++) {
                var item = gc.property(k);
                if (item.matchName === "ADBE Vector Graphic - Stroke") {
                  item.property("Color").setValue(rgb);
                  count++;
                }
              }
            }
          } catch (e) {}
        }
      }
    }
    app.endUndoGroup();
    if (count === 0) return "No stroke found. Add a stroke to your layer first.";
    return "Stroke applied to " + count + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- APPLY FONT ----
function applyFont(fontName) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length === 0) return "No layer selected.";
    var guesses = resolveFontName(fontName);
    var count = 0;
    var lastErr = "";
    app.beginUndoGroup("DopeTool: Apply Font");
    for (var i = 0; i < layers.length; i++) {
      if (layers[i] instanceof TextLayer) {
        var tp = layers[i].property("Source Text");
        var td = tp.value;
        var ok = false;
        for (var g = 0; g < guesses.length; g++) {
          try { td.font = guesses[g]; tp.setValue(td); ok = true; break; }
          catch (e) { lastErr = e.toString(); }
        }
        if (ok) count++;
      }
    }
    app.endUndoGroup();
    if (count === 0) return "Font not found on this system. Last error: " + lastErr;
    return "Font applied to " + count + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- APPLY TEXT STYLE ----
function applyTextStyle(fontName, size, hex, effectsJsonStr) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length === 0) return "No layer selected.";
    var rgb = hexToRgb(hex).rgb;
    var guesses = resolveFontName(fontName);
    var effects = [];
    try { effects = JSON.parse(effectsJsonStr); } catch (e) {}
    var count = 0;
    app.beginUndoGroup("DopeTool: Apply Text Style");
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (layer instanceof TextLayer) {
        var tp = layer.property("Source Text");
        var td = tp.value;
        for (var g = 0; g < guesses.length; g++) {
          try { td.font = guesses[g]; break; } catch (e) {}
        }
        td.fontSize = parseFloat(size);
        td.fillColor = rgb;
        tp.setValue(td);
        for (var ef = 0; ef < effects.length; ef++) {
          try {
            var newFx = layer.property("Effects").addProperty(effects[ef].matchName);
            if (newFx && effects[ef].props) restoreEffectProps(newFx, effects[ef].props);
          } catch (e) {}
        }
        count++;
      }
    }
    app.endUndoGroup();
    if (count === 0) return "No text layer selected.";
    return "Text style applied to " + count + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- EFFECT PROPERTY CAPTURE ----
function captureEffectProps(effectProp) {
  var props = [];
  try {
    for (var i = 1; i <= effectProp.numProperties; i++) {
      try {
        var prop = effectProp.property(i);
        var pd = { name: prop.name, matchName: prop.matchName, type: prop.propertyType.toString() };
        if (prop.numProperties > 0) {
          pd.children = captureEffectProps(prop);
        } else {
          try {
            var val = prop.value;
            var vt = typeof val;
            if (vt === "number" || vt === "boolean" || vt === "string") {
              pd.value = val; pd.valueType = vt;
            } else if (val && val.length === 2) { pd.value = [val[0], val[1]]; pd.valueType = "array2"; }
            else if (val && val.length === 3) { pd.value = [val[0], val[1], val[2]]; pd.valueType = "array3"; }
            else if (val && val.length === 4) { pd.value = [val[0], val[1], val[2], val[3]]; pd.valueType = "array4"; }
          } catch (e) {}
        }
        props.push(pd);
      } catch (e) {}
    }
  } catch (e) {}
  return props;
}

// ---- EFFECT PROPERTY RESTORE ----
function restoreEffectProps(effectProp, props) {
  if (!props || props.length === 0) return;
  for (var i = 0; i < props.length; i++) {
    try {
      var pd = props[i];
      if (!pd.matchName) continue;
      var prop = null;
      try { prop = effectProp.property(pd.matchName); } catch (e) {}
      if (!prop) { try { prop = effectProp.property(pd.name); } catch (e) {} }
      if (!prop) continue;
      if (pd.children && prop.numProperties > 0) { restoreEffectProps(prop, pd.children); continue; }
      if (pd.value === undefined || pd.value === null) continue;
      if (!prop.canSetValue) continue;
      try {
        if (pd.valueType === "array2") prop.setValue([parseFloat(pd.value[0]), parseFloat(pd.value[1])]);
        else if (pd.valueType === "array3") prop.setValue([parseFloat(pd.value[0]), parseFloat(pd.value[1]), parseFloat(pd.value[2])]);
        else if (pd.valueType === "array4") prop.setValue([parseFloat(pd.value[0]), parseFloat(pd.value[1]), parseFloat(pd.value[2]), parseFloat(pd.value[3])]);
        else if (pd.valueType === "number") prop.setValue(parseFloat(pd.value));
        else if (pd.valueType === "boolean") prop.setValue(Boolean(pd.value));
        else if (pd.valueType === "string") prop.setValue(String(pd.value));
      } catch (e) {}
    } catch (e) {}
  }
}

// ---- APPLY EFFECT WITH PROPS ----
function applyEffectWithProps(effectJsonStr) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length === 0) return "No layer selected.";
    var effectData = JSON.parse(effectJsonStr);
    var matchName = effectData.matchName || effectData.type;
    if (!matchName) return "Error: No effect matchName found.";
    var count = 0;
    app.beginUndoGroup("DopeTool: Apply Effect");
    for (var i = 0; i < layers.length; i++) {
      try {
        var newFx = layers[i].property("Effects").addProperty(matchName);
        if (newFx && effectData.props && effectData.props.length > 0) restoreEffectProps(newFx, effectData.props);
        count++;
      } catch (e) {}
    }
    app.endUndoGroup();
    if (count === 0) return "Could not apply effect.";
    return "Effect applied to " + count + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- APPLY FFX PRESET ----
function applyFfxPreset(presetPath) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length === 0) return "No layer selected.";
    var file = new File(presetPath);
    if (!file.exists) return "Preset file not found: " + presetPath;
    app.beginUndoGroup("DopeTool: Apply FFX Preset");
    for (var i = 0; i < layers.length; i++) layers[i].applyPreset(file);
    app.endUndoGroup();
    return "Preset applied to " + layers.length + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- GET PRESETS FOLDER ----
function getPresetsFolder() {
  try {
    var ae2024 = Folder("/Applications/Adobe After Effects 2024/Presets");
    if (ae2024.exists) return ae2024.fsName;
    var ae2025 = Folder("/Applications/Adobe After Effects 2025/Presets");
    if (ae2025.exists) return ae2025.fsName;
    var appFolder = Folder(app.path);
    var direct = Folder(appFolder.fsName + "/Presets");
    if (direct.exists) return direct.fsName;
    var parent = Folder(appFolder.parent.fsName + "/Presets");
    if (parent.exists) return parent.fsName;
    return "ERROR: Presets folder not found";
  } catch (e) { return "ERROR: " + e.toString(); }
}

// ---- CAPTURE COLOR ----
function captureColor() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var layers = comp.selectedLayers;
    if (layers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = layers[0];
    if (layer instanceof TextLayer) {
      return JSON.stringify({ hex: rgbToHexUpper(layer.property("Source Text").value.fillColor) });
    } else if (layer instanceof ShapeLayer) {
      var contents = layer.property("Contents");
      for (var j = 1; j <= contents.numProperties; j++) {
        var fp = findFillInGroup(contents.property(j));
        if (fp) return JSON.stringify({ hex: rgbToHexUpper(fp.value) });
      }
      return JSON.stringify({ error: "No fill found on shape." });
    }
    return JSON.stringify({ error: "Select a Text or Shape layer." });
  } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

// ---- CAPTURE FONT ----
function captureFont() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var layers = comp.selectedLayers;
    if (layers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = layers[0];
    if (!(layer instanceof TextLayer)) return JSON.stringify({ error: "Select a Text layer." });
    var td = layer.property("Source Text").value;
    return JSON.stringify({ name: td.font, weight: "Regular" });
  } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

// ---- CAPTURE TEXT STYLE ----
function captureTextStyle() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var layers = comp.selectedLayers;
    if (layers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = layers[0];
    if (!(layer instanceof TextLayer)) return JSON.stringify({ error: "Select a Text layer." });
    var td = layer.property("Source Text").value;
    var effects = [];
    var effectsProp = layer.property("Effects");
    if (effectsProp) {
      for (var i = 1; i <= effectsProp.numProperties; i++) {
        try {
          var fx = effectsProp.property(i);
          effects.push({ name: fx.name, matchName: fx.matchName, props: captureEffectProps(fx) });
        } catch (e) {}
      }
    }
    var layerStyles = [];
    try {
      var stylesProp = layer.property("Layer Styles");
      if (stylesProp) {
        for (var s = 1; s <= stylesProp.numProperties; s++) {
          try {
            var style = stylesProp.property(s);
            if (style.enabled) layerStyles.push({ name: style.name, matchName: style.matchName, props: captureEffectProps(style) });
          } catch (e) {}
        }
      }
    } catch (e) {}
    return JSON.stringify({
      font: td.font,
      size: Math.round(td.fontSize) + "px",
      color: rgbToHexUpper(td.fillColor),
      effects: effects,
      layerStyles: layerStyles
    });
  } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

// ---- CAPTURE EFFECT ----
function captureEffects() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var layers = comp.selectedLayers;
    if (layers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = layers[0];
    var effectsProp = layer.property("Effects");
    if (!effectsProp || effectsProp.numProperties === 0) return JSON.stringify({ error: "No effects on this layer." });
    var fx = effectsProp.property(1);
    return JSON.stringify({ name: fx.name, type: fx.matchName, matchName: fx.matchName, props: captureEffectProps(fx) });
  } catch (e) { return JSON.stringify({ error: e.toString() }); }
}
