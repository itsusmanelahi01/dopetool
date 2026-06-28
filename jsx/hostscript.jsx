// DopeTool hostscript.jsx — v2.3.1

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

      // ---- Clear existing effects before applying new ones ----
      clearAllEffects(layer);

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
          if (newFx && effects[ef].props) restoreEffectProps(newFx, effects[ef].props);
        } catch (e) {}
      }

      count++;
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
            if (vt === "number" || vt === "boolean" || vt === "string") { pd.value = val; pd.valueType = vt; }
            else if (val && val.length === 2) { pd.value = [val[0], val[1]]; pd.valueType = "array2"; }
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
            if (style.enabled) {
              layerStyles.push({ name: style.name, matchName: style.matchName, props: captureEffectProps(style) });
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

// ---- SRT CAPTION IMPORTER ----
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
      var tl = comp.layers.addBoxText([W * 0.9, H * 0.25], e.text);
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
