/**
 * CSInterface - v8.0.0
 * Adobe CEP JavaScript Interface Library
 */

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    EXTENSION_DATA: "extensionData",
    HOST_APPLICATION: "hostApplication"
};

var ColorType = {
    RGB: "rgb",
    NONE: "none"
};

var RGBColor = function(red, green, blue, alpha) {
    this.red = red;
    this.green = green;
    this.blue = blue;
    this.alpha = alpha;
};

var Direction = {
    TOP: "top",
    BOTTOM: "bottom",
    LEFT: "left",
    RIGHT: "right"
};

var GradientColor = function(type, direction, numStops, rgbArray) {
    this.type = type;
    this.direction = direction;
    this.numStops = numStops;
    this.rgbArray = rgbArray;
};

var UIColor = function(type, antialiasLevel, color) {
    this.type = type;
    this.antialiasLevel = antialiasLevel;
    this.color = color;
};

var AppSkinInfo = function(baseFontFamily, baseFontSize, appBarBackgroundColor, panelBackgroundColor, systemHighlightColor, isDark) {
    this.baseFontFamily = baseFontFamily;
    this.baseFontSize = baseFontSize;
    this.appBarBackgroundColor = appBarBackgroundColor;
    this.panelBackgroundColor = panelBackgroundColor;
    this.systemHighlightColor = systemHighlightColor;
    this.isDark = isDark;
};

var HostEnvironment = function(appName, appVersion, appLocale, appUILocale, appId, isAppOnline, appSkinInfo) {
    this.appName = appName;
    this.appVersion = appVersion;
    this.appLocale = appLocale;
    this.appUILocale = appUILocale;
    this.appId = appId;
    this.isAppOnline = isAppOnline;
    this.appSkinInfo = appSkinInfo;
};

var HostCapabilities = function(EXTENDED_PANEL_MENU, EXTENDED_PANEL_ICONS, DELEGATE_APE_ENGINE, SUPPORT_HTML_EXTENSIONS, DISABLE_FLASH_EXTENSIONS) {
    this.EXTENDED_PANEL_MENU = EXTENDED_PANEL_MENU;
    this.EXTENDED_PANEL_ICONS = EXTENDED_PANEL_ICONS;
    this.DELEGATE_APE_ENGINE = DELEGATE_APE_ENGINE;
    this.SUPPORT_HTML_EXTENSIONS = SUPPORT_HTML_EXTENSIONS;
    this.DISABLE_FLASH_EXTENSIONS = DISABLE_FLASH_EXTENSIONS;
};

var ApiVersion = function(major, minor, micro) {
    this.major = major;
    this.minor = minor;
    this.micro = micro;
};

var CSEvent = function(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope;
    this.appId = appId;
    this.extensionId = extensionId;
};

CSEvent.prototype.data = "";

var THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

var UNKNOWN_VERSION = "UNKNOWN";

var CSInterface = function() {

    this.getHostEnvironment = function() {
        return JSON.parse(window.__adobe_cep__.getHostEnvironment());
    };

    this.closeExtension = function() {
        window.__adobe_cep__.closeExtension();
    };

    this.getSystemPath = function(pathType) {
        var path = decodeURIComponent(window.__adobe_cep__.getSystemPath(pathType));
        var OSVersion = this.getOSInformation();
        if (OSVersion.indexOf("Windows") >= 0) {
            path = path.replace("file:///", "");
        } else if (OSVersion.indexOf("Mac") >= 0) {
            path = path.replace("file://", "");
        }
        return path;
    };

    this.evalScript = function(script, callback) {
        if (callback === null || callback === undefined) {
            callback = function(result) {};
        }
        window.__adobe_cep__.evalScript(script, callback);
    };

    this.getApplicationID = function() {
        var hostEnvironment = this.getHostEnvironment();
        return hostEnvironment.appId;
    };

    this.getHostCapabilities = function() {
        var hostCapabilities = JSON.parse(window.__adobe_cep__.getHostCapabilities());
        return hostCapabilities;
    };

    this.dispatchEvent = function(event) {
        if (typeof event.data == "object") {
            event.data = JSON.stringify(event.data);
        }
        window.__adobe_cep__.dispatchEvent(event);
    };

    this.addEventListener = function(type, listener, obj) {
        window.__adobe_cep__.addEventListener(type, listener, obj);
    };

    this.removeEventListener = function(type, listener, obj) {
        window.__adobe_cep__.removeEventListener(type, listener, obj);
    };

    this.requestOpenExtension = function(extensionId, params) {
        window.__adobe_cep__.requestOpenExtension(extensionId, params);
    };

    this.getExtensions = function(extensionIds) {
        var extensionIdsStr = JSON.stringify(extensionIds);
        var extensionsStr = window.__adobe_cep__.getExtensions(extensionIdsStr);
        var extensions = JSON.parse(extensionsStr);
        return extensions;
    };

    this.getNetworkPreferences = function() {
        var result = window.__adobe_cep__.getNetworkPreferences();
        var networkPre = JSON.parse(result);
        return networkPre;
    };

    this.initResourceBundle = function() {
        var resourceBundle = {};
        try {
            var locale = this.getHostEnvironment().appUILocale;
            var bundlePath = this.getSystemPath(SystemPath.EXTENSION) + "/locale/" + locale + "/messages.properties";
            resourceBundle = this._readResourceBundle(bundlePath);
        } catch (e) {}
        return resourceBundle;
    };

    this.dumpInstallationInfo = function() {
        return window.__adobe_cep__.dumpInstallationInfo();
    };

    this.getOSInformation = function() {
        var userAgent = navigator.userAgent;
        if (navigator.platform == "Win32" || navigator.platform == "Windows") {
            var winVersion = "Windows";
            if (userAgent.indexOf("Windows NT 5.0") >= 0) {
                winVersion = "Windows 2000";
            } else if (userAgent.indexOf("Windows NT 5.1") >= 0) {
                winVersion = "Windows XP";
            } else if (userAgent.indexOf("Windows NT 5.2") >= 0) {
                winVersion = "Windows Server 2003";
            } else if (userAgent.indexOf("Windows NT 6.0") >= 0) {
                winVersion = "Windows Vista";
            } else if (userAgent.indexOf("Windows NT 6.1") >= 0) {
                winVersion = "Windows 7";
            } else if (userAgent.indexOf("Windows NT 6.2") >= 0) {
                winVersion = "Windows 8";
            } else if (userAgent.indexOf("Windows NT 6.3") >= 0) {
                winVersion = "Windows 8.1";
            } else if (userAgent.indexOf("Windows NT 10") >= 0) {
                winVersion = "Windows 10";
            }
            return winVersion;
        } else if (navigator.platform == "MacIntel" || navigator.platform == "Macintosh") {
            var macVersion = "Mac OS X";
            var verArr = userAgent.match(/Mac OS X (10[._\d]+)/i);
            if (verArr && verArr.length >= 2) {
                macVersion = "Mac OS X " + verArr[1];
            }
            return macVersion;
        }
        return "Unknown";
    };

    this.openURLInDefaultBrowser = function(url) {
        if (window.cep) {
            window.cep.util.openURLInDefaultBrowser(url);
        }
    };

    this.getExtensionID = function() {
        return window.__adobe_cep__.getExtensionId();
    };

    this.getScaleFactor = function() {
        return window.__adobe_cep__.getScaleFactor();
    };

    this.setScaleFactorChangedHandler = function(handler) {
        window.__adobe_cep__.setScaleFactorChangedHandler(handler);
    };

    this.getCurrentApiVersion = function() {
        var apiVersion = JSON.parse(window.__adobe_cep__.getCurrentApiVersion());
        return apiVersion;
    };

    this.setPanelFlyoutMenu = function(menu) {
        if ("string" == typeof menu) {
            window.__adobe_cep__.setPanelFlyoutMenu(menu);
        }
    };

    this.updatePanelMenuItem = function(menuItemLabel, isEnabled, isChecked) {
        var ret = false;
        if (this.getHostCapabilities().EXTENDED_PANEL_MENU) {
            var itemStatus = new MenuItemStatus(menuItemLabel, isEnabled, isChecked);
            ret = window.__adobe_cep__.updatePanelMenuItem(JSON.stringify(itemStatus));
        }
        return ret;
    };

    this.setContextMenu = function(menu, callback) {
        if ("string" == typeof menu) {
            window.__adobe_cep__.setContextMenu(menu, callback);
        }
    };

    this.setContextMenuByJSON = function(menu, callback) {
        if ("string" == typeof menu) {
            window.__adobe_cep__.setContextMenuByJSON(menu, callback);
        }
    };

    this.updateContextMenuItem = function(menuItemID, isEnabled, isChecked) {
        var itemStatus = new ContextMenuItemStatus(menuItemID, isEnabled, isChecked);
        window.__adobe_cep__.updateContextMenuItem(JSON.stringify(itemStatus));
    };

    this.isEventSupported = function(eventType, requiredScope) {
        return true;
    };

    this.getExtensionData = function(extensionId) {
        return window.__adobe_cep__.getExtensionData(extensionId);
    };

    this.getRemoteExtensions = function(url) {
        return JSON.parse(window.__adobe_cep__.getRemoteExtensions(url));
    };

    this.setWindowTitle = function(title) {
        window.__adobe_cep__.invokeAsync("setWindowTitle", title);
    };

    this.getWindowTitle = function() {
        return window.__adobe_cep__.invokeSync("getWindowTitle", "");
    };

};
