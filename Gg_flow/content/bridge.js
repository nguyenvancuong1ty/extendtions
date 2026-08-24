/**
 * Bridge Content Script - Chạy trên http://localhost và http://127.0.0.1
 * Chuyển tiếp tin nhắn giữa Web App Canvas Studio và Extension Background Worker (Bypass CORS)
 */

(function () {
  const WEB_APP_SOURCE = 'FLOW_CANVAS_APP';
  const EXTENSION_SOURCE = 'FLOW_EXTENSION_BRIDGE';

  // Báo hiệu cho Web App biết Extension Bridge đã sẵn sàng
  window.__FLOW_EXTENSION_BRIDGE_READY__ = true;
  window.postMessage({ source: EXTENSION_SOURCE, type: 'BRIDGE_READY' }, '*');

  // Lắng nghe lệnh từ Web App Canvas
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.source !== WEB_APP_SOURCE) {
      return;
    }

    const { requestId, action, payload } = event.data;

    try {
      // Chuyển tiếp tin nhắn đến Background Service Worker
      chrome.runtime.sendMessage(
        {
          type: 'CANVAS_PROXY_ACTION',
          action,
          payload,
          requestId,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            window.postMessage(
              {
                source: EXTENSION_SOURCE,
                requestId,
                success: false,
                error: chrome.runtime.lastError.message || 'Extension connection error',
              },
              '*'
            );
            return;
          }

          window.postMessage(
            {
              source: EXTENSION_SOURCE,
              requestId,
              ...response,
            },
            '*'
          );
        }
      );
    } catch (err) {
      window.postMessage(
        {
          source: EXTENSION_SOURCE,
          requestId,
          success: false,
          error: err.message,
        },
        '*'
      );
    }
  });

  console.log('⚡ [Flow Bridge] Connected to Web App Canvas Studio successfully!');
})();
