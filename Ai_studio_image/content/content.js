/**
 * Content Script - Google AI Studio Image Generator & Sniffer
 * Kiến trúc: Bắt Request thật của người dùng -> Lưu Auth & Request Template -> Gọi trực tiếp (Direct Replay)
 * KHÔNG tự động gõ vào chatbox DOM, Hỗ trợ xoay vòng nhiều tài khoản Google
 */
(function () {
  const SENDER_ID = 'AI_STUDIO_IMAGE_SNIFFER';
  const EXECUTOR_TARGET = 'AI_STUDIO_TAB_EXECUTOR';
  const RESPONSE_TARGET = 'AI_STUDIO_TAB_EXECUTOR_RESPONSE';

    // Hàm kiểm tra endpoint sinh ảnh chuẩn
  function isTrueImageEndpoint(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();

    // 1. Loại bỏ các endpoint chắc chắn không tạo ảnh
    if (u.includes('generatetitle') || u.includes('resolvedriveresource') || u.includes('submitbatchlog')) {
      return false;
    }

    return /(?:^|[\/$:.])(streamgeneratecontent|generatecontent|bidigeneratecontent)(?:$|[/?&:.])/i.test(url);
  }

  let capturedRequests = [];
  let capturedImages = [];
  let savedAccountTemplates = []; // Danh sách các tài khoản có Request Template & Auth
  let currentKeyIndex = 0;
  let selectedRequestId = null;
  let isPanelOpen = false;
  let activeTab = 'batch';
  let lastPersistedTemplateSignature = '';
  let lastAuthRefreshLogAt = 0;

  let isBatchRunning = false;
  let shouldStopBatch = false;
  let currentBatchStartTime = 0;
  let lastNativeGeneratedImages = [];

  // 1. Inject injected.js vào MAIN World
  function injectMainScript() {
    if (document.getElementById('ai-studio-injected-script')) return;
    try {
      const script = document.createElement('script');
      script.id = 'ai-studio-injected-script';
      script.src = chrome.runtime.getURL('injected/injected.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error('[AI Studio Content] Failed to inject main script:', e);
    }
  }

  injectMainScript();

  // Đọc dữ liệu từ chrome.storage
  chrome.storage.local.get(['ai_studio_requests', 'ai_studio_images', 'ai_studio_account_templates'], (res) => {
    if (res.ai_studio_requests && Array.isArray(res.ai_studio_requests)) {
      capturedRequests = res.ai_studio_requests;
    }
    if (res.ai_studio_images && Array.isArray(res.ai_studio_images)) {
      capturedImages = res.ai_studio_images;
    }
    if (res.ai_studio_account_templates && Array.isArray(res.ai_studio_account_templates)) {
      // Chỉ giữ các template đúng chuẩn endpoint tạo ảnh
      savedAccountTemplates = res.ai_studio_account_templates.filter(a => {
        return a.template?.url && isTrueImageEndpoint(a.template.url);
      });
    }

    // A completed native HTTP 2xx trace is the strongest source of truth. Restore
    // the exact headers/body from it so a later unrelated RPC cannot leave the
    // persisted template with a different SAPISIDHASH value.
    const latestSuccessfulNative = capturedRequests.find((request) =>
      request.captureMode === 'native-ai-studio' &&
      request.isImageApi && request.method === 'POST' &&
      Number(request.status) >= 200 && Number(request.status) < 300 && request.body
    );
    if (latestSuccessfulNative) {
      const priorPrompt = savedAccountTemplates[0]?.template?.prompt || 'Recovered native image prompt';
      handleNewTemplateCaptured({
        url: latestSuccessfulNative.url,
        method: latestSuccessfulNative.method,
        headers: latestSuccessfulNative.headers,
        bodySample: latestSuccessfulNative.body,
        capturedAt: latestSuccessfulNative.timestamp || Date.now(),
        prompt: priorPrompt,
        hasImages: true,
        source: 'successful-native-trace'
      });
      logBatchProgress('✅ Đã khôi phục template chính xác từ TRACE request thủ công HTTP ' + latestSuccessfulNative.status + '.', 'log-success');
    }

    // TỰ ĐỘNG KHÔI PHỤC TỪ LỊCH SỬ REQUESTS:
    if (savedAccountTemplates.length === 0 && capturedRequests.length > 0) {
      const validReq = capturedRequests.find(r => {
        return r.method === 'POST' && isTrueImageEndpoint(r.url) && r.body;
      });

      if (validReq) {
        console.log('🎯 [AI Studio Content] Tự động khôi phục template tạo ảnh từ lịch sử requests:', validReq.url);
        handleNewTemplateCaptured({
          url: validReq.url,
          method: validReq.method,
          headers: validReq.headers,
          bodySample: validReq.body,
          capturedAt: validReq.timestamp || Date.now(),
          prompt: validReq.prompt || 'Recovered Prompt'
        });
      }
    }
    updateCounters();
    renderAccountsList();
    renderGallery();
    renderApiList();
    updateTemplateStatusBanner();
  });

  // Request phát sinh từ Web Worker không đi qua window.fetch của trang.
  // Background service worker chuyển request đó về đây để lưu theo tài khoản.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'AI_STUDIO_DEBUGGER_TRACE') {
      if (message.phase === 'intercepted') {
        logBatchProgress('🛡️ DEBUGGER đã intercept GenerateContent và thay Cookie template 200 (headers=' + message.headerCount + ').', 'log-success');
      } else {
        logBatchProgress('❌ DEBUGGER không tiếp tục được request: ' + message.error, 'log-error');
      }
      return;
    }

    if (message?.type === 'AI_STUDIO_NETWORK_TRACE') {
      if (message.phase === 'request' && message.trace) {
        const trace = message.trace;
        trace.captureMode = isBatchRunning ? 'chat-automation' : 'native-ai-studio';
        if (trace.isImageApi && trace.captureMode === 'direct-replay') {
          const nativeTrace = capturedRequests.find((item) => item.isImageApi && item.captureMode === 'native-ai-studio' && Number(item.status) >= 200 && Number(item.status) < 300);
          if (nativeTrace) {
            const nativeNames = Object.keys(nativeTrace.headers || {}).sort();
            const replayNames = Object.keys(trace.headers || {}).sort();
            trace.comparison = {
              nativeTraceId: nativeTrace.id,
              missingHeaders: nativeNames.filter((name) => !replayNames.includes(name)),
              extraHeaders: replayNames.filter((name) => !nativeNames.includes(name)),
              nativeBodyBytes: JSON.stringify(nativeTrace.body ?? '').length,
              replayBodyBytes: JSON.stringify(trace.body ?? '').length
            };
            logBatchProgress(
              '🔬 SO SÁNH với request thủ công thành công: thiếu=[' + trace.comparison.missingHeaders.join(',') +
              '], thừa=[' + trace.comparison.extraHeaders.join(',') + '], bodyBytes=' +
              trace.comparison.nativeBodyBytes + '→' + trace.comparison.replayBodyBytes,
              trace.comparison.missingHeaders.length ? 'log-warn' : 'log-info'
            );
          } else {
            logBatchProgress('🔬 Chưa có TRACE request thủ công HTTP 2xx để đối chiếu. Hãy tạo thủ công 1 ảnh trước.', 'log-warn');
          }
        }
        capturedRequests.unshift(trace);
        if (capturedRequests.length > 100) capturedRequests.length = 100;
        if (trace.isImageApi) {
          const headerNames = Object.keys(trace.headers || {}).sort().join(',');
          logBatchProgress(
            '🧪 TRACE ' + trace.captureMode + ': [' + trace.method + ' ' + trace.url.split('/').pop().split('?')[0] +
            '] body=' + (Array.isArray(trace.body) ? 'array' : typeof trace.body) +
            ', headers=' + headerNames,
            'log-info'
          );
        }
      } else if (message.phase === 'complete') {
        const trace = capturedRequests.find((item) => item.browserRequestId === message.browserRequestId);
        if (trace) {
          trace.status = message.status;
          trace.statusLine = message.statusLine;
          trace.error = message.error;
          trace.responseHeaders = message.responseHeaders;
          trace.completedAt = message.completedAt;
          if (trace.isImageApi) {
            logBatchProgress('🧪 TRACE kết thúc ' + trace.captureMode + ': HTTP ' + message.status + (message.error ? ' - ' + message.error : ''), message.status >= 400 || message.error ? 'log-error' : 'log-success');
          }
        }
      }
      saveData();
      renderApiList();
      return;
    }

    if (message?.type === 'AI_STUDIO_AUTH_REFRESHED' && message.headers) {
      let changed = false;
      savedAccountTemplates.forEach((account) => {
        if (!account.template) return;
        account.template.headers = { ...(account.template.headers || {}), ...message.headers };
        account.template.authRefreshedAt = message.refreshedAt || Date.now();
        // A newly observed MakerSuite Authorization supersedes a previous 401/403.
        account.status = 'ready';
        changed = true;
      });
      if (changed) {
        chrome.storage.local.set({ ai_studio_account_templates: savedAccountTemplates });
        renderAccountsList();
        updateTemplateStatusBanner();
        updateCounters();
        if (Date.now() - lastAuthRefreshLogAt > 10000) {
          lastAuthRefreshLogAt = Date.now();
          logBatchProgress('🔐 Đã tự làm mới Authorization từ request nền AI Studio (không tốn lượt tạo ảnh).', 'log-success');
        }
      }
      return;
    }
    if (message?.type !== 'WORKER_IMAGE_REQUEST_CAPTURED' || !message.template) return;
    // Không bao giờ dùng request replay của chính extension làm template mới.
    // Nó đã được lược bớt header và có thể ghi đè template xác thực gốc.
    if (isBatchRunning) {
      logBatchProgress('↩️ Bỏ qua request do chính Direct Replay tạo ra; giữ nguyên template gốc.', 'log-info');
      return;
    }
    const tpl = message.template;
    if (!tpl.bodySample) {
      logBatchProgress('⚠️ Đã thấy request tạo ảnh từ Web Worker nhưng không đọc được payload.', 'log-warn');
      return;
    }
    // webRequest đọc được payload nhưng không biết chuỗi nào là prompt trong
    // protobuf-array. Lấy prompt của lượt User mới nhất từ giao diện làm mốc.
    const turns = document.querySelectorAll('ms-chat-turn, [data-turn-role="user"], [class*="user-turn"], [class*="user-message"]');
    for (let i = turns.length - 1; i >= 0; i--) {
      const lines = (turns[i].innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
      if (turns[i].matches('ms-chat-turn') && lines.some((line) => /^model$/i.test(line)) && !lines.some((line) => /^user$/i.test(line))) {
        continue;
      }
      const candidates = lines.filter((line) =>
        !/^(user|model)$/i.test(line) &&
        !/^\d{1,2}:\d{2}(?::\d{2})?\s*(am|pm)?$/i.test(line)
      );
      if (candidates.length) {
        tpl.prompt = candidates[candidates.length - 1];
        break;
      }
    }
    logBatchProgress('🎯 Bắt được Request tạo ảnh từ Web Worker: [POST ' + (tpl.url.split('/').pop().split('?')[0] || 'GenerateContent') + ']', 'log-success');
    handleNewTemplateCaptured(tpl);
  });

  function saveData() {
    // Lưu template/auth riêng trước. Nếu Gallery chứa nhiều ảnh Base64 làm
    // storage lỗi thì template vẫn không bị mất sau khi F5.
    const templateSignature = savedAccountTemplates
      .map((account) => account.uIndex + ':' + (account.template?.capturedAt || 0))
      .join('|');
    chrome.storage.local.set({
      ai_studio_account_templates: savedAccountTemplates
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[AI Studio Content] Không lưu được template:', chrome.runtime.lastError.message);
        logBatchProgress('❌ Không lưu được Request Template: ' + chrome.runtime.lastError.message, 'log-error');
      } else if (templateSignature && templateSignature !== lastPersistedTemplateSignature) {
        lastPersistedTemplateSignature = templateSignature;
        logBatchProgress('💾 Đã lưu bền vững ' + savedAccountTemplates.length + ' Request Template (không mất khi F5).', 'log-success');
      }
    });

    chrome.storage.local.set({
      ai_studio_requests: capturedRequests.slice(0, 50),
      ai_studio_images: capturedImages.slice(0, 100)
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[AI Studio Content] Không lưu được lịch sử/Gallery:', chrome.runtime.lastError.message);
        logBatchProgress('⚠️ Không lưu được lịch sử/Gallery: ' + chrome.runtime.lastError.message, 'log-warn');
      }
    });
    updateCounters();
  }

  function updateCounters() {
    const imgBadge = document.getElementById('studio-badge-images');
    const apiBadge = document.getElementById('studio-badge-api');
    const accCountEl = document.getElementById('tab-accounts-count');
    const galleryStats = document.getElementById('gallery-total-count');

    if (imgBadge) imgBadge.innerText = '📷 ' + capturedImages.length;
    if (apiBadge) apiBadge.innerText = '📡 ' + capturedRequests.length;
    if (accCountEl) accCountEl.innerText = savedAccountTemplates.length;
    if (galleryStats) galleryStats.innerText = 'Tổng cộng: ' + capturedImages.length + ' ảnh đã sinh';

    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE_COUNT',
        imagesCount: capturedImages.length,
        reqCount: capturedRequests.length
      });
    } catch (_) {}
  }

  function getActiveGoogleAccountInfo() {
    const match = window.location.pathname.match(/\/u\/(\d+)\//);
    const uIndex = match ? match[1] : '0';
    return {
      uIndex: uIndex,
      displayName: 'Tài khoản Google #' + (parseInt(uIndex, 10) + 1) + ' (/u/' + uIndex + '/)'
    };
  }

  // 2. DOM Image Observer: Ghi nhận ảnh hiển thị vào Gallery để xem lại
  // TUYỆT ĐỐI KHÔNG TỰ ĐỘNG TẢI VỀ KHI F5 HOẶC LOAD TRANG CŨ!
  const processedSrcs = new Set();
  let isInitialScanDone = false;

  function setupDomImageObserver() {
    function scanImages() {
      const imgs = document.querySelectorAll('img');
      const isInitial = !isInitialScanDone;

      imgs.forEach((img) => {
        if (img.closest('#ai-studio-root')) return;
        const src = img.src || img.getAttribute('src') || '';
        if (!src || src.startsWith('chrome-extension:') || src.includes('favicon') || src.includes('google-logo')) {
          return;
        }
        if (img.width < 80 && img.height < 80 && !src.startsWith('data:image/')) {
          return;
        }

        const srcKey = src.substring(0, 120);
        if (processedSrcs.has(srcKey)) return;
        processedSrcs.add(srcKey);

        if (isInitial || isBatchRunning) return;

        let promptText = '';
        try {
          const chatTurns = document.querySelectorAll('ms-chat-turn, .chat-turn, [class*="user-turn"], [class*="user-message"]');
          if (chatTurns.length > 0) {
            promptText = (chatTurns[chatTurns.length - 1].innerText || '').trim();
          }
        } catch (_) {}

        const newImgObj = {
          id: 'img_dom_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
          mimeType: src.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
          base64: src.startsWith('data:') ? src.split(',')[1] : null,
          dataUrl: src,
          prompt: promptText || 'AI Studio Generated Image',
          timestamp: Date.now(),
          account: getActiveGoogleAccountInfo().displayName,
          sizeApprox: 0
        };

        capturedImages.unshift(newImgObj);
        if (capturedImages.length > 100) capturedImages.pop();

        saveData();
        renderGallery();
      });

      isInitialScanDone = true;
    }

    const observer = new MutationObserver(scanImages);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });

    setTimeout(scanImages, 1500);
  }

  // 3. Lắng nghe PostMessage từ injected.js (Bắt API & Template)
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) {
      return;
    }

    // MAIN-world executor cannot call chrome.runtime directly. Relay its API
    // request through the extension service worker so host permissions and the
    // Google cookie context are applied consistently.
    if (event.data.target === 'AI_STUDIO_BACKGROUND_FETCH_REQUEST') {
      const requestId = event.data.requestId;
      chrome.runtime.sendMessage({ type: 'BACKGROUND_DIRECT_FETCH', request: event.data.request })
        .then((result) => window.postMessage({
          target: 'AI_STUDIO_BACKGROUND_FETCH_RESPONSE', requestId, result
        }, '*'))
        .catch((error) => window.postMessage({
          target: 'AI_STUDIO_BACKGROUND_FETCH_RESPONSE', requestId,
          result: { success: false, error: error?.message || String(error) }
        }, '*'));
      return;
    }

    if (event.data.target === 'AI_STUDIO_PREPARE_REPLAY_COOKIE') {
      const requestId = event.data.requestId;
      chrome.runtime.sendMessage({ type: 'PREPARE_REPLAY_COOKIE', cookie: event.data.cookie })
        .then((result) => window.postMessage({ target: 'AI_STUDIO_PREPARE_REPLAY_COOKIE_RESPONSE', requestId, result }, '*'))
        .catch((error) => window.postMessage({ target: 'AI_STUDIO_PREPARE_REPLAY_COOKIE_RESPONSE', requestId, result: { success: false, error: error?.message || String(error) } }, '*'));
      return;
    }

    if (event.data.source !== SENDER_ID) return;

    // A. Bắt Request tạo ảnh thành công -> Lưu làm Template & Auth của tài khoản
    if (event.data.type === 'TEMPLATE_CAPTURED') {
      handleNewTemplateCaptured(event.data.template);
    }

    // B. Ghi log Request cho API Sniffer
        // C. Nhận log mạng thời gian thực
    if (event.data.type === 'LOG_NETWORK') {
      const { method, endpointShort, isImageEndpoint } = event.data;
      if (isImageEndpoint) {
        logBatchProgress('🎯 Bắt gặp Request tạo ảnh: [' + method + ' ' + endpointShort + ']', 'log-success');
      } else {
        logBatchProgress('📡 Bắt gặp Request: [' + method + ' ' + endpointShort + ']', 'log-info');
      }
    }

    if (event.data.type === 'API_CAPTURED') {
      const req = event.data.payload;
      if (Array.isArray(event.data.images) && event.data.images.length > 0 && req?.isImageApi) {
        lastNativeGeneratedImages = event.data.images;
      }
      capturedRequests.unshift(req);
      if (capturedRequests.length > 50) capturedRequests.pop();

      saveData();
      renderApiList();
    }
  });

  // Xử lý khi bắt được Template mới
  function handleNewTemplateCaptured(tpl) {
    if (!tpl || !tpl.url || !tpl.bodySample) return;
    if (!isTrueImageEndpoint(tpl.url)) {
      console.log('⛔ [AI Studio Content] Bỏ qua endpoint không phải tạo ảnh:', tpl.url);
      return;
    }
    const urlLower = tpl.url.toLowerCase();
    if (urlLower.includes('generatetitle') || urlLower.includes('title')) {
      console.log('⛔ [AI Studio Content] Bỏ qua GenerateTitle:', tpl.url);
      return;
    }

    const accInfo = getActiveGoogleAccountInfo();
    const authHeader = (tpl.headers && (tpl.headers['authorization'] || tpl.headers['x-goog-api-key'])) || 'Google Session Cookie';
    const authSnippet = authHeader.length > 30 ? authHeader.substring(0, 18) + '...' + authHeader.slice(-8) : authHeader;

    let existingAcc = savedAccountTemplates.find((a) => a.uIndex === accInfo.uIndex);
    if (existingAcc) {
      const sameCapture = existingAcc.template?.capturedAt === tpl.capturedAt;
      existingAcc.template = tpl;
      existingAcc.authSnippet = authSnippet;
      existingAcc.lastUpdated = Date.now();
      existingAcc.status = 'ready';
      if (!sameCapture) {
        logBatchProgress('🔄 ĐÃ CẬP NHẬT AUTH & TEMPLATE MỚI CHO: ' + existingAcc.name, 'log-success');
      }
    } else {
      existingAcc = {
        id: 'acc_' + accInfo.uIndex + '_' + Date.now(),
        name: accInfo.displayName,
        uIndex: accInfo.uIndex,
        authSnippet: authSnippet,
        template: tpl,
        capturedAt: Date.now(),
        lastUpdated: Date.now(),
        status: 'ready',
        usageCount: 0
      };
      savedAccountTemplates.push(existingAcc);
      logBatchProgress('🎯 ĐÃ BẮT THÀNH CÔNG REQUEST & AUTH CỦA: ' + existingAcc.name + '!', 'log-success');
    }

    saveData();
    renderAccountsList();
    updateCounters();
    updateTemplateStatusBanner();
  }

  // Helper gửi message tới injected.js và nhận kết quả Promise
  function sendInjectedRequest(action, payload) {
    return new Promise((resolve, reject) => {
      const reqId = 'req_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('Yêu cầu hết thời gian chờ (Timeout 90s)'));
      }, 90000);

      function onMsg(event) {
        if (event.source !== window || !event.data || event.data.target !== RESPONSE_TARGET) return;
        if (event.data.requestId === reqId) {
          clearTimeout(timeout);
          window.removeEventListener('message', onMsg);
          if (event.data.success) {
            resolve(event.data.data);
          } else {
            reject(new Error(event.data.error || 'Thất bại không xác định'));
          }
        }
      }

      window.addEventListener('message', onMsg);
      window.postMessage({
        target: EXECUTOR_TARGET,
        requestId: reqId,
        action,
        payload
      }, '*');
    });
  }

  // 4. Khởi tạo và gắn UI kiên cố
  function ensureUI() {
    if (document.getElementById('ai-studio-root')) return;
    const targetParent = document.body || document.documentElement;
    if (!targetParent) return;

    const root = document.createElement('div');
    root.id = 'ai-studio-root';
    root.innerHTML = `
      <!-- Floating Trigger Button -->
      <div id="ai-studio-trigger" title="Mở Studio Panel (Bấm để mở, kéo để di chuyển)">
        <span class="studio-logo-icon">✨</span>
        <span class="studio-title-badge">AI Studio Image</span>
        <div class="studio-counters">
          <span class="badge-pill badge-images" id="studio-badge-images">📷 ${capturedImages.length}</span>
          <span class="badge-pill badge-api" id="studio-badge-api">📡 ${capturedRequests.length}</span>
        </div>
        <span class="trigger-arrow" id="trigger-arrow-icon">▲</span>
      </div>

      <!-- Main Studio Panel -->
      <div id="ai-studio-panel" class="panel-hidden">
        <!-- Header -->
        <div class="panel-header">
          <div class="panel-header-left">
            <span class="pulse-indicator"></span>
            <span class="panel-title">AI Studio Image Studio</span>
            <span class="panel-subtitle">Tự động hóa phiên chat AI Studio & Multi-Account</span>
          </div>
          <div class="panel-header-actions">
            <button id="btn-export-all" class="btn-header" title="Xuất dữ liệu ảnh và API ra JSON">💾 Xuất JSON</button>
            <button id="btn-clear-data" class="btn-header btn-danger-light" title="Xóa toàn bộ lịch sử">🗑️ Xóa logs</button>
            <button id="btn-close-studio" class="btn-close-panel" title="Thu nhỏ">✕</button>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="panel-tabs-bar">
          <button class="panel-tab active" data-tab="batch">🎨 Tạo Ảnh Hàng Loạt</button>
          <button class="panel-tab" data-tab="accounts">👥 Quản Lý Tài Khoản & Auth (<span id="tab-accounts-count">${savedAccountTemplates.length}</span>)</button>
          <button class="panel-tab" data-tab="gallery">🖼️ Bộ Sưu Tập (<span id="tab-gallery-count">${capturedImages.length}</span>)</button>
          <button class="panel-tab" data-tab="sniffer">📡 Phân Tích API & cURL (<span id="tab-api-count">${capturedRequests.length}</span>)</button>
        </div>

        <!-- Tab 1: Batch Generator -->
        <div class="tab-content active" id="tab-batch">
          <div class="studio-batch-container">
            <div class="studio-form-pane">
              <!-- Banner trạng thái Template & Auth -->
              <div id="template-status-banner" style="margin-bottom: 12px;"></div>

              <div class="form-group">
                <label class="form-label">
                  <span>Danh sách Prompt (Mỗi dòng 1 prompt)</span>
                  <span class="label-hint">Tự nhập prompt và bấm Run trong phiên chat AI Studio</span>
                </label>
                <textarea id="batch-prompts-input" class="prompt-textarea" placeholder="Nhập danh sách prompt tạo ảnh tại đây...&#10;A red big dog sitting on green grass, high detail, 8k&#10;A majestic cybernetic tiger with glowing blue neon eyes&#10;A cozy coffee shop in rainy Tokyo, watercolor illustration"></textarea>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Số ảnh mỗi prompt</label>
                  <input type="number" id="batch-repeat-count" class="form-input" min="1" max="50" value="1" />
                </div>
                <div class="form-group">
                  <label class="form-label">Khoảng nghỉ giữa các ảnh (giây)</label>
                  <input type="number" id="batch-delay-sec" class="form-input" min="0" max="60" value="2" />
                </div>
              </div>

              <div class="checkbox-group">
                <label class="checkbox-label">
                  <input type="checkbox" id="batch-auto-download" checked />
                  <span>Tự động tải ảnh về máy (.PNG) ngay khi vừa tạo xong</span>
                </label>
                <label class="checkbox-label" title="Tự động mở popup xem trước ảnh khi tạo xong">
                  <input type="checkbox" id="batch-auto-preview" />
                  <span>Tự động mở cửa sổ xem trước ảnh lớn (Preview)</span>
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" id="batch-rotate-accounts" checked />
                  <span>Tự động xoay vòng qua các tài khoản (Round-Robin)</span>
                </label>
              </div>

              <div class="studio-actions-row">
                <button id="btn-start-batch" class="btn-primary">🚀 Bắt Đầu Tạo Ảnh (Phiên Chat Tự Động)</button>
                <button id="btn-stop-batch" class="btn-secondary" style="display:none; background: #ef4444; color: #fff;">⏹️ Dừng lại</button>
              </div>
            </div>

            <div class="studio-progress-pane">
              <div class="progress-box-header">
                <span class="progress-title">Tiến trình xử lý</span>
                <span class="progress-count" id="progress-percent">0 / 0 (0%)</span>
              </div>
              <div class="progress-track">
                <div class="progress-bar" id="progress-bar-fill" style="width: 0%;"></div>
              </div>

              <div class="live-logs-container">
                <div class="logs-header">
                  <span>Nhật ký thời gian thực (Live Logs)</span>
                  <button id="btn-clear-logs" class="btn-link">Xóa log</button>
                </div>
                <div class="logs-scroll" id="batch-live-logs">
                  <div class="log-entry log-info">[Hệ thống] Sẵn sàng tự động tạo ảnh qua phiên chat AI Studio.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 2: Multi-Account Management -->
        <div class="tab-content" id="tab-accounts">
          <div class="accounts-panel-container">
            <div class="accounts-header-banner">
              <div class="banner-text">
                <h3>👥 Quản Lý Tài Khoản & Auth (Tạo Ảnh Bằng Request)</h3>
                <p>Mỗi tài khoản Google khi tạo 1 ảnh thử nghiệm sẽ được tiện ích lưu lại Auth & Request Template để chạy hàng loạt!</p>
              </div>
            </div>

            <div class="accounts-form-box" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(15, 23, 42, 0.9) 100%); border: 1px solid rgba(99, 102, 241, 0.3);">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <div>
                  <span style="font-size:11px; color:#94a3b8;">Tab hiện tại đang mở:</span>
                  <div style="font-size:14px; font-weight:700; color:#818cf8;" id="current-active-account-display">
                    ${getActiveGoogleAccountInfo().displayName}
                  </div>
                </div>
                <span class="badge-pill badge-images">Miễn Phí 100%</span>
              </div>
              <div style="font-size:11px; color:#cbd5e1; margin-top:8px; line-height:1.5;">
                💡 <strong>Cách thêm tài khoản mới:</strong> Bấm vào một trong các nút dưới đây để mở tab với tài khoản Google khác, sau đó <strong>tạo thử 1 ảnh trên khung chat AI Studio</strong> để tiện ích tự động bắt Request & Auth của tài khoản đó:
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                <button class="btn-secondary btn-switch-u" data-u="0">👤 Mở Tab Tài khoản 1 (/u/0/)</button>
                <button class="btn-secondary btn-switch-u" data-u="1">👤 Mở Tab Tài khoản 2 (/u/1/)</button>
                <button class="btn-secondary btn-switch-u" data-u="2">👤 Mở Tab Tài khoản 3 (/u/2/)</button>
                <button class="btn-secondary btn-switch-u" data-u="3">👤 Mở Tab Tài khoản 4 (/u/3/)</button>
                <a href="https://accounts.google.com/AddSession?continue=https://aistudio.google.com/prompts/new_chat%3Fmodel%3Dgemini-3.1-flash-lite-image" target="_blank" class="btn-primary-small" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;">➕ Đăng nhập thêm tài khoản Google ↗</a>
              </div>
            </div>

            <div class="accounts-list-wrap">
              <div class="accounts-list-header">
                <span style="font-weight:700; color:#cbd5e1;">Danh Sách Tài Khoản & Auth Sẵn Sàng (<span id="accounts-active-count">0</span>)</span>
                <button id="btn-clear-accounts" class="btn-header btn-danger-light">🗑️ Xóa hết tài khoản</button>
              </div>
              <div class="accounts-cards-grid" id="accounts-cards-grid">
                <!-- Render cards dynamically -->
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 3: Gallery -->
        <div class="tab-content" id="tab-gallery">
          <div class="gallery-toolbar">
            <span class="gallery-stats" id="gallery-total-count">Tổng cộng: ${capturedImages.length} ảnh đã sinh</span>
            <div style="display:flex; gap:8px;">
              <button id="btn-download-all-images" class="btn-header">📥 Tải tất cả ảnh</button>
              <button id="btn-clear-gallery" class="btn-header btn-danger-light">🗑️ Xóa gallery</button>
            </div>
          </div>
          <div class="gallery-grid" id="gallery-grid-container"></div>
        </div>

        <!-- Tab 4: API Sniffer -->
        <div class="tab-content" id="tab-sniffer">
          <div class="api-sniffer-container">
            <div class="api-list-pane">
              <div class="api-filter-bar">
                <input type="text" id="api-search-input" class="api-search-input" placeholder="🔍 Tìm kiếm API..." />
              </div>
              <div class="api-scroll-list" id="api-items-list"></div>
            </div>
            <div class="api-detail-pane" id="api-detail-view">
              <div class="empty-placeholder">
                <span class="empty-icon">📡</span>
                <p>Chọn một API bên trái để xem chi tiết cURL, Payload và Response.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Lightbox Modal -->
      <div id="ai-studio-lightbox">
        <div class="lightbox-content">
          <img id="lightbox-img" class="lightbox-img" src="" alt="AI Studio Generated" />
          <div id="lightbox-prompt" class="lightbox-prompt"></div>
          <div class="lightbox-actions">
            <button id="btn-lightbox-download" class="btn-primary">📥 Tải ảnh PNG</button>
            <button id="btn-lightbox-copy-b64" class="btn-secondary">📋 Copy Base64</button>
            <button id="btn-lightbox-close" class="btn-secondary">✕ Đóng</button>
          </div>
        </div>
      </div>
    `;

    targetParent.appendChild(root);
    setupEventListeners();
    makeDraggable(document.getElementById('ai-studio-trigger'), root);
    renderAccountsList();
    renderGallery();
    renderApiList();
    updateTemplateStatusBanner();
  }

  // 5. Draggable Button
  function makeDraggable(handle, container) {
    if (!handle || !container) return;
    let isDragging = false;
    let startX, startY, initialRight, initialBottom, hasMoved = false;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      initialRight = window.innerWidth - rect.right;
      initialBottom = window.innerHeight - rect.bottom;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      const newRight = Math.max(10, Math.min(window.innerWidth - 100, initialRight - dx));
      const newBottom = Math.max(10, Math.min(window.innerHeight - 50, initialBottom - dy));
      container.style.right = newRight + 'px';
      container.style.bottom = newBottom + 'px';
      const panel = document.getElementById('ai-studio-panel');
      if (panel) {
        panel.style.right = newRight + 'px';
        panel.style.bottom = (newBottom + 60) + 'px';
      }
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    handle.addEventListener('click', (e) => {
      if (hasMoved) {
        e.stopPropagation();
        e.preventDefault();
        hasMoved = false;
      }
    });
  }

  // 6. Setup Events
  function setupEventListeners() {
    const trigger = document.getElementById('ai-studio-trigger');
    const panel = document.getElementById('ai-studio-panel');
    const closeBtn = document.getElementById('btn-close-studio');
    const arrowIcon = document.getElementById('trigger-arrow-icon');

    function togglePanel() {
      isPanelOpen = !isPanelOpen;
      if (isPanelOpen) {
        panel.classList.remove('panel-hidden');
        if (arrowIcon) arrowIcon.innerText = '▼';
      } else {
        panel.classList.add('panel-hidden');
        if (arrowIcon) arrowIcon.innerText = '▲';
      }
    }

    if (trigger) trigger.addEventListener('click', togglePanel);
    if (closeBtn) closeBtn.addEventListener('click', togglePanel);

    // Tab Navigation
    const tabs = document.querySelectorAll('.panel-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        tab.classList.add('active');
        const targetTabId = 'tab-' + tab.getAttribute('data-tab');
        const contentEl = document.getElementById(targetTabId);
        if (contentEl) contentEl.classList.add('active');
        activeTab = tab.getAttribute('data-tab');
      });
    });

    // Mở tab /u/0, /u/1,...
    document.querySelectorAll('.btn-switch-u').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const u = e.currentTarget.getAttribute('data-u') || '0';
        const targetUrl = 'https://aistudio.google.com/u/' + u + '/prompts/new_chat?model=gemini-3.1-flash-lite-image';
        window.open(targetUrl, '_blank');
      });
    });

    const btnStart = document.getElementById('btn-start-batch');
    const btnStop = document.getElementById('btn-stop-batch');
    if (btnStart) btnStart.addEventListener('click', startBatchGeneration);
    if (btnStop) btnStop.addEventListener('click', stopBatchGeneration);

    const btnClearAccounts = document.getElementById('btn-clear-accounts');
    if (btnClearAccounts) {
      btnClearAccounts.addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn xóa tất cả Request Template & Auth đã lưu?')) {
          savedAccountTemplates = [];
          saveData();
          renderAccountsList();
          updateTemplateStatusBanner();
        }
      });
    }

    const btnExport = document.getElementById('btn-export-all');
    const btnClearData = document.getElementById('btn-clear-data');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    if (btnExport) btnExport.addEventListener('click', exportAllData);
    if (btnClearData) btnClearData.addEventListener('click', clearAllData);
    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => {
        const box = document.getElementById('batch-live-logs');
        if (box) box.innerHTML = '';
      });
    }

    const btnClearGallery = document.getElementById('btn-clear-gallery');
    if (btnClearGallery) {
      btnClearGallery.addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn xóa tất cả ảnh trong bộ sưu tập?')) {
          capturedImages = [];
          saveData();
          renderGallery();
        }
      });
    }

    const btnDownloadAll = document.getElementById('btn-download-all-images');
    if (btnDownloadAll) {
      btnDownloadAll.addEventListener('click', () => {
        if (capturedImages.length === 0) {
          alert('Chưa có ảnh nào để tải!');
          return;
        }
        capturedImages.forEach((img, idx) => {
          setTimeout(() => triggerImageDownload(img), idx * 400);
        });
      });
    }

    const lightbox = document.getElementById('ai-studio-lightbox');
    const btnLbClose = document.getElementById('btn-lightbox-close');
    if (btnLbClose) btnLbClose.addEventListener('click', () => lightbox.classList.remove('active'));
    if (lightbox) {
      lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) lightbox.classList.remove('active');
      });
    }

    const apiSearch = document.getElementById('api-search-input');
    if (apiSearch) {
      apiSearch.addEventListener('input', (e) => {
        renderApiList(e.target.value.toLowerCase());
      });
    }
  }

  function updateTemplateStatusBanner() {
    const banner = document.getElementById('template-status-banner');
    if (!banner) return;

    banner.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 18px;">🤖</span>
          <div style="font-size: 11px; color: #a7f3d0;">
            <strong>Chế độ Chat UI Tự Động:</strong> Nhập prompt bên dưới và bấm nút xanh để tự động điền chatbox, bấm Run và tải ảnh về máy!
          </div>
        </div>
        <span class="badge-pill badge-images">SẴN SÀNG</span>
      </div>
    `;
  }

    function saveAccountTemplateManually(tpl) {
    if (!tpl || !tpl.url || !isTrueImageEndpoint(tpl.url)) {
      alert('Request này không phải GenerateContent/StreamGenerateContent nên không thể dùng làm template tạo ảnh.');
      return;
    }
    const accInfo = getActiveGoogleAccountInfo();
    const authHeader = (tpl.headers && (tpl.headers['authorization'] || tpl.headers['x-goog-api-key'])) || 'Google Session Cookie';
    const authSnippet = authHeader.length > 30 ? authHeader.substring(0, 18) + '...' + authHeader.slice(-8) : authHeader;

    let existingAcc = savedAccountTemplates.find((a) => a.uIndex === accInfo.uIndex);
    if (existingAcc) {
      existingAcc.template = tpl;
      existingAcc.authSnippet = authSnippet;
      existingAcc.lastUpdated = Date.now();
      existingAcc.status = 'ready';
      logBatchProgress('🔄 [Thủ công] Đã lưu Template mới cho: ' + existingAcc.name, 'log-success');
    } else {
      existingAcc = {
        id: 'acc_' + accInfo.uIndex + '_' + Date.now(),
        name: accInfo.displayName,
        uIndex: accInfo.uIndex,
        authSnippet: authSnippet,
        template: tpl,
        capturedAt: Date.now(),
        lastUpdated: Date.now(),
        status: 'ready',
        usageCount: 0
      };
      savedAccountTemplates.push(existingAcc);
      logBatchProgress('🎯 [Thủ công] Đã thêm Template & Auth cho: ' + existingAcc.name + '!', 'log-success');
    }

    saveData();
    renderAccountsList();
    updateCounters();
    updateTemplateStatusBanner();
  }

  function renderAccountsList() {
    const grid = document.getElementById('accounts-cards-grid');
    const activeCountEl = document.getElementById('accounts-active-count');
    const tabAccCount = document.getElementById('tab-accounts-count');

    if (tabAccCount) tabAccCount.innerText = savedAccountTemplates.length;
    if (activeCountEl) activeCountEl.innerText = savedAccountTemplates.filter((a) => a.status === 'ready').length + ' / ' + savedAccountTemplates.length;
    if (!grid) return;

    if (savedAccountTemplates.length === 0) {
      grid.innerHTML = `
        <div class="empty-placeholder" style="grid-column: 1 / -1; padding: 25px;">
          <span class="empty-icon">👥</span>
          <h4 style="margin: 6px 0; color: #cbd5e1;">Chưa có Request Template nào được lưu</h4>
          <p style="font-size: 12px; color: #94a3b8; max-width: 450px; margin: 0 auto;">
            Chỉ cần <strong>tạo thử 1 bức ảnh bất kỳ</strong> trên giao diện web AI Studio. Tiện ích sẽ tự động bắt lấy Request, Auth Token và lưu vào danh sách tài khoản này!
          </p>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    savedAccountTemplates.forEach((acc, idx) => {
      const card = document.createElement('div');
      card.className = 'account-card';
      const isOk = acc.status === 'ready';

      card.innerHTML = `
        <div class="account-card-top">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="status-indicator-dot ${isOk ? 'dot-active' : 'dot-error'}"></span>
            <span class="account-name">${acc.name}</span>
          </div>
          <button class="btn-del-acc" title="Xóa tài khoản này">✕</button>
        </div>
        <div class="account-key-preview" style="word-break:break-all;">Auth: ${acc.authSnippet || 'Google Session'}</div>
        <div style="font-size:10px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${acc.template?.url}">
          Endpoint: ${acc.template?.url ? acc.template.url.replace(/^https?:\/\/[^/]+/, '') : 'GenerateContent'}
        </div>
        <div class="account-card-stats">
          <span>Đã tạo: <strong>${acc.usageCount || 0}</strong> ảnh</span>
          <span class="badge-pill ${isOk ? 'badge-images' : 'badge-danger'}">${isOk ? 'SẴN SÀNG' : 'HẾT HẠN'}</span>
        </div>
      `;

      card.querySelector('.btn-del-acc').addEventListener('click', () => {
        savedAccountTemplates.splice(idx, 1);
        saveData();
        renderAccountsList();
        updateTemplateStatusBanner();
      });

      grid.appendChild(card);
    });
  }

  function logBatchProgress(msg, type = 'log-info') {
    const box = document.getElementById('batch-live-logs');
    if (!box) return;
    const item = document.createElement('div');
    item.className = 'log-entry ' + type;
    const time = new Date().toLocaleTimeString();
    item.innerText = '[' + time + '] ' + msg;
    box.appendChild(item);
    box.scrollTop = box.scrollHeight;
  }

      // Helper chống Chrome đóng băng/tạm dừng tab AI Studio khi chuyển sang tab khác
  let silentAudioCtx = null;
  function startBackgroundKeepAlive() {
    try {
      if (!silentAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          silentAudioCtx = new AudioCtx();
          const osc = silentAudioCtx.createOscillator();
          const gain = silentAudioCtx.createGain();
          gain.gain.value = 0; // Hoàn toàn im lặng 0 dB, chỉ để giữ Chrome ưu tiên tab
          osc.connect(gain);
          gain.connect(silentAudioCtx.destination);
          osc.start();
        }
      }
      if (silentAudioCtx && silentAudioCtx.state === 'suspended') {
        silentAudioCtx.resume();
      }
    } catch (_) {}
  }

  function stopBackgroundKeepAlive() {
    try {
      if (silentAudioCtx) {
        silentAudioCtx.close();
        silentAudioCtx = null;
      }
    } catch (_) {}
  }

  // ==========================================================================
  // 7. BATCH GENERATION CONTROLLER (UI NATIVE CHAT AUTOMATION)
  // ==========================================================================
  async function startBatchGeneration() {
    if (isBatchRunning) return;

    const input = document.getElementById('batch-prompts-input').value.trim();
    if (!input) {
      alert('Vui lòng nhập ít nhất 1 câu prompt để tạo ảnh!');
      return;
    }

    const lines = input.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const repeatCount = parseInt(document.getElementById('batch-repeat-count').value, 10) || 1;
    const delaySec = parseInt(document.getElementById('batch-delay-sec').value, 10) || 2;

    const taskQueue = [];
    lines.forEach((promptLine) => {
      for (let r = 0; r < repeatCount; r++) {
        taskQueue.push({ prompt: promptLine, index: r + 1, totalRepeats: repeatCount });
      }
    });

    isBatchRunning = true;
    shouldStopBatch = false;
    currentBatchStartTime = Date.now();
    startBackgroundKeepAlive();

    document.getElementById('btn-start-batch').style.display = 'none';
    document.getElementById('btn-stop-batch').style.display = 'inline-flex';

    logBatchProgress('🚀 BẮT ĐẦU TẠO ' + taskQueue.length + ' ẢNH (TỰ ĐỘNG QUA GIAO DIỆN CHAT AI STUDIO)...', 'log-info');

    const progressBar = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-percent');

    let completed = 0;
    for (let i = 0; i < taskQueue.length; i++) {
      if (shouldStopBatch) {
        logBatchProgress('⏹️ Người dùng đã dừng tiến trình tạo ảnh.', 'log-warn');
        break;
      }

      const task = taskQueue[i];
      logBatchProgress('[#' + (i + 1) + '/' + taskQueue.length + '] Gửi prompt: "' + task.prompt + '"...', 'log-info');

      // Tự động đóng Lightbox xem trước nếu đang mở để không che chắn giao diện trang
      const lb = document.getElementById('ai-studio-lightbox');
      if (lb) lb.classList.remove('active');

      try {
        // Chụp lại danh sách toàn bộ ảnh hiện có trên trang để TUYỆT ĐỐI KHÔNG nhận nhầm ảnh cũ
        const beforeSendSrcs = new Set();
        document.querySelectorAll('img').forEach((img) => {
          if (img.closest && img.closest('#ai-studio-root')) return;
          const s = img.src || img.getAttribute('src') || '';
          if (s) beforeSendSrcs.add(s);
        });

        // 1. Điền prompt vào chatbox và bấm nút Run
        await sendInjectedRequest('DOM_SUBMIT_PROMPT', { prompt: task.prompt });
        logBatchProgress('⏳ Đã bấm Run, đang chờ AI Studio sinh ảnh mới...', 'log-info');

        // 2. Chờ ảnh MỚI thực sự xuất hiện trong chat (tối thiểu 2.5s trước khi quét)
        const newImgObj = await waitForNewChatImage(beforeSendSrcs, task.prompt, 120000);

        if (newImgObj) {
          logBatchProgress('🎨 ✨ TẠO THÀNH CÔNG ẢNH CHO: "' + task.prompt + '"!', 'log-success');

          // Thêm vào bộ sưu tập
          if (!capturedImages.some((ci) => ci.dataUrl === newImgObj.dataUrl)) {
            capturedImages.unshift(newImgObj);
            if (capturedImages.length > 100) capturedImages.pop();
            saveData();
            renderGallery();
          }

          // Tự động tải về máy với đúng tên prompt của task
          if (document.getElementById('batch-auto-download')?.checked) {
            logBatchProgress('📥 Tự động tải ảnh về máy (.PNG)...', 'log-info');
            triggerImageDownload(newImgObj);
          }

          if (document.getElementById('batch-auto-preview')?.checked) {
            openLightbox(newImgObj);
          }

          completed++;
        } else {
          throw new Error('Hết thời gian chờ nhưng AI Studio không trả ảnh mới.');
        }

        const pct = Math.round((completed / taskQueue.length) * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.innerText = completed + ' / ' + taskQueue.length + ' (' + pct + '%)';

        if (i < taskQueue.length - 1 && !shouldStopBatch && delaySec > 0) {
          logBatchProgress('⏳ Nghỉ ' + delaySec + 's trước lượt tiếp theo...', 'log-info');
          await new Promise((r) => setTimeout(r, delaySec * 1000));
        }
      } catch (err) {
        logBatchProgress('❌ [#' + (i + 1) + '] Thất bại: ' + err.message, 'log-error');
      }
    }

    isBatchRunning = false;
    stopBackgroundKeepAlive();
    document.getElementById('btn-start-batch').style.display = 'inline-flex';
    document.getElementById('btn-stop-batch').style.display = 'none';
    logBatchProgress('🎉 HOÀN THÀNH PHIÊN TẠO ẢNH! Đã tạo thành công ' + completed + '/' + taskQueue.length + ' ảnh.', 'log-success');
  }

  function stopBatchGeneration() {
    shouldStopBatch = true;
    stopBackgroundKeepAlive();
    logBatchProgress('⏳ Đang dừng sau lượt hiện tại...', 'log-warn');
  }

  // Hàm chờ ảnh MỚI thực sự xuất hiện trong chat (Loại bỏ 100% ảnh cũ trong lịch sử và starter prompts)
  async function waitForNewChatImage(beforeSendSrcs, currentPrompt, timeoutMs = 120000) {
    const started = Date.now();

    // Chờ tối thiểu 2.5 giây để AI Studio bắt đầu sinh ảnh (tránh nhận nhầm ảnh mẫu vừa load tức thì)
    await new Promise((r) => setTimeout(r, 2500));

    let retriedOnce = false;
    let retriedTwice = false;

    while (Date.now() - started < timeoutMs) {
      // Kiểm tra ngay xem AI Studio có báo lỗi Rate limit / Quota không
      const errorBanner = Array.from(document.querySelectorAll('div, span, p')).find((el) => {
        if (el.closest && el.closest('#ai-studio-root')) return false;
        const text = el.innerText || '';
        return text.includes("You've reached your rate limit") || text.includes("reached your quota");
      });
      if (errorBanner) {
        throw new Error("Tài khoản Google này đã chạm giới hạn Quota trong ngày của AI Studio (Rate limit / Quota exceeded)! Hãy chuyển sang tài khoản khác (/u/1/) để tiếp tục.");
      }

      // 1. Chỉ tìm trong các lượt chat (ms-chat-turn, .chat-turn, ms-prompt-editor)
      // TUYỆT ĐỐI BỎ QUA các khối starter prompts, template gallery, sidebar, header (chính là nơi chứa ảnh bản vẽ Neuschwanstein Castle!)
      const turns = Array.from(
        document.querySelectorAll('ms-chat-turn, .chat-turn, ms-run-view, ms-model-response, [data-turn-role="model"]')
      ).filter((turn) => {
        if (turn.closest('#ai-studio-root')) return false;
        if (turn.closest('ms-starter-prompts, .starter-prompts, ms-gallery, .gallery-view, aside, header, nav')) return false;
        return true;
      });

      let candidateImgs = [];
      if (turns.length > 0) {
        // Duyệt từ lượt chat mới nhất ở dưới đáy
        for (let tIdx = turns.length - 1; tIdx >= 0; tIdx--) {
          const imgsInTurn = Array.from(turns[tIdx].querySelectorAll('img')).filter((img) => {
            if (img.closest('#ai-studio-root, ms-starter-prompts, ms-gallery, aside, header')) return false;
            const src = img.src || img.getAttribute('src') || '';
            if (!src || src.startsWith('chrome-extension:') || src.includes('favicon') || src.includes('avatar') || src.includes('google-logo')) return false;
            if (img.naturalWidth < 120 && img.width < 120 && !src.startsWith('data:image/')) return false;
            return true;
          });
          if (imgsInTurn.length > 0) {
            candidateImgs = imgsInTurn;
            break;
          }
        }
      }

      // Fallback nếu AI Studio dùng container chung cho phản hồi
      if (candidateImgs.length === 0) {
        document.querySelectorAll('ms-prompt-editor img, main img').forEach((img) => {
          if (img.closest('#ai-studio-root, ms-starter-prompts, ms-gallery, aside, header, nav')) return;
          const src = img.src || img.getAttribute('src') || '';
          if (!src || src.startsWith('chrome-extension:') || src.includes('favicon') || src.includes('avatar')) return;
          if (img.naturalWidth < 120 && img.width < 120 && !src.startsWith('data:image/')) return false;
          candidateImgs.push(img);
        });
      }

      // Duyệt từ ảnh mới nhất
      for (let idx = candidateImgs.length - 1; idx >= 0; idx--) {
        const img = candidateImgs[idx];
        const src = img.src || img.getAttribute('src') || '';

        if (src && !beforeSendSrcs.has(src)) {
          // Đảm bảo ảnh đã tải xong hoàn chỉnh
          if (img.complete && (img.naturalWidth > 120 || src.startsWith('data:image/'))) {
            // Chờ thêm 1.2s để AI Studio kết thúc lượt tạo
            await new Promise((r) => setTimeout(r, 1200));
            return {
              id: 'img_dom_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
              mimeType: src.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
              base64: src.startsWith('data:') ? src.split(',')[1] : null,
              dataUrl: src,
              prompt: currentPrompt,
              timestamp: Date.now(),
              account: getActiveGoogleAccountInfo().displayName,
              sizeApprox: 0
            };
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    return null;
  }

  // 8. Helper Download Image
  function triggerImageDownload(img) {
    const cleanPrompt = (img.prompt || 'ai_image')
      .slice(0, 35)
      .replace(/[^a-zA-Z0-9]/g, '_');
    const filename = 'ai_studio_' + cleanPrompt + '_' + Date.now() + '.png';

    try {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGE',
        dataUrl: img.dataUrl,
        filename
      });
    } catch (e) {
      const a = document.createElement('a');
      a.href = img.dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  // 9. Render Gallery
  function renderGallery() {
    const container = document.getElementById('gallery-grid-container');
    const tabCount = document.getElementById('tab-gallery-count');
    if (tabCount) tabCount.innerText = capturedImages.length;
    if (!container) return;

    if (capturedImages.length === 0) {
      container.innerHTML = `
        <div class="empty-placeholder" style="grid-column: 1 / -1;">
          <span class="empty-icon">🖼️</span>
          <p>Chưa có ảnh nào được sinh trong phiên này.</p>
          <span style="font-size:11px; color:#64748b;">Nhập prompt ở Tab "Tạo Ảnh Hàng Loạt" và bấm "Bắt Đầu Tạo Ảnh"!</span>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    capturedImages.forEach((img) => {
      const card = document.createElement('div');
      card.className = 'gallery-item';
      card.innerHTML = `
        <div class="gallery-thumb-wrap" title="Bấm để xem ảnh phóng to">
          <img src="${img.dataUrl}" alt="Generated Image" loading="lazy" />
        </div>
        <div class="gallery-item-info">
          <div class="gallery-item-prompt" title="${img.prompt || 'Không có prompt'}">${img.prompt || 'Không có prompt'}</div>
          <div class="gallery-item-actions">
            <button class="btn-thumb-action btn-dl-img" title="Tải ảnh PNG">📥 Tải về</button>
            <button class="btn-thumb-action btn-copy-prompt" title="Sao chép prompt">📋 Prompt</button>
          </div>
        </div>
      `;

      card.querySelector('.gallery-thumb-wrap').addEventListener('click', () => openLightbox(img));
      card.querySelector('.btn-dl-img').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerImageDownload(img);
      });
      card.querySelector('.btn-copy-prompt').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(img.prompt || '');
        alert('Đã copy prompt vào clipboard!');
      });

      container.appendChild(card);
    });
  }

  function openLightbox(img) {
    const lb = document.getElementById('ai-studio-lightbox');
    const lbImg = document.getElementById('lightbox-img');
    const lbPrompt = document.getElementById('lightbox-prompt');
    const btnDl = document.getElementById('btn-lightbox-download');
    const btnCopy = document.getElementById('btn-lightbox-copy-b64');

    lbImg.src = img.dataUrl;
    lbPrompt.innerText = (img.prompt || 'AI Studio Generated Image') + (img.account ? ' (' + img.account + ')' : '');

    btnDl.onclick = () => triggerImageDownload(img);
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(img.base64 || img.dataUrl);
      alert('Đã copy dữ liệu Base64 ảnh vào clipboard!');
    };

    lb.classList.add('active');
  }

  // 10. Render API List & Detail (Kèm nút dùng Request làm Template)
  function renderApiList(searchQuery = '') {
    const listEl = document.getElementById('api-items-list');
    const tabApiCount = document.getElementById('tab-api-count');
    if (tabApiCount) tabApiCount.innerText = capturedRequests.length;
    if (!listEl) return;

    const filtered = capturedRequests.filter((req) => {
      if (!searchQuery) return true;
      const text = (req.url + ' ' + (req.prompt || '') + ' ' + (req.statusText || '')).toLowerCase();
      return text.includes(searchQuery);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="empty-placeholder">
          <span class="empty-icon">📡</span>
          <p>Chưa bắt được request nào phù hợp.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    filtered.forEach((req) => {
      const row = document.createElement('div');
      row.className = 'api-row ' + (selectedRequestId === req.id ? 'selected' : '');
      const isOk = req.status >= 200 && req.status < 300;
      const dateStr = new Date(req.timestamp).toLocaleTimeString();

      row.innerHTML = `
        <div class="api-row-top">
          <span class="api-badge-method ${req.method}">${req.method}</span>
          <span class="api-badge-status ${isOk ? 'status-ok' : 'status-err'}">${req.status || 'ERR'} ${req.duration ? req.duration + 'ms' : ''}</span>
        </div>
        <div class="api-row-url" title="${req.url}">${req.url.replace(/^https?:\/\/[^/]+/, '')}</div>
        <div class="api-row-time">${dateStr} ${req.prompt ? '• ' + req.prompt.substring(0, 30) + '...' : ''}</div>
      `;

      row.addEventListener('click', () => {
        selectedRequestId = req.id;
        renderApiList(searchQuery);
        renderApiDetail(req);
      });

      listEl.appendChild(row);
    });
  }

  function renderApiDetail(req) {
    const detailEl = document.getElementById('api-detail-view');
    if (!detailEl) return;

    const curlCmd = generateCurlCommand(req);

    detailEl.innerHTML = `
      <div class="api-detail-content">
        <div class="detail-header-actions" style="flex-wrap: wrap;">
          <button id="btn-use-as-template" class="btn-header" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #fff; font-weight: 700;">📌 Lưu Request Này Làm Template</button>
          <button id="btn-copy-curl" class="btn-header">📋 Copy cURL</button>
          <button id="btn-copy-payload" class="btn-header">📦 Copy Payload</button>
          <button id="btn-copy-response" class="btn-header">📥 Copy Response</button>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Endpoint URL</div>
          <div class="code-box">${req.url}</div>
        </div>

        ${req.prompt ? `
        <div class="detail-section">
          <div class="detail-section-title">Prompt phát hiện được</div>
          <div class="code-box" style="color: #6ee7b7; font-weight: 600;">${req.prompt}</div>
        </div>` : ''}

        <div class="detail-section">
          <div class="detail-section-title">cURL Command</div>
          <div class="code-box">${curlCmd}</div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Request Headers</div>
          <div class="code-box">${JSON.stringify(req.headers || {}, null, 2)}</div>
        </div>

        <div class="detail-section">
          <div class="detail-section-title">Request Body (Payload)</div>
          <div class="code-box">${JSON.stringify(req.body || {}, null, 2)}</div>
        </div>
      </div>
    `;

    document.getElementById('btn-use-as-template')?.addEventListener('click', () => {
      saveAccountTemplateManually({
        url: req.url,
        method: req.method,
        headers: req.headers,
        bodySample: req.body,
        capturedAt: Date.now(),
        prompt: req.prompt
      });
      alert('✅ Đã lưu request [' + (req.url.split('/').pop().split('?')[0] || req.url) + '] làm Template tạo ảnh và Auth thành công!');
    });

    document.getElementById('btn-copy-curl')?.addEventListener('click', () => {
      navigator.clipboard.writeText(curlCmd);
      alert('Đã copy lệnh cURL vào clipboard!');
    });
    document.getElementById('btn-copy-payload')?.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(req.body || {}, null, 2));
      alert('Đã copy Payload vào clipboard!');
    });
    document.getElementById('btn-copy-response')?.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(req.response || {}, null, 2));
      alert('Đã copy Response vào clipboard!');
    });
  }

  function generateCurlCommand(req) {
    const parts = ["curl '" + req.url + "'"];
    parts.push("-X '" + req.method + "'");
    if (req.headers) {
      Object.keys(req.headers).forEach((k) => {
        parts.push("-H '" + k + ": " + req.headers[k] + "'");
      });
    }
    if (req.body) {
      parts.push("--data-raw '" + JSON.stringify(req.body) + "'");
    }
    return parts.join(' \\\n  ');
  }

  function exportAllData() {
    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      url: window.location.href,
      imagesCount: capturedImages.length,
      requestsCount: capturedRequests.length,
      accountTemplatesCount: savedAccountTemplates.length,
      accountTemplates: savedAccountTemplates,
      images: capturedImages,
      requests: capturedRequests
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai_studio_export_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clearAllData() {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử API và ảnh đã lưu?')) {
      capturedRequests = [];
      capturedImages = [];
      selectedRequestId = null;
      saveData();
      renderGallery();
      renderApiList();
    }
  }

  // 11. Lắng nghe Messages từ Popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_STUDIO_PANEL') {
      ensureUI();
      const panel = document.getElementById('ai-studio-panel');
      const arrowIcon = document.getElementById('trigger-arrow-icon');
      if (panel) {
        panel.classList.remove('panel-hidden');
        isPanelOpen = true;
        if (arrowIcon) arrowIcon.innerText = '▼';
        sendResponse({ success: true });
      }
      return true;
    }

    if (message.type === 'QUICK_SUBMIT_PROMPT') {
      ensureUI();
      const prompt = message.prompt;
      if (!prompt) {
        sendResponse({ success: false, error: 'Chưa có prompt' });
        return true;
      }

      if (savedAccountTemplates.length === 0) {
        alert('Chưa có Request Template nào! Hãy tạo 1 ảnh thử trên AI Studio trước.');
        sendResponse({ success: false, error: 'Chưa có Request Template' });
        return true;
      }

      const acc = savedAccountTemplates[0];
      logBatchProgress('⚡ [Quick Prompt] Đang gửi Direct Request: "' + prompt + '"...', 'log-info');

      sendInjectedRequest('DIRECT_API_GENERATE', {
        prompt: prompt,
        template: acc.template
      })
        .then((resData) => {
          const imgs = resData.images || [];
          if (imgs.length > 0) {
          imgs.forEach((img) => {
            if (img.id && capturedImages.some((existing) => existing.id === img.id)) return;
            img.account = acc.name;
              capturedImages.unshift(img);
              triggerImageDownload(img);
            });
            saveData();
            renderGallery();
            openLightbox(imgs[0]);
          }
          sendResponse({ success: true, count: imgs.length });
        })
        .catch((err) => {
          logBatchProgress('❌ [Quick Prompt] Thất bại: ' + err.message, 'log-error');
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
  });

  // 12. Mount UI
  ensureUI();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureUI();
      setupDomImageObserver();
    });
  } else {
    setupDomImageObserver();
  }
  window.addEventListener('load', ensureUI);
  setInterval(ensureUI, 1500);
})();
