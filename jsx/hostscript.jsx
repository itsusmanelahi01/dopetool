function testConnection() {
  return "Connected to AE version: " + app.version;
}

function hexToRgb(hex) {
  hex = hex.toString().replace(/#/g, "").replace(/\s/g, "");
  if (hex.length !== 6) return { rgb: [1, 1, 1], debug: "BAD LENGTH" };
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
        for (var j = 1; j <= contents.numProperties; j++) {
          var fillProp = findFillInGroup(contents.property(j));
          if (fillProp) { fillProp.setValue(rgb); appliedCount++; }
        }
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
        if (item.matchName === "ADBE Vector Graphic - Fill") return item.property("Color");
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
          try { textDocument.font = guesses[g]; textProp.setValue(textDocument); success = true; break; }
          catch (fontErr) { lastError = fontErr.toString(); }
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

// Capture all properties of an effect recursively
function captureEffectProps(effectProp) {
  var props = [];
  try {
    for (var i = 1; i <= effectProp.numProperties; i++) {
      try {
        var prop = effectProp.property(i);
        var propData = {
          name: prop.name,
          matchName: prop.matchName,
          type: prop.propertyType.toString()
        };
        if (prop.numProperties > 0) {
          propData.children = captureEffectProps(prop);
        } else {
          try {
            var val = prop.value;
            var valType = typeof val;
            if (valType === "number" || valType === "boolean" || valType === "string") {
              propData.value = val;
              propData.valueType = valType;
            } else if (val && val.length === 2) {
              propData.value = [val[0], val[1]];
              propData.valueType = "array2";
            } else if (val && val.length === 3) {
              propData.value = [val[0], val[1], val[2]];
              propData.valueType = "array3";
            } else if (val && val.length === 4) {
              propData.value = [val[0], val[1], val[2], val[3]];
              propData.valueType = "array4";
            }
          } catch (e) {}
        }
        props.push(propData);
      } catch (e) {}
    }
  } catch (e) {}
  return props;
}

// Restore all properties of an effect recursively
function restoreEffectProps(effectProp, props) {
  if (!props || props.length === 0) return;
  for (var i = 0; i < props.length; i++) {
    try {
      var propData = props[i];
      var prop = effectProp.property(propData.name);
      if (!prop) continue;
      if (propData.children && prop.numProperties > 0) {
        restoreEffectProps(prop, propData.children);
      } else if (propData.value !== undefined && prop.canSetValue) {
        try {
          if (propData.valueType === "array2") {
            prop.setValue([propData.value[0], propData.value[1]]);
          } else if (propData.valueType === "array3") {
            prop.setValue([propData.value[0], propData.value[1], propData.value[2]]);
          } else if (propData.valueType === "array4") {
            prop.setValue([propData.value[0], propData.value[1], propData.value[2], propData.value[3]]);
          } else {
            prop.setValue(propData.value);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
}

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

        // Apply effects with full property restore
        if (effects && effects.length > 0) {
          for (var ef = 0; ef < effects.length; ef++) {
            try {
              var newEffect = layer.property("Effects").addProperty(effects[ef].matchName);
              if (newEffect && effects[ef].props) {
                restoreEffectProps(newEffect, effects[ef].props);
              }
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

// Apply a saved effect entry (with full props) to selected layer
function applyEffectWithProps(effectJsonStr) {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return "No layer selected.";
    var effectData = JSON.parse(effectJsonStr);
    var appliedCount = 0;
    app.beginUndoGroup("DopeTool Apply Effect With Props");
    for (var i = 0; i < selectedLayers.length; i++) {
      try {
        var newEffect = selectedLayers[i].property("Effects").addProperty(effectData.matchName);
        if (newEffect && effectData.props) {
          restoreEffectProps(newEffect, effectData.props);
        }
        appliedCount++;
      } catch (e) {}
    }
    app.endUndoGroup();
    if (appliedCount === 0) return "Could not apply effect.";
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
      return JSON.stringify({ hex: rgbToHexUpper(layer.property("Source Text").value.fillColor) });
    } else if (layer instanceof ShapeLayer) {
      var contents = layer.property("Contents");
      for (var j = 1; j <= contents.numProperties; j++) {
        var fillProp = findFillInGroup(contents.property(j));
        if (fillProp) return JSON.stringify({ hex: rgbToHexUpper(fillProp.value) });
      }
      return JSON.stringify({ error: "No fill found." });
    }
    return JSON.stringify({ error: "Select a Text or Shape layer." });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

function captureTextStyle() {
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return JSON.stringify({ error: "No active composition." });
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return JSON.stringify({ error: "No layer selected." });
    var layer = selectedLayers[0];
    if (!(layer instanceof TextLayer)) return JSON.stringify({ error: "Select a Text layer." });

    var textDocument = layer.property("Source Text").value;

    // Capture all effects with full property values
    var effects = [];
    var effectsProp = layer.property("Effects");
    if (effectsProp) {
      for (var i = 1; i <= effectsProp.numProperties; i++) {
        try {
          var fx = effectsProp.property(i);
          effects.push({
            name: fx.name,
            matchName: fx.matchName,
            props: captureEffectProps(fx)
          });
        } catch (e) {}
      }
    }

    // Capture layer styles
    var layerStyles = [];
    try {
      var stylesProp = layer.property("Layer Styles");
      if (stylesProp) {
        for (var s = 1; s <= stylesProp.numProperties; s++) {
          try {
            var style = stylesProp.property(s);
            if (style.enabled) {
              layerStyles.push({
                name: style.name,
                matchName: style.matchName,
                props: captureEffectProps(style)
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return JSON.stringify({
      font: textDocument.font,
      size: Math.round(textDocument.fontSize) + "px",
      color: rgbToHexUpper(textDocument.fillColor),
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

// Capture effect with full property values
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
    return JSON.stringify({
      name: firstEffect.name,
      type: firstEffect.matchName,
      matchName: firstEffect.matchName,
      props: captureEffectProps(firstEffect)
    });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}
