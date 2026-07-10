// DopeTool hostscript.jsx — v2.7.0

function testConnection() {
  return "Connected: AE " + app.version;
}

// ---- COLOR UTILITIES ----
function hexToRgb(hex) {
  hex = hex.toString().replace(/#/g, "").replace(/\s/g, "");
  if (hex.length !== 6) return { rgb: [1, 1, 1] };
  var r = parseInt(hex.substr(0, 2), 16) / 255;
  var g = parseInt(hex.substr(2, 2), 16) / 255;
  var b = parseInt(hex.substr(4, 2), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return { rgb: [1, 1, 1] };
  return { rgb: [r, g, b] };
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

// ---- APPLY COLOR (smart) ----
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
        layer.source.mainSource.color = rgb;
        count++;
      } else {
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

// ---- APPLY STROKE COLOR ----
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
    if (count === 0) return "Font not found. Last error: " + lastErr;
    return "Font applied to " + count + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- CLEAR ALL EFFECTS FROM LAYER ----
// Called before applying a new style so old effects don't stack
function clearAllEffects(layer) {
  try {
    var effectsProp = layer.property("Effects");
    if (effectsProp) {
      // Remove from last to first to avoid index shifting
      for (var i = effectsProp.numProperties; i >= 1; i--) {
        try { effectsProp.property(i).remove(); } catch (e) {}
      }
    }
  } catch (e) {}
}

// ---- LAYER STYLES ----
// Maps a captured style's display name to the key addProperty() expects.
var DT_LAYERSTYLE_KEYS = {
  "Drop Shadow": "dropShadow",
  "Inner Shadow": "innerShadow",
  "Outer Glow": "outerGlow",
  "Inner Glow": "innerGlow",
  "Bevel and Emboss": "bevelEmboss",
  "Bevel & Emboss": "bevelEmboss",
  "Satin": "satin",
  "Color Overlay": "colorOverlay",
  "Gradient Overlay": "gradientOverlay",
  "Stroke": "stroke"
};

function clearLayerStyles(layer) {
  try {
    var ls = layer.property("ADBE Layer Styles");
    if (!ls) return;
    // Remove enabled styles (Blending Options can't be removed — that throws and is ignored)
    for (var i = ls.numProperties; i >= 1; i--) {
      try { ls.property(i).remove(); } catch (e) {}
    }
  } catch (e) {}
}

// Re-create captured layer styles (drop shadow, stroke, color overlay, glows, etc.)
// and restore their property values. Note: Gradient Overlay's gradient *colors*
// use an opaque data type ExtendScript can't fully serialize, so those may need
// an FFX; solid styles restore cleanly.
function restoreLayerStyles(layer, layerStyles) {
  try {
    if (!layerStyles || !layerStyles.length) return 0;
    var ls = layer.property("ADBE Layer Styles");
    if (!ls) return 0;
    var applied = 0;
    for (var i = 0; i < layerStyles.length; i++) {
      try {
        var st = layerStyles[i];
        if (!st || !st.name) continue;
        // Skip the Blending Options container if it slipped into the capture
        if (st.name === "Blending Options") continue;
        var key = DT_LAYERSTYLE_KEYS[st.name];
        if (!key) continue;
        try { if (ls.canAddProperty(key)) ls.addProperty(key); } catch (eAdd) {}
        // Find the (now enabled) style group by name and restore its values
        var target = null;
        for (var p = 1; p <= ls.numProperties; p++) {
          if (ls.property(p).name === st.name) { target = ls.property(p); break; }
        }
        if (target && st.props) { restoreEffectProps(target, st.props); applied++; }
      } catch (e) {}
    }
    return applied;
  } catch (e) { return 0; }
}

// ---- APPLY TEXT STYLE (full — clears old effects first) ----
function applyTextStyle(styleJson) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length === 0) return "No layer selected.";

    var s = JSON.parse(styleJson);
    var guesses = resolveFontName(s.font || "Arial");
    var fillRgb = hexToRgb(s.color || "#FFFFFF").rgb;
    var effects = s.effects || [];
    var count = 0;

    app.beginUndoGroup("DopeTool: Apply Text Style");

    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (!(layer instanceof TextLayer)) continue;

      // ---- Clear existing effects & layer styles before applying new ones ----
      clearAllEffects(layer);
      clearLayerStyles(layer);

      var tp = layer.property("Source Text");
      var td = tp.value;

      // Font
      for (var g = 0; g < guesses.length; g++) {
        try { td.font = guesses[g]; break; } catch (e) {}
      }

      // Size
      if (s.fontSize) td.fontSize = parseFloat(s.fontSize);

      // Fill color
      td.applyFill = true;
      td.fillColor = fillRgb;

      // Stroke
      if (s.strokeWidth && s.strokeWidth > 0) {
        td.applyStroke = true;
        td.strokeColor = hexToRgb(s.strokeColor || "#000000").rgb;
        td.strokeWidth = parseFloat(s.strokeWidth);
        td.strokeOverFill = true;
      } else {
        td.applyStroke = false;
      }

      // Tracking
      if (s.tracking !== undefined && s.tracking !== null) {
        td.tracking = parseFloat(s.tracking);
      }

      // Leading
      if (s.autoLeading !== undefined) td.autoLeading = s.autoLeading;
      if (!s.autoLeading && s.leading) td.leading = parseFloat(s.leading);

      // Justification
      if (s.justification) {
        try {
          if (s.justification === "CENTER") td.justification = ParagraphJustification.CENTER_JUSTIFY;
          else if (s.justification === "RIGHT") td.justification = ParagraphJustification.RIGHT_JUSTIFY;
          else if (s.justification === "LEFT") td.justification = ParagraphJustification.LEFT_JUSTIFY;
          else if (s.justification === "FULL") td.justification = ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT;
        } catch (e) {}
      }

      // Baseline shift
      if (s.baselineShift !== undefined) {
        try { td.baselineShift = parseFloat(s.baselineShift); } catch (e) {}
      }

      // Faux bold/italic
      if (s.fauxBold !== undefined) { try { td.fauxBold = s.fauxBold; } catch (e) {} }
      if (s.fauxItalic !== undefined) { try { td.fauxItalic = s.fauxItalic; } catch (e) {} }

      // All caps / small caps
      if (s.allCaps !== undefined) { try { td.allCaps = s.allCaps; } catch (e) {} }
      if (s.smallCaps !== undefined) { try { td.smallCaps = s.smallCaps; } catch (e) {} }

      tp.setValue(td);

      // Apply new effects
      for (var ef = 0; ef < effects.length; ef++) {
        try {
          var newFx = layer.property("Effects").addProperty(effects[ef].matchName);
          if (newFx && effects[ef].props) restoreEffectProps(newFx, effects[ef].props, layer.inPoint);
        } catch (e) {}
      }

      // Apply saved layer styles (drop shadow, stroke, glows, color overlay, etc.)
      restoreLayerStyles(layer, s.layerStyles || []);

      count++;
    }

    app.endUndoGroup();
    if (count === 0) return "No text layer selected.";
    return "Text style applied to " + count + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- EFFECT PROPERTY CAPTURE ----
function captureEffectProps(effectProp, timeOffset) {
  if (timeOffset === undefined) timeOffset = 0;
  var props = [];
  try {
    for (var i = 1; i <= effectProp.numProperties; i++) {
      try {
        var prop = effectProp.property(i);
        var pd = { name: prop.name, matchName: prop.matchName, type: prop.propertyType.toString() };
        if (prop.numProperties > 0) {
          pd.children = captureEffectProps(prop, timeOffset);
        } else {
          try {
            var hasKeys = false;
            try { hasKeys = prop.numKeys && prop.numKeys > 0; } catch (e2) {}
            if (hasKeys) {
              var keys = [];
              for (var k = 1; k <= prop.numKeys; k++) {
                try {
                  var kv = prop.keyValue(k);
                  var kt = prop.keyTime(k);
                  var kvt = typeof kv;
                  var ke = { time: kt };
                  if (kvt === "number" || kvt === "boolean" || kvt === "string") { ke.value = kv; ke.valueType = kvt; }
                  else if (kv && kv.length === 2) { ke.value = [kv[0], kv[1]]; ke.valueType = "array2"; }
                  else if (kv && kv.length === 3) { ke.value = [kv[0], kv[1], kv[2]]; ke.valueType = "array3"; }
                  else if (kv && kv.length === 4) { ke.value = [kv[0], kv[1], kv[2], kv[3]]; ke.valueType = "array4"; }
                  keys.push(ke);
                } catch (e3) {}
              }
              if (keys.length > 0) {
                var minTime = keys[0].time;
                for (var mi = 1; mi < keys.length; mi++) { if (keys[mi].time < minTime) minTime = keys[mi].time; }
                for (var mj = 0; mj < keys.length; mj++) { keys[mj].time = keys[mj].time - minTime; }
              }
              pd.keyframes = keys;
            } else {
              var val = prop.value;
              var vt = typeof val;
              if (vt === "number" || vt === "boolean" || vt === "string") { pd.value = val; pd.valueType = vt; }
              else if (val && val.length === 2) { pd.value = [val[0], val[1]]; pd.valueType = "array2"; }
              else if (val && val.length === 3) { pd.value = [val[0], val[1], val[2]]; pd.valueType = "array3"; }
              else if (val && val.length === 4) { pd.value = [val[0], val[1], val[2], val[3]]; pd.valueType = "array4"; }
            }
          } catch (e) {}
        }
        props.push(pd);
      } catch (e) {}
    }
  } catch (e) {}
  return props;
}

// ---- EFFECT PROPERTY RESTORE ----
function restoreEffectProps(effectProp, props, timeOffset) {
  if (timeOffset === undefined) timeOffset = 0;
  if (!props || props.length === 0) return;
  for (var i = 0; i < props.length; i++) {
    try {
      var pd = props[i];
      if (!pd.matchName) continue;
      var prop = null;
      try { prop = effectProp.property(pd.matchName); } catch (e) {}
      if (!prop) { try { prop = effectProp.property(pd.name); } catch (e) {} }
      if (!prop) continue;
      if (pd.children && prop.numProperties > 0) { restoreEffectProps(prop, pd.children, timeOffset); continue; }
      if (pd.keyframes && pd.keyframes.length > 0) {
        try {
          for (var kk = 0; kk < pd.keyframes.length; kk++) {
            var ke = pd.keyframes[kk];
            var kval;
            if (ke.valueType === "array2") kval = [parseFloat(ke.value[0]), parseFloat(ke.value[1])];
            else if (ke.valueType === "array3") kval = [parseFloat(ke.value[0]), parseFloat(ke.value[1]), parseFloat(ke.value[2])];
            else if (ke.valueType === "array4") kval = [parseFloat(ke.value[0]), parseFloat(ke.value[1]), parseFloat(ke.value[2]), parseFloat(ke.value[3])];
            else if (ke.valueType === "number") kval = parseFloat(ke.value);
            else if (ke.valueType === "boolean") kval = Boolean(ke.value);
            else if (ke.valueType === "string") kval = String(ke.value);
            try { prop.setValueAtTime(ke.time + timeOffset, kval); } catch (e4) {}
          }
        } catch (e) {}
        continue;
      }
      if (pd.value === undefined || pd.value === null) continue;
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
    var effectsToApply = [];
    if (effectData.effects && effectData.effects.length > 0) {
      effectsToApply = effectData.effects;
    } else {
      var matchName = effectData.matchName || effectData.type;
      if (!matchName) return "Error: No effect matchName found.";
      effectsToApply = [{ matchName: matchName, props: effectData.props || [] }];
    }
    var count = 0;
    app.beginUndoGroup("DopeTool: Apply Effect");
    for (var i = 0; i < layers.length; i++) {
      try {
        for (var e = 0; e < effectsToApply.length; e++) {
          var mn = effectsToApply[e].matchName || effectsToApply[e].type;
          if (!mn) continue;
          var newFx = layers[i].property("Effects").addProperty(mn);
          if (newFx && effectsToApply[e].props && effectsToApply[e].props.length > 0) restoreEffectProps(newFx, effectsToApply[e].props);
        }
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

// ---- CAPTURE TEXT STYLE (full) ----
function captureTextStyle() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var layers = comp.selectedLayers;
    if (layers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = layers[0];
    if (!(layer instanceof TextLayer)) return JSON.stringify({ error: "Select a Text layer." });

    var td = layer.property("Source Text").value;

    var justStr = "LEFT";
    try {
      var j = td.justification;
      if (j === ParagraphJustification.CENTER_JUSTIFY) justStr = "CENTER";
      else if (j === ParagraphJustification.RIGHT_JUSTIFY) justStr = "RIGHT";
      else if (j === ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT) justStr = "FULL";
    } catch (e) {}

    var strokeColor = "000000";
    var strokeWidth = 0;
    try {
      if (td.applyStroke) {
        strokeColor = rgbToHexUpper(td.strokeColor).replace("#", "");
        strokeWidth = td.strokeWidth;
      }
    } catch (e) {}

    var autoLeading = true;
    var leading = 0;
    try { autoLeading = td.autoLeading; } catch (e) {}
    try { leading = td.leading; } catch (e) {}

    var baselineShift = 0;
    try { baselineShift = td.baselineShift; } catch (e) {}

    var fauxBold = false;
    var fauxItalic = false;
    try { fauxBold = td.fauxBold; } catch (e) {}
    try { fauxItalic = td.fauxItalic; } catch (e) {}

    var allCaps = false;
    var smallCaps = false;
    try { allCaps = td.allCaps; } catch (e) {}
    try { smallCaps = td.smallCaps; } catch (e) {}

    var effects = [];
    var effectsProp = layer.property("Effects");
    if (effectsProp) {
      for (var i = 1; i <= effectsProp.numProperties; i++) {
        try {
          var fx = effectsProp.property(i);
          effects.push({ name: fx.name, matchName: fx.matchName, props: captureEffectProps(fx, layer.inPoint) });
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
            if (style.enabled) {
              layerStyles.push({ name: style.name, matchName: style.matchName, props: captureEffectProps(style, layer.inPoint) });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return JSON.stringify({
      font: td.font,
      fontSize: Math.round(td.fontSize),
      size: Math.round(td.fontSize) + "px",
      color: rgbToHexUpper(td.fillColor),
      strokeColor: strokeColor,
      strokeWidth: strokeWidth,
      tracking: td.tracking,
      autoLeading: autoLeading,
      leading: leading,
      justification: justStr,
      baselineShift: baselineShift,
      fauxBold: fauxBold,
      fauxItalic: fauxItalic,
      allCaps: allCaps,
      smallCaps: smallCaps,
      effects: effects,
      layerStyles: layerStyles
    });
  } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

// ---- CAPTURE EFFECT ----

// ---- SRT CAPTION IMPORTER ----
function captureEffects() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var layers = comp.selectedLayers;
    if (layers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = layers[0];
    var effectsProp = layer.property("Effects");
    if (!effectsProp || effectsProp.numProperties === 0) return JSON.stringify({ error: "No effects on this layer." });
    var effectsArr = [];
    for (var i = 1; i <= effectsProp.numProperties; i++) {
      try {
        var fx = effectsProp.property(i);
        effectsArr.push({ name: fx.name, matchName: fx.matchName, props: captureEffectProps(fx) });
      } catch (e) {}
    }
    if (effectsArr.length === 0) return JSON.stringify({ error: "No effects on this layer." });
    return JSON.stringify({ name: effectsArr[0].name, effects: effectsArr });
  } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

function parseSRT(raw) {
  var out = [];
  var text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var blocks = text.split(/\n\n+/);
  for (var i = 0; i < blocks.length; i++) {
    var bl = blocks[i].replace(/^\s+|\s+$/g, "");
    if (!bl) continue;
    var lines = bl.split("\n");
    if (lines.length < 3) continue;
    var m = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) continue;
    var iS = +m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1e3;
    var oS = +m[5]*3600 + +m[6]*60 + +m[7] + +m[8]/1e3;
    var cl = [];
    for (var j = 2; j < lines.length; j++) {
      var l = lines[j].replace(/<[^>]+>/g, "").replace(/^\s+|\s+$/g, "");
      if (l) cl.push(l);
    }
    var txt = cl.join("\n");
    if (!txt) continue;
    out.push({ inSec: iS, outSec: oS, text: txt });
  }
  return out;
}

function h2f(h) {
  h = h.replace(/^#/, "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return [parseInt(h.substr(0,2),16)/255, parseInt(h.substr(2,2),16)/255, parseInt(h.substr(4,2),16)/255];
}

function lname(t) {
  var n = t.replace(/\n/g, " ").replace(/[\/\\:\*\?\"\<\>\|]/g, "_");
  return n.length > 60 ? n.substr(0, 60) + "\u2026" : n;
}

function importCaptions(cfgJson) {
  try {
    var cfg = JSON.parse(cfgJson);
    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) return "Error: Make a composition active first.";
    var srtFile = new File(cfg.srtPath);
    if (!srtFile.exists) return "Error: SRT file not found at: " + cfg.srtPath;
    srtFile.open("r");
    var raw = srtFile.read();
    srtFile.close();
    var entries = parseSRT(raw);
    if (!entries.length) return "Error: No valid SRT entries found.";
    var fps = comp.frameRate, W = comp.width, H = comp.height, dur = comp.duration;
    var fc = h2f(cfg.textColor || "FFFFFF");
    var sc = h2f(cfg.strokeColor || "000000");
    app.beginUndoGroup("DopeTool: Import Captions");
    var nl = null;
    if (cfg.useNull) { nl = comp.layers.addNull(dur); nl.name = "CAPTIONS_CTRL"; nl.label = 14; }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var iF = Math.round(e.inSec * fps);
      var oF = Math.min(Math.round(e.outSec * fps), Math.round(dur * fps) - 1);
      if (oF <= iF) oF = iF + 1;
      var tl = comp.layers.addText(e.text); // point text (not box text)
      tl.name = lname(e.text);
      tl.startTime = iF / fps;
      tl.outPoint = oF / fps;
      var doc = tl.property("Source Text").value;
      doc.resetCharStyle(); doc.resetParagraphStyle();
      doc.font = cfg.font || "Arial";
      doc.fontSize = cfg.fontSize || 72;
      doc.applyFill = true;
      doc.fillColor = fc;
      if (cfg.strokeWidth > 0) {
        doc.applyStroke = true; doc.strokeColor = sc;
        doc.strokeWidth = cfg.strokeWidth; doc.strokeOverFill = true;
      } else { doc.applyStroke = false; }
      if (cfg.tracking !== undefined) doc.tracking = cfg.tracking;
      doc.autoLeading = cfg.autoLeading !== false;
      if (!doc.autoLeading && cfg.leading) doc.leading = cfg.leading;
      doc.justification = ParagraphJustification.CENTER_JUSTIFY;
      tl.property("Source Text").setValue(doc);

      // Apply the saved style's effects (drop shadow, glow, gradient, etc.) so
      // captions match the picked text style — same behaviour as the Styles tab.
      if (cfg.effects && cfg.effects.length) {
        for (var ef = 0; ef < cfg.effects.length; ef++) {
          try {
            var mn = cfg.effects[ef].matchName;
            if (!mn) continue;
            var newFx = tl.property("Effects").addProperty(mn);
            if (newFx && cfg.effects[ef].props) restoreEffectProps(newFx, cfg.effects[ef].props, tl.inPoint);
          } catch (eFx) {}
        }
      }

      // Apply the saved style's layer styles too (drop shadow, stroke, glows, etc.)
      if (cfg.layerStyles && cfg.layerStyles.length) restoreLayerStyles(tl, cfg.layerStyles);

      var tr = tl.property("Transform");
      tr.property("Anchor Point").setValue([0, 0]);
      tr.property("Position").setValue([W / 2, H / 2 + (cfg.verticalOffset || 200)]);
      if (cfg.fadeFrames > 0) {
        var op = tr.property("Opacity"), fd = cfg.fadeFrames / fps;
        op.setValueAtTime(iF/fps, 0); op.setValueAtTime(iF/fps + fd, 100);
        op.setValueAtTime(oF/fps - fd, 100); op.setValueAtTime(oF/fps, 0);
        for (var k = 1; k <= op.numKeys; k++) {
          op.setTemporalEaseAtKey(k, [new KeyframeEase(0,33)], [new KeyframeEase(0,33)]);
        }
      }
      if (nl) tl.parent = nl;
    }
    app.endUndoGroup();
    return "ok:" + entries.length;
  } catch (e) { return "Error: " + e.toString(); }
}

function pickSrtFile() {
  try {
    var f = File.openDialog("Select SRT file", "SRT Files:*.srt,All Files:*.*");
    if (f) return f.fsName;
    return "";
  } catch (e) { return ""; }
}

// ---- FONT INSTALLATION HELPER ----
// Returns "installed" if font is found in AE, "missing" if not.
// NOTE: Assigning a non-existent font name to TextDocument.font does NOT throw
// in ExtendScript — AE silently keeps the previous font. So a try/catch around
// the assignment can never detect a missing font. We instead set the font,
// read it back, and confirm AE actually applied the requested name.
function checkFontInstalled(fontName) {
  var testComp = null;
  try {
    // AE 24+ exposes a Fonts API — use it when available for an exact lookup
    // that never touches the project.
    try {
      if (app.fonts && typeof app.fonts.getFontsByPostScriptName === "function") {
        var guessesApi = resolveFontName(fontName);
        for (var gi = 0; gi < guessesApi.length; gi++) {
          try {
            var matches = app.fonts.getFontsByPostScriptName(guessesApi[gi]);
            if (matches && matches.length > 0) return "installed";
          } catch (eApi) {}
        }
      }
    } catch (eApiOuter) {}

    // Fallback: apply-and-read-back detection.
    testComp = app.project.items.addComp("_DT_FONT_TEST", 100, 100, 1, 1, 24);
    var testLayer = testComp.layers.addText("test");
    var sourceTextProp = testLayer.property("Source Text");
    var guesses = resolveFontName(fontName);
    var found = false;

    for (var g = 0; g < guesses.length; g++) {
      try {
        var td = sourceTextProp.value;
        td.font = guesses[g];
        sourceTextProp.setValue(td);
        // Read back what AE actually applied. If the font is missing, AE keeps
        // the default and the applied name will NOT match our guess.
        var applied = sourceTextProp.value.font;
        if (applied && (applied === guesses[g] ||
            applied.replace(/\s/g, "") === guesses[g].replace(/\s/g, ""))) {
          found = true;
          break;
        }
      } catch (e) {}
    }

    return found ? "installed" : "missing";
  } catch (e) {
    return "missing";
  } finally {
    try { if (testComp) testComp.remove(); } catch (eFin) {}
  }
}

// ═══════════════════════════════════════════════════════════
// TOOLKIT — comp & layer utilities
// ═══════════════════════════════════════════════════════════

function _dtActiveComp() {
  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return null;
  return comp;
}

// On-screen bounding box of a 2D layer (ignores rotation).
function _dtLayerBounds(layer, t) {
  var tr = layer.property("Transform");
  var r = layer.sourceRectAtTime(t, false);
  var anchor = tr.property("Anchor Point").value;
  var pos = tr.property("Position").value;
  var scale = tr.property("Scale").value;
  var sx = scale[0] / 100, sy = scale[1] / 100;
  return {
    left: pos[0] + (r.left - anchor[0]) * sx,
    top: pos[1] + (r.top - anchor[1]) * sy,
    width: r.width * sx,
    height: r.height * sy,
    pos: pos
  };
}

// ---- REFRAME COMP ----
function _dtReframePos(prop, s, oldC, newC) {
  function map(v) {
    var nv = [newC[0] + (v[0] - oldC[0]) * s, newC[1] + (v[1] - oldC[1]) * s];
    if (v.length > 2) nv[2] = v[2];
    return nv;
  }
  if (prop.numKeys > 0) {
    for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtTime(prop.keyTime(k), map(prop.keyValue(k)));
  } else {
    prop.setValue(map(prop.value));
  }
}
function _dtReframeDim(prop, s, oldc, newc) {
  function map(v) { return newc + (v - oldc) * s; }
  if (prop.numKeys > 0) {
    for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtTime(prop.keyTime(k), map(prop.keyValue(k)));
  } else {
    prop.setValue(map(prop.value));
  }
}
function _dtScaleProp(prop, s) {
  function map(v) {
    var nv = [v[0] * s, v[1] * s];
    if (v.length > 2) nv[2] = v[2] * s;
    return nv;
  }
  if (prop.numKeys > 0) {
    for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtTime(prop.keyTime(k), map(prop.keyValue(k)));
  } else {
    prop.setValue(map(prop.value));
  }
}
function _dtReframeLayer(L, s, oldC, newC) {
  var tr = L.property("Transform");
  var posProp = tr.property("Position");
  if (posProp) {
    if (posProp.dimensionsSeparated) {
      _dtReframeDim(tr.property("X Position"), s, oldC[0], newC[0]);
      _dtReframeDim(tr.property("Y Position"), s, oldC[1], newC[1]);
    } else {
      _dtReframePos(posProp, s, oldC, newC);
    }
  }
  if (Math.abs(s - 1) > 1e-6) {
    var scProp = tr.property("Scale");
    if (scProp) _dtScaleProp(scProp, s);
  }
}
function reformatComp(newW, newH, mode) {
  try {
    var comp = _dtActiveComp();
    if (!comp) return "No active composition.";
    newW = Math.round(newW); newH = Math.round(newH);
    if (newW < 4 || newH < 4 || newW > 30000 || newH > 30000) return "Invalid target size.";
    var oldW = comp.width, oldH = comp.height;
    if (oldW === newW && oldH === newH) return "Comp is already " + newW + "×" + newH + ".";
    var s = 1;
    if (mode === "fit") s = Math.min(newW / oldW, newH / oldH);
    else if (mode === "fill") s = Math.max(newW / oldW, newH / oldH);
    var oldC = [oldW / 2, oldH / 2], newC = [newW / 2, newH / 2];
    app.beginUndoGroup("DopeTool: Reframe Comp");
    comp.width = newW;
    comp.height = newH;
    var count = 0;
    for (var i = 1; i <= comp.numLayers; i++) {
      var L = comp.layer(i);
      try {
        if (L.parent != null) continue; // children move with their parent
        _dtReframeLayer(L, s, oldC, newC);
        count++;
      } catch (e) {}
    }
    app.endUndoGroup();
    return "Reframed to " + newW + "×" + newH + " (" + count + " layer(s)).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- EXPRESSIONS ----
// Bounce/Wiggle read their settings from Expression Control effects that get
// added to the layer, so editors can tweak Amplitude/Frequency/etc. live in the
// Effect Controls panel (like the Bouncrr plugin). Fallbacks use fixed values
// if the layer can't be resolved.
var DT_EXPR = {
  wiggle: "wiggle(2, 30);",
  loop: "loopOut(\"cycle\");",
  bounce: "n = 0;\nif (numKeys > 0){ n = nearestKey(time).index; if (key(n).time > time) n--; }\nif (n > 0){ t = time - key(n).time; amp = .08; freq = 2.5; decay = 5.0; v = velocityAtTime(key(n).time - .001); value + v*amp*Math.sin(freq*t*2*Math.PI)/Math.exp(decay*t); } else { value }",
  wiggleControlled: "wiggle(effect(\"Wiggle Frequency\")(\"Slider\"), effect(\"Wiggle Amplitude\")(\"Slider\"));",
  bounceControlled: [
    "amp = effect(\"Bounce Amplitude\")(\"Slider\");",
    "freq = effect(\"Bounce Frequency\")(\"Slider\");",
    "decay = effect(\"Bounce Decay\")(\"Slider\");",
    "floorOn = effect(\"Bounce Floor\")(\"Checkbox\");",
    "n = 0;",
    "if (numKeys > 0){ n = nearestKey(time).index; if (key(n).time > time) n--; }",
    "if (n > 0){",
    "  t = time - key(n).time;",
    "  v = velocityAtTime(key(n).time - .001);",
    "  res = value + v * (amp/1000) * Math.sin(freq*t*2*Math.PI) / Math.exp(decay*t);",
    "} else { res = value; }",
    "if (floorOn == 1){",
    "  if (value.length){ out = []; for (k = 0; k < value.length; k++){ out[k] = Math.max(res[k], value[k]); } res = out; }",
    "  else { res = Math.max(res, value); }",
    "}",
    "res"
  ].join("\n")
};

// Walk up from a property to the layer that contains it.
function _dtLayerOfProp(prop) {
  try {
    var p = prop;
    while (p && p.parentProperty) p = p.parentProperty;
    return p;
  } catch (e) { return null; }
}

// Add (or reuse, by name) an Expression Control effect on a layer.
function _dtGetOrAddControl(layer, matchName, name, propName, defVal) {
  try {
    var fx = layer.property("Effects");
    if (!fx) return null;
    for (var i = 1; i <= fx.numProperties; i++) {
      if (fx.property(i).name === name) return fx.property(i); // already there — keep its value
    }
    var ctrl = fx.addProperty(matchName);
    try { ctrl.name = name; } catch (e1) {}
    if (propName) { try { ctrl.property(propName).setValue(defVal); } catch (e2) {} }
    return ctrl;
  } catch (e) { return null; }
}

function applyExpression(kind) {
  try {
    var comp = _dtActiveComp();
    if (!comp) return "No active composition.";
    var props = comp.selectedProperties;
    if (!props || props.length === 0) return "Select a property first (e.g. click 'Position').";
    var count = 0;
    app.beginUndoGroup("DopeTool: Expression");
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      try {
        if (!p.canSetExpression) continue;
        if (kind === "clear") { p.expression = ""; count++; continue; }

        var layer = _dtLayerOfProp(p);
        var expr;
        if (kind === "wiggle") {
          if (layer) {
            _dtGetOrAddControl(layer, "ADBE Slider Control", "Wiggle Frequency", "Slider", 2);
            _dtGetOrAddControl(layer, "ADBE Slider Control", "Wiggle Amplitude", "Slider", 30);
            expr = DT_EXPR.wiggleControlled;
          } else { expr = DT_EXPR.wiggle; }
        } else if (kind === "bounce") {
          if (layer) {
            _dtGetOrAddControl(layer, "ADBE Slider Control", "Bounce Amplitude", "Slider", 20);
            _dtGetOrAddControl(layer, "ADBE Slider Control", "Bounce Frequency", "Slider", 2);
            _dtGetOrAddControl(layer, "ADBE Slider Control", "Bounce Decay", "Slider", 4);
            _dtGetOrAddControl(layer, "ADBE Checkbox Control", "Bounce Floor", "Checkbox", 0);
            expr = DT_EXPR.bounceControlled;
          } else { expr = DT_EXPR.bounce; }
        } else {
          expr = DT_EXPR[kind] || "";
        }
        p.expression = expr;
        count++;
      } catch (e) {}
    }
    app.endUndoGroup();
    if (count === 0) return "Select an animatable property (like Position or Opacity).";
    if (kind === "clear") return "Cleared expression on " + count + " property(ies).";
    return "Applied " + kind + " to " + count + " property(ies) — tweak the sliders in Effect Controls.";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- ALIGN ----
function alignLayers(mode) {
  try {
    var comp = _dtActiveComp();
    if (!comp) return "No active composition.";
    var layers = comp.selectedLayers;
    if (!layers.length) return "No layer selected.";
    var t = comp.time, count = 0;
    app.beginUndoGroup("DopeTool: Align");
    for (var i = 0; i < layers.length; i++) {
      try {
        var L = layers[i];
        var posProp = L.property("Transform").property("Position");
        if (!posProp || posProp.numKeys > 0) continue; // don't wreck animated positions
        var b = _dtLayerBounds(L, t);
        var np = [b.pos[0], b.pos[1]];
        if (mode === "left") np[0] += (0 - b.left);
        else if (mode === "right") np[0] += (comp.width - (b.left + b.width));
        else if (mode === "hcenter") np[0] += (comp.width / 2 - (b.left + b.width / 2));
        else if (mode === "top") np[1] += (0 - b.top);
        else if (mode === "bottom") np[1] += (comp.height - (b.top + b.height));
        else if (mode === "vcenter") np[1] += (comp.height / 2 - (b.top + b.height / 2));
        if (b.pos.length > 2) np[2] = b.pos[2];
        posProp.setValue(np);
        count++;
      } catch (e) {}
    }
    app.endUndoGroup();
    return count ? "Aligned " + count + " layer(s)." : "No layers aligned (animated or unsupported).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ---- DISTRIBUTE ----
function distributeLayers(axis) {
  try {
    var comp = _dtActiveComp();
    if (!comp) return "No active composition.";
    var layers = comp.selectedLayers;
    if (layers.length < 3) return "Select 3+ layers to distribute.";
    var t = comp.time, arr = [];
    for (var i = 0; i < layers.length; i++) {
      try {
        var posProp = layers[i].property("Transform").property("Position");
        if (!posProp || posProp.numKeys > 0) continue;
        var b = _dtLayerBounds(layers[i], t);
        var center = (axis === "h") ? (b.left + b.width / 2) : (b.top + b.height / 2);
        arr.push({ layer: layers[i], pos: b.pos, center: center });
      } catch (e) {}
    }
    if (arr.length < 3) return "Need 3+ non-animated layers.";
    arr.sort(function (a, b) { return a.center - b.center; });
    var min = arr[0].center, max = arr[arr.length - 1].center;
    var step = (max - min) / (arr.length - 1);
    app.beginUndoGroup("DopeTool: Distribute");
    for (var j = 1; j < arr.length - 1; j++) {
      try {
        var it = arr[j];
        var target = min + step * j;
        var np = [it.pos[0], it.pos[1]];
        if (axis === "h") np[0] += (target - it.center);
        else np[1] += (target - it.center);
        if (it.pos.length > 2) np[2] = it.pos[2];
        it.layer.property("Transform").property("Position").setValue(np);
      } catch (e) {}
    }
    app.endUndoGroup();
    return "Distributed " + arr.length + " layer(s).";
  } catch (e) { return "Error: " + e.toString(); }
}

// ═══════════════════════════════════════════════════════════
// ASSETS — import images/videos/templates from the library
// ═══════════════════════════════════════════════════════════
function importAsset(path, addToComp) {
  try {
    var f = new File(path);
    if (!f.exists) return "Asset file not found: " + path;
    app.beginUndoGroup("DopeTool: Import Asset");
    var io = new ImportOptions(f);
    var item = app.project.importFile(io);
    var msg = "Imported: " + f.name;
    if (addToComp) {
      var comp = app.project.activeItem;
      if (comp && comp instanceof CompItem && item && (item instanceof FootageItem)) {
        var L = comp.layers.add(item);
        try { L.property("Transform").property("Position").setValue([comp.width / 2, comp.height / 2]); } catch (eP) {}
        msg = "Added " + f.name + " to comp.";
      } else if (!comp || !(comp instanceof CompItem)) {
        msg = "Imported " + f.name + " (open a comp to place it).";
      }
    }
    app.endUndoGroup();
    return msg;
  } catch (e) { return "Error: " + e.toString(); }
}
