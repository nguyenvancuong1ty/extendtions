# Proxy Bridge Chrome Extension (Manifest V3)

A lightweight Chromium extension that handles HTTP, HTTPS, SOCKS4, and SOCKS5 proxy routing and automated proxy authentication using `chrome.proxy.settings` and `chrome.webRequest.onAuthRequired`.

---

## 📁 Directory Structure

```
proxy_bridge_ext/
├── manifest.json         # Manifest V3 definition with proxy and webRequest permissions
├── background.js        # Background service worker configuring proxy and auth credentials
├── config.js            # Configuration module (scheme, host, port, credentials, bypass list)
├── config.sample.json   # Sample JSON config for reference or programmatic generation
└── README.md            # Documentation and usage guide
```

---

## ⚙️ Configuration (`config.js`)

Edit [`config.js`](file:///D:/Extendtions/Reg_gpt/proxy_bridge_ext/config.js) to set your proxy server and authentication details:

```javascript
export const DEFAULT_PROXY_CONFIG = {
  enabled: true,
  scheme: "http",              // "http", "https", "socks4", or "socks5"
  host: "proxy.example.com",   // Proxy host or IP address
  port: 8080,                  // Proxy port (number)
  username: "your_username",   // Proxy auth username
  password: "your_password",   // Proxy auth password
  bypassList: [
    "localhost",
    "127.0.0.1",
    "<local>"
  ]
};
```

---

## 🚀 Usage

### 1. Manual Loading in Google Chrome / Chromium
1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the [`proxy_bridge_ext`](file:///D:/Extendtions/Reg_gpt/proxy_bridge_ext) folder.
4. The extension will automatically apply the proxy settings and handle any proxy authentication prompts silently in the background.

### 2. Loading with Playwright (Python / Node.js)
Because standard Chromium headless mode doesn't load extensions, launch persistent context in non-headless mode (or `--headless=new`):

```python
from playwright.sync_api import sync_playwright
import os

extension_path = os.path.abspath("./proxy_bridge_ext")

with sync_playwright() as p:
    browser = p.chromium.launch_persistent_context(
        user_data_dir="./user_data",
        headless=False,
        args=[
            f"--disable-extensions-except={extension_path}",
            f"--load-extension={extension_path}",
        ],
    )
    page = browser.new_page()
    page.goto("https://httpbin.org/ip")
    print(page.content())
    browser.close()
```

---

## 🔒 Key Permissions Explained
- `proxy`: Grants access to `chrome.proxy.settings` to configure system/regular scope proxy rules.
- `webRequest`: Required to monitor network requests.
- `webRequestAuthProvider`: Allows synchronous blocking responses on `chrome.webRequest.onAuthRequired` in Manifest V3 to provide `authCredentials` without displaying an authentication popup.
- `<all_urls>`: Host permissions required for `onAuthRequired` interception across target domains.
