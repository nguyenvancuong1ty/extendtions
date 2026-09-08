(function() {
    console.log("[YT Extractor] Injected script loaded, hooking fetch & XHR...");

    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = args[0] && typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        
        const response = await origFetch.apply(this, args);
        
        if (url.includes('studio.youtube.com') || url.includes('youtubei/')) {
            if (url.includes('yta_web/get_screen') || url.includes('yta_web/get_cards')) {
                console.log(`[YT Extractor] Fetch intercepted: ${url}`);
                const clone = response.clone();
                clone.json().then(data => {
                    console.log(`[YT Extractor] Fetch data captured for analytics, sending to content script`);
                    window.postMessage({
                        type: "YT_ANALYTICS_DATA",
                        payload: { url: url, timestamp: new Date().toISOString(), data: data }
                    }, "*");
                }).catch(e => {});
            }
        }
        return response;
    };

    const origXHR = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && (url.includes('studio.youtube.com') || url.includes('youtubei/'))) {
            if (url.includes('yta_web/get_screen') || url.includes('yta_web/get_cards')) {
                console.log(`[YT Extractor] XHR analytics intercepted: ${url}`);
                this.addEventListener('load', function() {
                    console.log(`[YT Extractor] XHR analytics loaded: ${url}`);
                    try {
                        const data = JSON.parse(this.responseText);
                        console.log(`[YT Extractor] XHR data captured, sending to content script`);
                        window.postMessage({
                            type: "YT_ANALYTICS_DATA",
                            payload: { url: url, timestamp: new Date().toISOString(), data: data }
                        }, "*");
                    } catch(e) {}
                });
            }
        }
        origXHR.apply(this, arguments);
    };
})();
