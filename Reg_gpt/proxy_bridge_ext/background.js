import { DEFAULT_PROXY_CONFIG } from "./config.js";

let activeConfig = { ...DEFAULT_PROXY_CONFIG };

/**
 * Loads configuration from storage if available, falling back to default config.
 */
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get("proxyConfig");
    if (result && result.proxyConfig) {
      activeConfig = { ...DEFAULT_PROXY_CONFIG, ...result.proxyConfig };
    } else {
      activeConfig = { ...DEFAULT_PROXY_CONFIG };
    }
  } catch (err) {
    console.warn("[ProxyBridge] Failed to load config from storage, using defaults:", err);
    activeConfig = { ...DEFAULT_PROXY_CONFIG };
  }
}

/**
 * Applies the current proxy settings to Chrome.
 */
function applyProxySettings() {
  if (!activeConfig.enabled) {
    chrome.proxy.settings.set(
      { value: { mode: "direct" }, scope: "regular" },
      () => {
        if (chrome.runtime.lastError) {
          console.error("[ProxyBridge] Error disabling proxy:", chrome.runtime.lastError.message);
        } else {
          console.log("[ProxyBridge] Proxy disabled (Direct mode)");
        }
      }
    );
    return;
  }

  const scheme = (activeConfig.scheme || "http").toLowerCase();
  const host = activeConfig.host;
  const port = parseInt(activeConfig.port, 10);
  const bypassList = Array.isArray(activeConfig.bypassList)
    ? activeConfig.bypassList
    : ["localhost", "127.0.0.1", "<local>"];

  const proxyRules = {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: scheme,
        host: host,
        port: port
      },
      bypassList: bypassList
    }
  };

  chrome.proxy.settings.set(
    { value: proxyRules, scope: "regular" },
    () => {
      if (chrome.runtime.lastError) {
        console.error("[ProxyBridge] Error applying proxy settings:", chrome.runtime.lastError.message);
      } else {
        console.log(`[ProxyBridge] Proxy active: ${scheme}://${host}:${port}`);
      }
    }
  );
}

/**
 * Initializes the extension settings and listeners.
 */
async function initialize() {
  await loadConfig();
  applyProxySettings();
}

// 1. Handle Proxy Authentication (webRequestAuthProvider)
chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    // Only handle authentication if requested by the proxy server
    if (details.isProxy && activeConfig.enabled && activeConfig.username) {
      console.log(`[ProxyBridge] Supplying proxy auth credentials for realm/host: ${details.challenger?.host || "proxy"}`);
      return {
        authCredentials: {
          username: activeConfig.username,
          password: activeConfig.password || ""
        }
      };
    }
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// 2. Lifecycle hooks
chrome.runtime.onInstalled.addListener(() => {
  console.log("[ProxyBridge] Extension installed/updated.");
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[ProxyBridge] Browser startup.");
  initialize();
});

// 3. React to runtime storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.proxyConfig) {
    console.log("[ProxyBridge] Configuration updated via storage.");
    activeConfig = { ...DEFAULT_PROXY_CONFIG, ...changes.proxyConfig.newValue };
    applyProxySettings();
  }
});

// 4. Handle runtime messages for dynamic reconfiguration
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SET_PROXY") {
    activeConfig = { ...activeConfig, ...message.config };
    chrome.storage.local.set({ proxyConfig: activeConfig }, () => {
      applyProxySettings();
      sendResponse({ status: "success", config: activeConfig });
    });
    return true; // Keep channel open for async response
  } else if (message?.type === "GET_PROXY") {
    sendResponse({ status: "success", config: activeConfig });
    return false;
  }
});

// Initialize on service worker boot
initialize();
