/**
 * Background Service Worker - Google Labs Flow API Bridge (V2.1 Full In-Tab Routing)
 */

let authState = {
  token: '',
  projectId: '',
  user: null,
  lastUpdated: 0,
  recaptchaToken: '',
  lastCapturedHeaders: {},
};

chrome.storage.local.get(['flow_auth_state'], (res) => {
  if (res.flow_auth_state) {
    authState = { ...authState, ...res.flow_auth_state };
  }
});

function saveAuthState() {
  chrome.storage.local.set({ flow_auth_state: authState });
}

async function getActiveFlowTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
    if (tabs && tabs.length > 0) {
      return tabs[0];
    }
  } catch (e) {
    console.warn('[Bridge] Lỗi tìm tab Google Flow:', e);
  }
  return null;
}

// -------------------------------------------------------------
// 1. Lắng nghe cập nhật Token từ content.js trên labs.google
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_BADGE_COUNT') {
    const count = message.count || 0;
    const tabId = sender.tab ? sender.tab.id : null;

    if (count > 0 && tabId) {
      chrome.action.setBadgeText({ text: String(count > 99 ? '99+' : count), tabId });
      chrome.action.setBadgeBackgroundColor({
        color: message.videoCount > 0 ? '#8b5cf6' : message.projectCount > 0 ? '#10b981' : '#3b82f6',
        tabId,
      });
    }

    if (message.latestRequest) {
      const req = message.latestRequest;
      if (req.headers) {
        authState.lastCapturedHeaders = { ...req.headers };
        if (req.headers['authorization']) {
          const rawAuth = req.headers['authorization'];
          authState.token = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7) : rawAuth;
          authState.lastUpdated = Date.now();
        }
      }

      if (req.body) {
        if (req.body.clientContext?.projectId) authState.projectId = req.body.clientContext.projectId;
        else if (req.body.projectId) authState.projectId = req.body.projectId;
        else if (req.body.json?.projectId) authState.projectId = req.body.json.projectId;

        if (req.body.clientContext?.recaptchaContext?.token) {
          authState.recaptchaToken = req.body.clientContext.recaptchaContext.token;
        }
      }

      if (req.response?.result?.data?.json?.result?.projectId) {
        authState.projectId = req.response.result.data.json.result.projectId;
      }

      saveAuthState();
    }

    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'UPDATE_RECAPTCHA_TOKEN') {
    if (message.token) {
      authState.recaptchaToken = message.token;
      authState.lastUpdated = Date.now();
      saveAuthState();
      console.log('🔑 [Background] Đã lưu reCAPTCHA Token độ dài:', message.token.length);
    }
    sendResponse({ received: true });
    return true;
  }

  // -------------------------------------------------------------
  // 2. Xử lý Proxy Actions từ Web App Canvas Studio
  // -------------------------------------------------------------
  if (message.type === 'CANVAS_PROXY_ACTION') {
    handleCanvasAction(message.action, message.payload, message.requestId)
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: err.message || String(err),
          status: err.status || 0,
          rawResponse: err.rawResponse ? String(err.rawResponse).substring(0, 1000) : null,
          url: err.url || '',
        });
      });
    return true;
  }
});

// -------------------------------------------------------------
// 3. Xử lý logic từng Action
// -------------------------------------------------------------
async function handleCanvasAction(action, payload = {}, requestId = '') {
  switch (action) {
    case 'PING':
      return { status: 'ok', version: '2.1.0', timestamp: Date.now() };

    case 'GET_SESSION':
      return {
        isConnected: Boolean(authState.token),
        hasToken: Boolean(authState.token),
        tokenPreview: authState.token ? `${authState.token.substring(0, 15)}...${authState.token.slice(-6)}` : null,
        fullToken: authState.token || '',
        hasRecaptchaToken: Boolean(authState.recaptchaToken),
        recaptchaPreview: authState.recaptchaToken ? `${authState.recaptchaToken.substring(0, 15)}...` : null,
        fullRecaptchaToken: authState.recaptchaToken || '',
        projectId: authState.projectId || null,
        lastUpdated: authState.lastUpdated,
      };

    case 'SET_TOKEN':
      if (payload.token) {
        authState.token = payload.token.startsWith('Bearer ') ? payload.token.slice(7) : payload.token;
        authState.lastUpdated = Date.now();
      }
      if (payload.projectId) {
        authState.projectId = payload.projectId;
      }
      if (payload.recaptchaToken) {
        authState.recaptchaToken = payload.recaptchaToken;
      }
      saveAuthState();
      return { success: true, authState };

    case 'GENERATE_VIDEO': {
      const flowTab = await getActiveFlowTab();
      if (!flowTab) {
        throw new Error(
          'Không tìm thấy tab Google Flow đang mở! Vui lòng mở sẵn 1 tab https://labs.google/fx/tools/flow.'
        );
      }

      const activeRecaptcha = payload.recaptchaToken || authState.recaptchaToken || '';

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          flowTab.id,
          {
            type: 'EXECUTE_IN_TAB',
            action: 'GENERATE_VIDEO',
            payload: {
              ...payload,
              recaptchaToken: activeRecaptcha,
            },
            token: authState.token,
            recaptchaToken: activeRecaptcha,
            requestId: requestId || `req_gen_${Date.now()}`,
          },
          (res) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(`Lỗi kết nối tab Google Flow: ${chrome.runtime.lastError.message}`));
            }
            if (res && res.success) {
              resolve(res.data);
            } else {
              const err = new Error(res?.error || 'Lỗi không xác định khi tạo video trong tab');
              err.status = res?.status || 0;
              err.rawResponse = res?.rawResponse || null;
              err.url = res?.url || '';
              reject(err);
            }
          }
        );
      });
    }

    case 'CHECK_STATUS': {
      const flowTab = await getActiveFlowTab();
      if (!flowTab) {
        throw new Error(
          'Không tìm thấy tab Google Flow đang mở! Vui lòng giữ 1 tab https://labs.google/fx/tools/flow mở để kiểm tra tiến độ video.'
        );
      }

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          flowTab.id,
          {
            type: 'EXECUTE_IN_TAB',
            action: 'CHECK_STATUS',
            payload,
            token: authState.token,
            requestId: requestId || `req_status_${Date.now()}`,
          },
          (res) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(`Lỗi kết nối tab Google Flow: ${chrome.runtime.lastError.message}`));
            }
            if (res && res.success) {
              resolve(res.data);
            } else {
              const err = new Error(res?.error || 'Lỗi kiểm tra tiến độ trong tab Google Flow');
              err.status = res?.status || 0;
              err.rawResponse = res?.rawResponse || null;
              err.url = res?.url || '';
              reject(err);
            }
          }
        );
      });
    }

    case 'DOWNLOAD_MEDIA': {
      const flowTab = await getActiveFlowTab();
      if (!flowTab) {
        throw new Error('Vui lòng mở tab https://labs.google/fx/tools/flow để tải file MP4.');
      }

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          flowTab.id,
          {
            type: 'EXECUTE_IN_TAB',
            action: 'DOWNLOAD_MEDIA',
            payload,
            token: authState.token,
            requestId: requestId || `req_dl_${Date.now()}`,
          },
          (res) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(`Lỗi kết nối tab Google Flow: ${chrome.runtime.lastError.message}`));
            }
            if (res && res.success) {
              resolve(res.data);
            } else {
              reject(new Error(res?.error || 'Lỗi tải video từ Google Flow'));
            }
          }
        );
      });
    }

    case 'GET_VIDEO_DATA': {
      const flowTab = await getActiveFlowTab();
      if (!flowTab) {
        throw new Error('Vui lòng mở tab https://labs.google/fx/tools/flow để tải data video.');
      }

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          flowTab.id,
          {
            type: 'EXECUTE_IN_TAB',
            action: 'GET_VIDEO_DATA',
            payload,
            token: authState.token,
            requestId: requestId || `req_getvid_${Date.now()}`,
          },
          (res) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(`Lỗi kết nối tab Google Flow: ${chrome.runtime.lastError.message}`));
            }
            if (res && res.success) {
              resolve(res.data);
            } else {
              reject(new Error(res?.error || 'Lỗi lấy data video'));
            }
          }
        );
      });
    }

    default:
      throw new Error(`Action không hợp lệ: ${action}`);
  }
}
