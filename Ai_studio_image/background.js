/**
 * Background Service Worker - AI Studio Image Generator & Sniffer
 */

let state = {
  capturedCount: 0,
  imagesCount: 0,
  lastUpdated: Date.now()
};

// AI Studio hiện gửi request sinh ảnh từ Web Worker. Hook fetch trong trang
// không nhìn thấy các request đó, vì vậy bắt request ở tầng extension.
const pendingImageRequests = new Map();
const networkTraceRequests = new Map();
const replayDebuggerSessions = new Map();

function isGenerationEndpoint(url) {
  if (!url || typeof url !== 'string') return false;
  if (/generatetitle|resolvedriveresource|submitbatchlog/i.test(url)) return false;
  return /(?:^|[\/$:.])(streamgeneratecontent|generatecontent|bidigeneratecontent)(?:$|[/?&:.])/i.test(url);
}

function decodeRequestBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.formData) return requestBody.formData;
  if (!Array.isArray(requestBody.raw)) return null;

  try {
    const chunks = requestBody.raw
      .filter((part) => part && part.bytes)
      .map((part) => new Uint8Array(part.bytes));
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    });
    const text = new TextDecoder('utf-8').decode(merged);
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  } catch (_) {
    return null;
  }
}

function sendWorkerTemplate(tabId, captured) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  chrome.tabs.sendMessage(tabId, {
    type: 'WORKER_IMAGE_REQUEST_CAPTURED',
    template: captured
  }).catch(() => {});
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== 'POST' || !isGenerationEndpoint(details.url)) return;
    pendingImageRequests.set(details.requestId, {
      url: details.url,
      method: details.method,
      headers: {},
      bodySample: decodeRequestBody(details.requestBody),
      capturedAt: Date.now(),
      source: 'webRequest'
    });
  },
  { urls: ['*://*.google.com/*', '*://*.googleapis.com/*', '*://*.clients6.google.com/*'] },
  ['requestBody']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const captured = pendingImageRequests.get(details.requestId);
    if (!captured) {
      if (/alkalimakersuite-pa\.clients6\.google\.com/i.test(details.url)) {
        const sessionHeaders = {};
        for (const header of details.requestHeaders || []) {
          if (!header?.name || typeof header.value !== 'string') continue;
          const name = header.name.toLowerCase();
          if (name === 'authorization' || name === 'x-aistudio-visit-id' || name === 'x-aistudio-g1-tier') {
            sessionHeaders[name] = header.value;
          }
        }
        if (sessionHeaders.authorization && Number.isInteger(details.tabId) && details.tabId >= 0) {
          chrome.tabs.sendMessage(details.tabId, {
            type: 'AI_STUDIO_AUTH_REFRESHED',
            headers: sessionHeaders,
            refreshedAt: Date.now()
          }).catch(() => {});
        }
      }
      return;
    }
    for (const header of details.requestHeaders || []) {
      if (header && header.name && typeof header.value === 'string') {
        captured.headers[header.name.toLowerCase()] = header.value;
      }
    }
    pendingImageRequests.delete(details.requestId);
    sendWorkerTemplate(details.tabId, captured);
  },
  { urls: ['*://*.google.com/*', '*://*.googleapis.com/*', '*://*.clients6.google.com/*'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => pendingImageRequests.delete(details.requestId),
  { urls: ['*://*.google.com/*', '*://*.googleapis.com/*', '*://*.clients6.google.com/*'] }
);

// Diagnostic recorder: capture the request as Chrome actually sends it, including
// Web Worker traffic that window.fetch hooks cannot observe. Response bodies are
// unavailable to webRequest, but status and response headers are correlated below.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    networkTraceRequests.set(details.requestId, {
      id: 'webreq_' + details.requestId + '_' + Date.now(),
      browserRequestId: details.requestId,
      type: 'webRequest',
      url: details.url,
      method: details.method,
      body: decodeRequestBody(details.requestBody),
      headers: {},
      timestamp: Date.now(),
      status: 'pending',
      isImageApi: isGenerationEndpoint(details.url)
    });
  },
  { urls: ['*://aistudio.google.com/*', '*://*.google.com/*', '*://*.googleapis.com/*', '*://*.clients6.google.com/*'] },
  ['requestBody']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const trace = networkTraceRequests.get(details.requestId);
    if (!trace) return;
    for (const header of details.requestHeaders || []) {
      if (header?.name && typeof header.value === 'string') {
        trace.headers[header.name.toLowerCase()] = header.value;
      }
    }
    if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
    chrome.tabs.sendMessage(details.tabId, {
      type: 'AI_STUDIO_NETWORK_TRACE', phase: 'request', trace
    }).catch(() => {});
  },
  { urls: ['*://aistudio.google.com/*', '*://*.google.com/*', '*://*.googleapis.com/*', '*://*.clients6.google.com/*'] },
  ['requestHeaders', 'extraHeaders']
);

function finishNetworkTrace(details, error) {
  const trace = networkTraceRequests.get(details.requestId);
  if (!trace) return;
  networkTraceRequests.delete(details.requestId);
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  chrome.tabs.sendMessage(details.tabId, {
    type: 'AI_STUDIO_NETWORK_TRACE',
    phase: 'complete',
    browserRequestId: details.requestId,
    status: details.statusCode || 0,
    statusLine: details.statusLine || '',
    error: error || '',
    responseHeaders: Object.fromEntries((details.responseHeaders || [])
      .filter((h) => h?.name && typeof h.value === 'string')
      .map((h) => [h.name.toLowerCase(), h.value])),
    completedAt: Date.now()
  }).catch(() => {});
}

chrome.webRequest.onCompleted.addListener(
  (details) => finishNetworkTrace(details, ''),
  { urls: ['*://aistudio.google.com/*', '*://*.google.com/*', '*://*.googleapis.com/*', '*://*.clients6.google.com/*'] },
  ['responseHeaders', 'extraHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => finishNetworkTrace(details, details.error || 'network error'),
  { urls: ['*://aistudio.google.com/*', '*://*.google.com/*', '*://*.googleapis.com/*', '*://*.clients6.google.com/*'] }
);

chrome.storage.local.get(['ai_studio_state'], (res) => {
  if (res.ai_studio_state) {
    state = { ...state, ...res.ai_studio_state };
  }
});

function saveState() {
  chrome.storage.local.set({ ai_studio_state: state });
}

// Lắng nghe messages từ content script hoặc popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PREPARE_REPLAY_COOKIE') {
    const tabId = sender.tab?.id;
    const cookie = message.cookie;
    if (!Number.isInteger(tabId) || !cookie) {
      sendResponse({ success: false, error: 'Missing tab or captured cookie' });
      return true;
    }
    const target = { tabId };
    const detach = () => {
      replayDebuggerSessions.delete(tabId);
      chrome.debugger.sendCommand(target, 'Fetch.disable').catch(() => {}).finally(() => {
        chrome.debugger.detach(target).catch(() => {});
      });
    };
    const session = { cookie, target, detach };
    replayDebuggerSessions.set(tabId, session);
    (async () => {
      try {
        if (!replayDebuggerSessions.has(tabId)) return;
        try { await chrome.debugger.detach(target); } catch (_) {}
        await chrome.debugger.attach(target, '1.3');
        await chrome.debugger.sendCommand(target, 'Fetch.enable', {
          patterns: [{ urlPattern: '*GenerateContent*', requestStage: 'Request' }]
        });
        setTimeout(() => { if (replayDebuggerSessions.get(tabId) === session) detach(); }, 30000);
        sendResponse({ success: true });
      } catch (error) {
        replayDebuggerSessions.delete(tabId);
        try { await chrome.debugger.detach(target); } catch (_) {}
        sendResponse({ success: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (message.type === 'BACKGROUND_DIRECT_FETCH') {
    const request = message.request || {};
    const allowedHeaders = {};
    for (const [name, value] of Object.entries(request.headers || {})) {
      const lower = name.toLowerCase();
      if (typeof value === 'string' && (
        lower === 'accept' || lower === 'authorization' ||
        lower === 'content-type' || lower === 'x-origin' ||
        lower.startsWith('x-goog-') || lower.startsWith('x-aistudio-')
      )) allowedHeaders[lower] = value;
    }
    if (!allowedHeaders['content-type']) allowedHeaders['content-type'] = 'application/json';

    fetch(request.url, {
      method: request.method || 'POST',
      headers: allowedHeaders,
      body: request.body,
      credentials: 'include'
    }).then(async (response) => {
      sendResponse({
        success: true,
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
        text: await response.text(),
        transport: 'extension-service-worker'
      });
    }).catch((error) => {
      sendResponse({ success: false, error: error?.message || String(error), transport: 'extension-service-worker' });
    });
    return true;
  }

  if (message.type === 'UPDATE_BADGE_COUNT') {
    const tabId = sender.tab ? sender.tab.id : null;
    const imgCount = message.imagesCount || 0;
    const reqCount = message.reqCount || 0;

    state.imagesCount = imgCount;
    state.capturedCount = reqCount;
    state.lastUpdated = Date.now();
    saveState();

    if (tabId) {
      const badgeText = imgCount > 0 ? `${imgCount}📷` : reqCount > 0 ? `${reqCount}` : '';
      chrome.action.setBadgeText({ text: badgeText, tabId });
      chrome.action.setBadgeBackgroundColor({
        color: imgCount > 0 ? '#10b981' : '#6366f1',
        tabId
      });
    }

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'DOWNLOAD_IMAGE') {
    const { dataUrl, filename } = message;
    if (!dataUrl) {
      sendResponse({ success: false, error: 'No dataUrl provided' });
      return true;
    }

    const cleanFilename = (filename || 'ai_studio_image_' + Date.now() + '.png')
      .replace(/[^a-zA-Z0-9_.-]/g, '_');

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: cleanFilename,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );
    return true;
  }

  if (message.type === 'OPEN_AI_STUDIO') {
    const targetUrl = message.url || 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-lite-image';
    chrome.tabs.create({ url: targetUrl });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_BACKGROUND_STATE') {
    sendResponse({ success: true, state });
    return true;
  }
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Fetch.requestPaused') return;
  const session = replayDebuggerSessions.get(source.tabId);
  if (!session) {
    chrome.debugger.sendCommand(source, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
    return;
  }
  const headers = Object.entries(params.request?.headers || {})
    .filter(([name]) => name.toLowerCase() !== 'cookie')
    .map(([name, value]) => ({ name, value: String(value) }));
  headers.push({ name: 'Cookie', value: session.cookie });
  chrome.tabs.sendMessage(source.tabId, {
    type: 'AI_STUDIO_DEBUGGER_TRACE',
    phase: 'intercepted',
    url: params.request?.url || '',
    cookieReplaced: true,
    headerCount: headers.length
  }).catch(() => {});
  chrome.debugger.sendCommand(source, 'Fetch.continueRequest', {
    requestId: params.requestId,
    headers
  }).catch((error) => {
    chrome.tabs.sendMessage(source.tabId, {
      type: 'AI_STUDIO_DEBUGGER_TRACE', phase: 'error',
      error: error?.message || String(error)
    }).catch(() => {});
  });
});

chrome.debugger.onDetach.addListener((source) => {
  replayDebuggerSessions.delete(source.tabId);
});

console.log('🚀 [Background Service Worker] AI Studio Image Generator Ready.');
