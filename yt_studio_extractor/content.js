// Inject the script to intercept requests
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected script
window.addEventListener("message", function(event) {
    if (event.source === window && event.data.type && event.data.type === "YT_ANALYTICS_DATA") {
        console.log("[YT Extractor] Received data in content script");
        chrome.storage.local.get(['yt_data'], function(result) {
            let list = result.yt_data || [];
            list.push(event.data.payload);
            chrome.storage.local.set({ "yt_data": list }, function() {
                console.log("[YT Extractor] Data appended to storage");
            });
        });
    }
});
