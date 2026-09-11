/**
 * Content Script - Google Flow Studio & API Bridge (Video & 0-Credit Image Generator)
 * Chịu trách nhiệm:
 * 1. Inject injected.js vào MAIN world (chống background throttling, deep fetch/XHR hook, DOM executor)
 * 2. Tự động tạo ảnh hàng loạt Nano Banana 2 Lite (0 credits) trên flow.google.com
 * 3. Quản lý Bộ sưu tập Gallery & Tự động tải ảnh về máy
 * 4. Bắt và phân loại API: Tạo Ảnh (0 credits), Tạo Video (Veo), Tạo Project, Polling
 * 5. Giữ kết nối Proxy Bridge với Canvas Studio
 */

(function () {
  const SENDER_ID = 'FLOW_API_SNIFFER';
  let capturedRequests = [];
  let capturedImages = [];
  let selectedRequestId = null;
  let activeFilter = 'all'; // 'all' | 'project' | 'video' | 'image' | 'poll' | 'other'
  let searchQuery = '';
  let isPanelOpen = false;
  let activeMainTab = window.location.hostname.includes('flow.google.com') ? 'batch-image' : 'sniffer';

  let isBatchRunning = false;
  let shouldStopBatch = false;
  let currentBatchStartTime = 0;

  // Web Audio keep-alive để không bị Chrome bóp băng thông khi chuyển sang tab khác
  let keepAliveAudioCtx = null;

  function startBackgroundKeepAlive() {
    try {
      if (!keepAliveAudioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          keepAliveAudioCtx = new AudioContext();
          const osc = keepAliveAudioCtx.createOscillator();
          const gain = keepAliveAudioCtx.createGain();
          gain.gain.value = 0.00001; // Silent, inaudible
          osc.connect(gain);
          gain.connect(keepAliveAudioCtx.destination);
          osc.start();
        }
      }
      if (keepAliveAudioCtx && keepAliveAudioCtx.state === 'suspended') {
        keepAliveAudioCtx.resume();
      }
    } catch (_) {}
  }

  function stopBackgroundKeepAlive() {
    try {
      if (keepAliveAudioCtx) {
        keepAliveAudioCtx.close();
        keepAliveAudioCtx = null;
      }
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // 1. Inject script vào MAIN World
  // -------------------------------------------------------------
  function injectMainScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected/injected.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error('[FlowSniffer] Failed to inject main script:', e);
    }
  }

  injectMainScript();

  // Đọc dữ liệu từ chrome.storage
  chrome.storage.local.get(['flow_captured_requests', 'flow_captured_images'], (res) => {
    if (res.flow_captured_requests && Array.isArray(res.flow_captured_requests)) {
      capturedRequests = res.flow_captured_requests;
    }
    if (res.flow_captured_images && Array.isArray(res.flow_captured_images)) {
      capturedImages = res.flow_captured_images;
    }
    updateUI();
    renderGallery();
  });

  function saveData() {
    chrome.storage.local.set({
      flow_captured_requests: capturedRequests.slice(0, 200),
      flow_captured_images: capturedImages.slice(0, 200)
    });
  }

  // Helper gửi request xuống injected.js
  function sendInjectedRequest(action, payload = {}) {
    return new Promise((resolve) => {
      const requestId = 'req_flow_inj_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
      let timer = null;

      const handler = (event) => {
        if (
          event.source !== window ||
          !event.data ||
          event.data.target !== 'CONTENT_TAB_EXECUTOR_RESPONSE' ||
          event.data.requestId !== requestId
        ) {
          return;
        }
        if (timer) clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(event.data);
      };

      timer = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ success: false, error: 'Hết thời gian chờ phản hồi từ Injected Script (45s)!' });
      }, 45000);

      window.addEventListener('message', handler);
      window.postMessage(
        {
          target: 'INJECTED_TAB_EXECUTOR',
          requestId,
          action,
          payload
        },
        '*'
      );
    });
  }

  // -------------------------------------------------------------
  // 2. Logic Phân loại API (Tạo Project, Tạo Ảnh, Tạo Video, etc.)
  // -------------------------------------------------------------
  function categorizeRequest(req) {
    const url = (req.url || '').toLowerCase();
    const method = (req.method || '').toUpperCase();
    const bodyStr = req.body ? JSON.stringify(req.body).toLowerCase() : '';

    // Bỏ qua các log frontend hoặc asset không cần thiết
    if (
      url.includes('.svg') ||
      url.includes('.png') ||
      url.includes('.jpg') ||
      url.includes('.woff') ||
      url.includes('google-analytics.com') ||
      url.includes('doubleclick.net') ||
      url.includes('play.google.com/log') ||
      url.includes('batchlogfrontendevents') ||
      url.includes('general.submitbatchlog')
    ) {
      return { category: 'ignore', label: 'Bỏ qua', color: '#888' };
    }

    // 1. Nhận diện API Tạo Project
    const isProjectApi =
      url.includes('project.createproject') ||
      url.includes('createproject') ||
      ((url.includes('project') || url.includes('workspace')) &&
        (method === 'POST' || method === 'PUT') &&
        (bodyStr.includes('projecttitle') || bodyStr.includes('displayname') || bodyStr.includes('title')));

    if (isProjectApi) {
      return {
        category: 'project',
        label: 'Tạo Project',
        badgeClass: 'badge-project',
        color: '#10b981',
        icon: '📁',
      };
    }

    // 2. Nhận diện API Tạo Ảnh (Nano Banana 2 Lite / Image Generation - 0 credits)
    const isImageApi =
      url.includes('ogiz0b') ||
      bodyStr.includes('ogiz0b') ||
      bodyStr.includes('harbor_seal') ||
      url.includes('batchgenerateimages') ||
      url.includes('flowmedia:batchgenerateimages') ||
      url.includes('generateimage') ||
      url.includes('image:generate') ||
      url.includes('text2image') ||
      ((url.includes('generate') || url.includes('render') || url.includes('media') || url.includes('flowmedia') || url.includes('flowworkflows')) &&
        (method === 'POST' || method === 'PUT') &&
        (bodyStr.includes('nano-banana') || bodyStr.includes('nano_banana') || bodyStr.includes('flash-lite-image') || bodyStr.includes('imagen') || bodyStr.includes('image') || (bodyStr.includes('aspectratio') && !bodyStr.includes('videomodelkey'))));

    if (isImageApi) {
      return {
        category: 'image',
        label: 'Tạo Ảnh (0 Credits)',
        badgeClass: 'badge-image',
        color: '#06b6d4',
        icon: '🖼️',
      };
    }

    // 3. Nhận diện API Tạo Video / Generate
    const isVideoApi =
      url.includes('batchasyncgeneratevideotext') ||
      url.includes('batchasyncgenerate') ||
      url.includes('generatevideo') ||
      url.includes('createvideo') ||
      url.includes('media:generate') ||
      url.includes('text2video') ||
      url.includes('image2video') ||
      url.includes('videofx') ||
      url.includes('veo') ||
      (url.includes('video:') && method === 'POST' && !url.includes('batchcheck')) ||
      ((url.includes('generate') || url.includes('render')) &&
        (method === 'POST' || method === 'PUT') &&
        (bodyStr.includes('prompt') || bodyStr.includes('aspectratio') || bodyStr.includes('videomodelkey')));

    if (isVideoApi) {
      return {
        category: 'video',
        label: 'Tạo Video / Generate',
        badgeClass: 'badge-video',
        color: '#8b5cf6',
        icon: '🎬',
      };
    }

    // 4. Nhận diện Polling / Kiểm tra tiến độ Video
    const isPollApi =
      url.includes('batchcheckasyncvideogenerationstatus') ||
      url.includes('operations/') ||
      url.includes('poll') ||
      url.includes('getoperation') ||
      (url.includes('status') && (method === 'GET' || method === 'POST')) ||
      url.includes('flowworkflows/');

    if (isPollApi) {
      return {
        category: 'poll',
        label: 'Tiến độ / Polling',
        badgeClass: 'badge-poll',
        color: '#f59e0b',
        icon: '⏳',
      };
    }

    // 5. API khác của Google Labs / Flow
    return {
      category: 'other',
      label: 'API Khác',
      badgeClass: 'badge-other',
      color: '#3b82f6',
      icon: '🌐',
    };
  }

  // Helper sinh cURL Command chuẩn
  function generateCurl(req) {
    let curl = `curl '${req.url}' \\\n`;
    curl += `  -X ${req.method} \\\n`;

    if (req.headers) {
      Object.keys(req.headers).forEach((key) => {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey !== 'content-length' &&
          lowerKey !== 'host' &&
          lowerKey !== 'connection' &&
          lowerKey !== 'sec-ch-ua' &&
          lowerKey !== 'sec-ch-ua-mobile' &&
          lowerKey !== 'sec-ch-ua-platform'
        ) {
          const val = String(req.headers[key]).replace(/'/g, "'\\''");
          curl += `  -H '${key}: ${val}' \\\n`;
        }
      });
    }

    if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
      let bodyData = '';
      if (typeof req.body === 'object') {
        bodyData = JSON.stringify(req.body);
      } else {
        bodyData = String(req.body);
      }
      bodyData = bodyData.replace(/'/g, "'\\''");
      curl += `  --data-raw '${bodyData}' \\\n`;
    }

    curl += `  --compressed`;
    return curl;
  }

  // Thêm request vào danh sách
  function addRequest(reqData) {
    const categoryInfo = categorizeRequest(reqData);
    if (categoryInfo.category === 'ignore') return;

    const enrichedReq = {
      ...reqData,
      category: categoryInfo.category,
      categoryLabel: categoryInfo.label,
      categoryBadge: categoryInfo.badgeClass,
      categoryColor: categoryInfo.color,
      categoryIcon: categoryInfo.icon,
      curl: generateCurl(reqData),
    };

    capturedRequests.unshift(enrichedReq);
    if (capturedRequests.length > 300) capturedRequests.pop();

    if (!selectedRequestId) {
      selectedRequestId = enrichedReq.id;
    }

    saveData();
    updateUI();

    // Thông báo vào Live Logs khi bắt được request API
    if (reqData.method === 'POST' || reqData.method === 'PUT') {
      const shortUrl = (reqData.url || '').replace('https://aisandbox-pa.googleapis.com', '').replace('https://labs.google', '').split('?')[0];
      if (categoryInfo.category === 'image') {
        logFlowProgress('🎯 [BẮT ĐƯỢC API TẠO ẢNH] ' + reqData.method + ' ' + shortUrl + ' (Bấm "Copy Request Cho AI" để lấy dữ liệu)', 'log-success');
      } else if (!shortUrl.includes('batchcheck') && !shortUrl.includes('batchlog') && !shortUrl.includes('clr')) {
        logFlowProgress('📡 Bắt gặp Request: [' + reqData.method + ' ' + shortUrl + ']', 'log-info');
      }
    }

    // Nếu bắt được response tạo ảnh thành công, tự động trích xuất ảnh vào Gallery
    extractImagesFromApiResponse(enrichedReq);

    // Gửi thông báo cập nhật Badge ra background
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE_COUNT',
        count: capturedRequests.length,
        projectCount: capturedRequests.filter((r) => r.category === 'project').length,
        videoCount: capturedRequests.filter((r) => r.category === 'video').length,
        imageCount: capturedRequests.filter((r) => r.category === 'image').length,
        latestRequest: enrichedReq,
      });
    } catch (_) {}
  }

  // Trích xuất URL ảnh nếu có từ API response
  function extractImagesFromApiResponse(req) {
    if (!req.response) return;
    try {
      const resStr = typeof req.response === 'object' ? JSON.stringify(req.response) : String(req.response);
      const urlMatches = resStr.match(/https:\/\/[a-zA-Z0-9_\-\.\/]+(?:googleusercontent|googleapis|flow-content\.google)[a-zA-Z0-9_\-\.\/=?&]+/g);
      if (urlMatches && urlMatches.length > 0) {
        for (let rawUrl of urlMatches) {
          const imgUrl = rawUrl.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
          if (imgUrl.includes('.svg') || imgUrl.includes('avatar') || imgUrl.includes('logo')) continue;
          if (!capturedImages.some((ci) => ci.dataUrl === imgUrl)) {
            const prompt = req.body?.prompt || req.body?.textPrompt || 'Google Flow Generated Image';
            const newImg = {
              id: 'img_api_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
              dataUrl: imgUrl,
              url: imgUrl,
              prompt,
              timestamp: Date.now(),
            };
            capturedImages.unshift(newImg);
            if (capturedImages.length > 200) capturedImages.pop();
            saveData();
            renderGallery();
          }
        }
      }
    } catch (_) {}
  }

  // Lắng nghe sự kiện từ Injected Script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.source === SENDER_ID) {
      if (event.data.type === 'API_CAPTURED') {
        addRequest(event.data.payload);
      } else if (event.data.type === 'RECAPTCHA_TOKEN_CAPTURED') {
        try {
          chrome.runtime.sendMessage({
            type: 'UPDATE_RECAPTCHA_TOKEN',
            token: event.data.token,
          });
        } catch (_) {}
      }
    }
  });

  // Lắng nghe yêu cầu từ Popup và Background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CAPTURED_REQUESTS') {
      sendResponse({ requests: capturedRequests });
    } else if (message.type === 'CLEAR_CAPTURED_REQUESTS') {
      capturedRequests = [];
      selectedRequestId = null;
      chrome.storage.local.set({ flow_captured_requests: [] });
      updateUI();
      sendResponse({ success: true });
    } else if (message.type === 'EXECUTE_IN_TAB') {
      const { requestId, action, payload, token, recaptchaToken } = message;

      const handleResponse = (event) => {
        if (
          event.source !== window ||
          !event.data ||
          event.data.target !== 'CONTENT_TAB_EXECUTOR_RESPONSE' ||
          event.data.requestId !== requestId
        ) {
          return;
        }
        window.removeEventListener('message', handleResponse);
        sendResponse(event.data);
      };

      window.addEventListener('message', handleResponse);

      window.postMessage(
        {
          target: 'INJECTED_TAB_EXECUTOR',
          requestId,
          action,
          payload,
          token,
          recaptchaToken,
        },
        '*'
      );

      return true;
    }
  });

  // -------------------------------------------------------------
  // 3. Render UI Nổi (Floating Widget & Panel)
  // -------------------------------------------------------------
  let widgetContainer = null;

  function createFloatingUI() {
    if (document.getElementById('flow-sniffer-root')) return;

    widgetContainer = document.createElement('div');
    widgetContainer.id = 'flow-sniffer-root';
    widgetContainer.innerHTML = `
      <!-- Nút Nổi (Floating Trigger Button) -->
      <div id="flow-sniffer-trigger" title="Mở Google Flow Studio (Tạo ảnh 0 Credits & Bắt API Video)">
        <div class="sniffer-icon-wrapper">
          <span class="sniffer-logo">⚡</span>
          <span class="sniffer-title">Flow Studio</span>
        </div>
        <div class="sniffer-counters">
          <span class="badge-count count-image" id="badge-count-image" title="Số ảnh đã tạo">🖼️ 0</span>
          <span class="badge-count count-video" id="badge-count-video" title="API Tạo Video">🎬 0</span>
          <span class="badge-count count-project" id="badge-count-project" title="API Tạo Project">📁 0</span>
          <span class="badge-count count-all" id="badge-count-all">0</span>
        </div>
        <button id="sniffer-toggle-btn" class="sniffer-btn-icon" title="Thu gọn / Mở rộng">▲</button>
      </div>

      <!-- Bảng Điều Khiển Chi Tiết (Full Panel) -->
      <div id="flow-sniffer-panel" class="flow-panel-hidden">
        <!-- Header -->
        <div class="panel-header">
          <div class="panel-header-left">
            <div class="panel-live-indicator"><span class="pulse-dot"></span> FLOW STUDIO ACTIVE</div>
            <h3 class="panel-title">Google Flow Studio (Video & 0-Credit Image)</h3>
          </div>
          <div class="panel-header-actions">
            <button id="btn-export-json" class="btn-action" title="Xuất toàn bộ API ra file JSON">💾 Xuất JSON</button>
            <button id="btn-clear-all" class="btn-action btn-danger" title="Xóa danh sách API">🗑️ Xóa</button>
            <button id="btn-close-panel" class="btn-action-icon" title="Đóng bảng">✕</button>
          </div>
        </div>

        <!-- Top Main Navigation -->
        <div class="panel-main-nav">
          <button class="nav-tab ${activeMainTab === 'batch-image' ? 'active' : ''}" data-main-tab="batch-image">
            🎨 Tạo Ảnh Hàng Loạt (0 Credits)
          </button>
          <button class="nav-tab ${activeMainTab === 'gallery' ? 'active' : ''}" data-main-tab="gallery">
            🖼️ Bộ Sưu Tập (<span id="tab-gallery-count">0</span>)
          </button>
          <button class="nav-tab ${activeMainTab === 'sniffer' ? 'active' : ''}" data-main-tab="sniffer">
            🎬 Video & API Sniffer
          </button>
        </div>

        <!-- TAB 1: BATCH IMAGE GENERATOR (0 CREDITS) -->
        <div class="main-tab-pane ${activeMainTab === 'batch-image' ? 'active' : ''}" id="pane-batch-image">
          <div class="batch-studio-container">
            <div class="flow-info-banner">
              <span class="info-icon">✨</span>
              <div>
                <strong>Mô hình: Nano Banana 2 Lite (gemini-3.1-flash-lite-image)</strong> — <span class="highlight-green">Generating will use 0 credits</span>. Tạo ảnh không tiêu tốn quỹ credit tháng của tài khoản PRO!
              </div>
            </div>

            <div class="form-group">
              <div class="form-label-row">
                <label for="batch-prompts-input">📝 Danh Sách Prompt (Mỗi dòng 1 ảnh):</label>
                <span class="prompt-count-tag" id="flow-prompts-count">0 prompt</span>
              </div>
              <textarea id="batch-prompts-input" class="flow-textarea" rows="4" placeholder="Dán danh sách prompt tại đây (mỗi dòng 1 ảnh)...&#10;Ví dụ:&#10;Một chú mèo cam ngồi bên cửa sổ ngày mưa, ánh sáng điện ảnh&#10;Một chú chó corgi đi dạo giữa rừng mùa thu lá vàng&#10;Một con hổ Bengal dũng mãnh đứng giữa rừng tre xanh..."></textarea>
            </div>

            <div class="flow-settings-grid">
              <div class="setting-item">
                <label>📐 Tỉ Lệ Khung Hình:</label>
                <select id="flow-aspect-ratio" class="flow-select">
                  <option value="16:9" selected>16:9 (Phong cảnh / Ngang)</option>
                  <option value="1:1">1:1 (Vuông Avatar)</option>
                  <option value="4:3">4:3 (Chuẩn)</option>
                  <option value="3:4">3:4 (Dọc vừa)</option>
                  <option value="9:16">9:16 (Dọc TikTok / Reels)</option>
                </select>
              </div>

              <div class="setting-item">
                <label>🔢 Biến Thể (0 credits):</label>
                <select id="flow-variations-count" class="flow-select">
                  <option value="1">x1 Ảnh (Nhanh)</option>
                  <option value="2" selected>x2 Ảnh (0 credits - Khuyên dùng)</option>
                  <option value="3">x3 Ảnh (0 credits)</option>
                  <option value="4">x4 Ảnh (0 credits - Tối đa)</option>
                </select>
              </div>

              <div class="setting-item">
                <label>🔁 Lặp Lại (Repeat):</label>
                <input type="number" id="flow-repeat-count" class="flow-input-number" min="1" max="10" value="1" />
              </div>

              <div class="setting-item">
                <label>⏳ Nghỉ Giữa Prompt (s):</label>
                <input type="number" id="flow-delay-sec" class="flow-input-number" min="3" max="60" value="10" title="Khuyên dùng 10-15s để chống rate limit" />
              </div>

              <div class="setting-item" style="grid-column: span 4;">
                <label>⚡ Phương Thức Thực Thi:</label>
                <select id="flow-execution-mode" class="flow-select">
                  <option value="auto" selected>⚡ Tự Động Hóa Chuẩn Google Flow (Vượt Bot 100%, Bắt Link Siêu Tốc 5s - Khuyên Dùng)</option>
                  <option value="api">🚀 Thử Nghiệm API Ẩn (Dễ bị Google chặn Bot UNUSUAL_ACTIVITY)</option>
                </select>
              </div>
            </div>

            <div class="flow-checkbox-row">
              <label class="flow-checkbox-label">
                <input type="checkbox" id="flow-auto-download" checked />
                <span>📥 Tự động tải ảnh về máy (.PNG) theo tên prompt</span>
              </label>
              <label class="flow-checkbox-label">
                <input type="checkbox" id="flow-auto-preview" />
                <span>🔍 Tự động mở xem trước khi sinh xong</span>
              </label>
            </div>

            <div class="flow-progress-container" id="flow-progress-container" style="display: none;">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="flow-progress-bar-fill"></div>
              </div>
              <div class="progress-stats">
                <span id="flow-progress-percent">0 / 0 (0%)</span>
                <span id="flow-progress-status">Đang khởi tạo...</span>
              </div>
            </div>

            <div class="flow-action-row">
              <button id="btn-flow-start-batch" class="btn-flow-primary">
                <span>🚀 Bắt Đầu Tạo Ảnh Hàng Loạt (0 Credits)</span>
              </button>
              <button id="btn-flow-stop-batch" class="btn-flow-danger" style="display: none;">
                <span>⏹️ Dừng Lại</span>
              </button>
            </div>

            <div class="flow-logs-wrapper">
              <div class="logs-header">
                <span>📋 Nhật Ký Thời Gian Thực (Live Logs)</span>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <button id="btn-copy-latest-image-request" class="btn-text-small" style="color: #38bdf8; font-weight: 600;" title="Sao chép toàn bộ request tạo ảnh bắt được để gửi cho AI">📋 Copy Request Cho AI</button>
                  <button id="btn-export-captured-json-quick" class="btn-text-small" style="color: #a78bfa; font-weight: 600;" title="Tải file JSON chứa tất cả request bắt được">📥 Xuất Log JSON</button>
                  <button id="btn-clear-flow-logs" class="btn-text-small">Xóa log</button>
                </div>
              </div>
              <div id="flow-live-logs" class="flow-logs-box">
                <div class="log-line log-info">[Hệ thống] Sẵn sàng tự động tạo ảnh Nano Banana 2 Lite trên Google Flow.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: GALLERY (BỘ SƯU TẬP) -->
        <div class="main-tab-pane ${activeMainTab === 'gallery' ? 'active' : ''}" id="pane-gallery">
          <div class="gallery-container">
            <div class="gallery-toolbar">
              <div class="gallery-stats">Tổng cộng: <strong id="gallery-total-count">0</strong> ảnh đã sinh</div>
              <div class="gallery-actions">
                <button id="btn-download-all-gallery" class="btn-action">📥 Tải tất cả</button>
                <button id="btn-clear-gallery" class="btn-action btn-danger">🗑️ Xóa gallery</button>
              </div>
            </div>
            <div class="gallery-grid" id="flow-gallery-grid"></div>
          </div>
        </div>

        <!-- TAB 3: VIDEO & API SNIFFER (CÁC TÍNH NĂNG GỐC) -->
        <div class="main-tab-pane ${activeMainTab === 'sniffer' ? 'active' : ''}" id="pane-sniffer">
          <div class="panel-toolbar">
            <div class="panel-filter-tabs">
              <button class="filter-tab active" data-filter="all">Tất cả (<span id="tab-count-all">0</span>)</button>
              <button class="filter-tab tab-image" data-filter="image">🖼️ Tạo Ảnh (<span id="tab-count-image">0</span>)</button>
              <button class="filter-tab tab-video" data-filter="video">🎬 Tạo Video (<span id="tab-count-video">0</span>)</button>
              <button class="filter-tab tab-project" data-filter="project">📁 Project (<span id="tab-count-project">0</span>)</button>
              <button class="filter-tab tab-poll" data-filter="poll">⏳ Tiến độ (<span id="tab-count-poll">0</span>)</button>
              <button class="filter-tab tab-other" data-filter="other">🌐 Khác (<span id="tab-count-other">0</span>)</button>
            </div>
            <div style="display:flex; gap:8px;">
              <button id="btn-grab-recaptcha" class="btn-action" style="background:#4f46e5; border-color:#6366f1; white-space:nowrap;" title="Tạo mã reCAPTCHA mới cho Canvas Studio">⚡ Token reCAPTCHA</button>
              <input type="text" id="sniffer-search-input" placeholder="🔍 Tìm kiếm URL, payload, prompt..." />
            </div>
          </div>

          <div class="panel-body">
            <div class="request-list-pane" id="request-list-container">
              <div class="empty-state" id="list-empty-state">
                <div class="empty-icon">📡</div>
                <p>Chưa bắt được request nào.</p>
                <span class="empty-sub">Hãy thực hiện thao tác tạo ảnh, video hoặc project trên Flow!</span>
              </div>
              <div class="request-items" id="request-items-list"></div>
            </div>

            <div class="request-detail-pane" id="request-detail-container">
              <div class="empty-detail" id="detail-empty-state">
                <p>👈 Chọn 1 request từ danh sách để xem chi tiết & lấy cURL</p>
              </div>
              <div class="detail-content" id="detail-content-box" style="display: none;">
                <div class="detail-action-bar">
                  <div class="detail-info-main">
                    <span id="detail-method" class="method-tag">POST</span>
                    <span id="detail-status" class="status-tag">200</span>
                    <span id="detail-category-badge" class="category-badge">🎬 Tạo Video</span>
                    <span id="detail-duration" class="time-tag">120ms</span>
                  </div>
                  <div class="detail-copy-buttons">
                    <button id="btn-copy-curl" class="btn-copy btn-primary-copy" title="Copy cURL">📋 cURL</button>
                    <button id="btn-copy-payload" class="btn-copy" title="Copy Body JSON">📦 Payload</button>
                    <button id="btn-copy-response" class="btn-copy" title="Copy Response JSON">📥 Response</button>
                    <button id="btn-copy-token" class="btn-copy" title="Copy Token">🔑 Token</button>
                  </div>
                </div>

                <div class="detail-url-box">
                  <span class="url-label">URL:</span>
                  <input type="text" id="detail-full-url" readonly />
                  <button id="btn-copy-url" class="btn-icon-copy" title="Copy URL">📋</button>
                </div>

                <div class="detail-tabs">
                  <button class="detail-tab-btn active" data-tab="payload">📦 Request Body</button>
                  <button class="detail-tab-btn" data-tab="response">📥 Response</button>
                  <button class="detail-tab-btn" data-tab="headers">🔑 Headers</button>
                  <button class="detail-tab-btn" data-tab="curl">💻 cURL Command</button>
                </div>

                <div class="detail-tab-content active" id="tab-content-payload">
                  <pre class="json-code-block"><code id="code-payload"></code></pre>
                </div>
                <div class="detail-tab-content" id="tab-content-response">
                  <pre class="json-code-block"><code id="code-response"></code></pre>
                </div>
                <div class="detail-tab-content" id="tab-content-headers">
                  <div class="headers-tables">
                    <h4>Request Headers</h4>
                    <table class="headers-table" id="table-req-headers"></table>
                    <h4 style="margin-top: 12px;">Response Headers</h4>
                    <table class="headers-table" id="table-res-headers"></table>
                  </div>
                </div>
                <div class="detail-tab-content" id="tab-content-curl">
                  <pre class="json-code-block"><code id="code-curl"></code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Lightbox xem trước ảnh phóng to -->
      <div id="flow-image-lightbox" class="flow-lightbox">
        <div class="flow-lightbox-backdrop"></div>
        <div class="flow-lightbox-content">
          <button class="flow-lightbox-close" id="btn-close-lightbox">✕</button>
          <img id="flow-lightbox-img" src="" alt="Preview" />
          <div class="flow-lightbox-info">
            <p id="flow-lightbox-prompt"></p>
            <div class="flow-lightbox-buttons">
              <button id="btn-lightbox-download" class="btn-copy btn-primary-copy">📥 Tải Ảnh</button>
              <button id="btn-lightbox-copy-prompt" class="btn-copy">📋 Copy Prompt</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(widgetContainer);
    setupEvents();
  }

  // Helper ghi log tiến trình Batch
  function logFlowProgress(msg, type = 'log-info') {
    const box = document.getElementById('flow-live-logs');
    if (!box) return;
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'log-line ' + type;
    div.innerText = '[' + time + '] ' + msg;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  // -------------------------------------------------------------
  // 4. Batch Image Generation Runner (Tạo ảnh hàng loạt 0 Credits)
  // -------------------------------------------------------------
  async function startBatchImageGeneration() {
    const input = (document.getElementById('batch-prompts-input')?.value || '').trim();
    if (!input) {
      alert('Vui lòng nhập ít nhất 1 câu prompt để bắt đầu tạo ảnh!');
      return;
    }

    const lines = input.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const repeatCount = parseInt(document.getElementById('flow-repeat-count')?.value, 10) || 1;
    const delaySec = parseInt(document.getElementById('flow-delay-sec')?.value, 10) || 10;
    const aspectRatio = document.getElementById('flow-aspect-ratio')?.value || '16:9';
    const variationsCount = parseInt(document.getElementById('flow-variations-count')?.value, 10) || 2;

    const taskQueue = [];
    lines.forEach((promptLine) => {
      for (let r = 0; r < repeatCount; r++) {
        taskQueue.push({ prompt: promptLine, index: r + 1, totalRepeats: repeatCount, aspectRatio, count: variationsCount });
      }
    });

    isBatchRunning = true;
    shouldStopBatch = false;
    currentBatchStartTime = Date.now();
    startBackgroundKeepAlive();

    const btnStart = document.getElementById('btn-flow-start-batch');
    const btnStop = document.getElementById('btn-flow-stop-batch');
    const progressContainer = document.getElementById('flow-progress-container');
    const progressBar = document.getElementById('flow-progress-bar-fill');
    const progressText = document.getElementById('flow-progress-percent');
    const progressStatus = document.getElementById('flow-progress-status');

    if (btnStart) btnStart.style.display = 'none';
    if (btnStop) btnStop.style.display = 'inline-flex';
    if (progressContainer) progressContainer.style.display = 'flex';

    logFlowProgress('🚀 BẮT ĐẦU TẠO ' + taskQueue.length + ' LƯỢT ẢNH (Mô hình: Nano Banana 2 Lite - 0 credits)...', 'log-info');

    let completed = 0;
    for (let i = 0; i < taskQueue.length; i++) {
      if (shouldStopBatch) {
        logFlowProgress('⏹️ Người dùng đã dừng tiến trình tạo ảnh.', 'log-warn');
        break;
      }

      const task = taskQueue[i];
      logFlowProgress('[#' + (i + 1) + '/' + taskQueue.length + '] Gửi prompt: "' + task.prompt + '" (Tỉ lệ: ' + task.aspectRatio + ', Số lượng: x' + task.count + ')...', 'log-info');
      if (progressStatus) progressStatus.innerText = 'Đang tạo lượt #' + (i + 1) + '...';

      try {
        const executionMode = document.getElementById('flow-execution-mode')?.value || 'auto';
        let newImages = [];

        if (executionMode === 'api') {
          logFlowProgress('⚡ Đang gửi request API ẩn trực tiếp (Google Flow BOQ ogiZ0b - 0 credits)...', 'log-info');
          const apiRes = await sendInjectedRequest('GENERATE_IMAGE', {
            prompt: task.prompt,
            aspectRatio: task.aspectRatio,
            count: task.count
          });

          if (apiRes && apiRes.success && apiRes.data?.images && apiRes.data.images.length > 0) {
            newImages = apiRes.data.images;
            logFlowProgress('📡 ✨ API ẩn phản hồi thành công ' + newImages.length + ' ảnh trực tiếp!', 'log-success');
          } else {
            const warnMsg = apiRes?.error || 'Google Flow từ chối request API ẩn';
            logFlowProgress('ℹ️ API trực tiếp bị chặn (' + warnMsg + '). Tự động tạo bằng luồng Google Flow...', 'log-info');
            newImages = await executeViaDom(task);
          }
        } else {
          // Chế độ Auto (Khuyên dùng)
          logFlowProgress('⚡ Đang tự động tạo ảnh chuẩn Google Flow (Vượt Bot 100%)...', 'log-info');
          newImages = await executeViaDom(task);
        }

        if (newImages && newImages.length > 0) {
          logFlowProgress('🎨 ✨ TẠO THÀNH CÔNG ' + newImages.length + ' ẢNH CHO: "' + task.prompt + '"!', 'log-success');

          for (const newImgObj of newImages) {
            if (!capturedImages.some((ci) => ci.dataUrl === newImgObj.dataUrl)) {
              capturedImages.unshift(newImgObj);
            }
            if (document.getElementById('flow-auto-download')?.checked) {
              logFlowProgress('📥 Tự động tải ảnh về máy (.PNG)...', 'log-info');
              triggerFlowImageDownload(newImgObj);
            }
          }

          if (capturedImages.length > 200) capturedImages.splice(200);
          saveData();
          renderGallery();

          if (document.getElementById('flow-auto-preview')?.checked && newImages[0]) {
            openLightbox(newImages[0]);
          }

          completed++;
        } else {
          throw new Error('Google Flow chưa hoàn thành sinh ảnh trong thời gian quy định.');
        }

        const pct = Math.round((completed / taskQueue.length) * 100);
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.innerText = completed + ' / ' + taskQueue.length + ' (' + pct + '%)';

        if (i < taskQueue.length - 1 && !shouldStopBatch && delaySec > 0) {
          logFlowProgress('⏳ Nghỉ ' + delaySec + 's trước lượt tiếp theo (chống rate limit)...', 'log-info');
          await new Promise((r) => setTimeout(r, delaySec * 1000));
        }
      } catch (err) {
        logFlowProgress('❌ [#' + (i + 1) + '] Thất bại: ' + err.message, 'log-error');
      }
    }

    isBatchRunning = false;
    stopBackgroundKeepAlive();
    if (btnStart) btnStart.style.display = 'inline-flex';
    if (btnStop) btnStop.style.display = 'none';
    if (progressStatus) progressStatus.innerText = 'Hoàn thành';
    logFlowProgress('🎉 HOÀN THÀNH PHIÊN TẠO ẢNH! Đã tạo xong ' + completed + '/' + taskQueue.length + ' lượt.', 'log-success');
  }

  function stopBatchImageGeneration() {
    shouldStopBatch = true;
    stopBackgroundKeepAlive();
    logFlowProgress('⏳ Đang dừng sau lượt hiện tại...', 'log-warn');
  }

  // Trích xuất link ảnh đầy đủ từ gói tin BOQ (ogiZ0b)
  function extractImagesFromBoqResponse(rawText, promptText) {
    const images = [];
    if (!rawText) return images;

    try {
      const cleaned = String(rawText).replace(/^\)\]\}'\s*/, '');
      const lines = cleaned.split('\n');
      for (const line of lines) {
        if (/^\d+$/.test(line.trim())) continue;
        try {
          const chunk = JSON.parse(line);
          for (const item of chunk) {
            if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === 'ogiZ0b' && item[2]) {
              const inner = JSON.parse(item[2]);
              if (inner && inner[0] && Array.isArray(inner[0])) {
                for (const genWrap of inner[0]) {
                  const mediaId = genWrap[0] || genWrap[2];
                  const genDetails = genWrap[6]?.[0];
                  const directUrl = genDetails?.[13];
                  const translated = genDetails?.[7];
                  if (directUrl && typeof directUrl === 'string' && directUrl.startsWith('http')) {
                    images.push({
                      id: mediaId || ('img_' + Math.random().toString(36).substr(2, 9)),
                      url: directUrl,
                      dataUrl: directUrl,
                      prompt: promptText || translated,
                      translatedPrompt: translated,
                      timestamp: Date.now()
                    });
                  }
                }
              }
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    // Fallback: Quét unescaped string để lấy trọn vẹn URL signed có Expires, Signature
    if (images.length === 0) {
      try {
        const unescaped = String(rawText)
          .replace(/\\u003d/g, '=')
          .replace(/\\u0026/g, '&')
          .replace(/\\\//g, '/');
        const matches = unescaped.match(/https:\/\/flow-content\.google\/image\/[^"'\\s\<\>]+/g);
        if (matches && matches.length > 0) {
          const cleanUrls = [...new Set(matches)];
          cleanUrls.forEach((u, idx) => {
            images.push({
              id: 'img_net_' + Date.now() + '_' + idx,
              url: u,
              dataUrl: u,
              prompt: promptText,
              timestamp: Date.now()
            });
          });
        }
      } catch (_) {}
    }

    return images;
  }

  // Chờ ảnh sinh từ luồng mạng (network sniffer) - Chỉ mất 5-10s
  function waitForImageFromNetwork(promptText, timeoutMs = 45000) {
    return new Promise((resolve) => {
      let resolved = false;
      const handler = (event) => {
        if (event.source !== window || !event.data || event.data.source !== SENDER_ID) return;
        if (event.data.type === 'API_CAPTURED' && event.data.payload?.url?.includes('ogiZ0b')) {
          const resRaw = event.data.payload.response;
          const resStr = typeof resRaw === 'object' ? JSON.stringify(resRaw) : String(resRaw || '');
          if (resStr.includes('flow-content.google/image/')) {
            const extracted = extractImagesFromBoqResponse(resStr, promptText);
            if (extracted && extracted.length > 0) {
              cleanup();
              resolve(extracted);
            }
          }
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve([]);
      }, timeoutMs);

      function cleanup() {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
      }

      window.addEventListener('message', handler);
    });
  }

  // Thực thi thông qua giao diện DOM kết hợp hứng ảnh mạng siêu tốc
  async function executeViaDom(task) {
    const beforeSendSrcs = new Set();
    document.querySelectorAll('img').forEach((img) => {
      if (img.closest && img.closest('#flow-sniffer-root')) return;
      const s = img.src || img.getAttribute('src') || '';
      if (s) beforeSendSrcs.add(s);
    });

    const netPromise = waitForImageFromNetwork(task.prompt, 40000);

    const res = await sendInjectedRequest('FLOW_DOM_SUBMIT_IMAGE', {
      prompt: task.prompt,
      aspectRatio: task.aspectRatio,
      count: task.count
    });

    if (res && res.error) {
      throw new Error(res.error);
    }

    logFlowProgress('⏳ Đã gửi prompt, đang chờ Google Flow sinh ảnh...', 'log-info');

    // 1. Ưu tiên lấy trực tiếp từ phản hồi API mạng (chỉ 5-8 giây!)
    const netImages = await netPromise;
    if (netImages && netImages.length > 0) {
      return netImages;
    }

    // 2. Dự phòng quét DOM nếu gói tin mạng chưa bắt kịp
    return await waitForNewFlowImages(beforeSendSrcs, task.prompt, 20000);
  }

  // Hàm chờ ảnh MỚI thực sự xuất hiện trên Google Flow
  async function waitForNewFlowImages(beforeSendSrcs, currentPrompt, timeoutMs = 120000) {
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 2500));

    while (Date.now() - started < timeoutMs) {
      if (shouldStopBatch) return [];

      // Kiểm tra xem trang có báo lỗi Rate limit hoặc Quota không
      const errorText = Array.from(document.querySelectorAll('div, span, p')).find((el) => {
        if (el.closest && el.closest('#flow-sniffer-root')) return false;
        const text = (el.innerText || '').toLowerCase();
        return text.includes('rate limit') || text.includes('quota exceeded') || text.includes('try again later');
      });

      if (errorText) {
        throw new Error('Google Flow báo chạm Rate limit: ' + errorText.innerText.trim());
      }

      // Quét tất cả ảnh trên trang
      const allImgs = Array.from(document.querySelectorAll('img')).filter((img) => {
        if (img.closest && img.closest('#flow-sniffer-root, header, nav')) return false;
        const src = img.src || img.getAttribute('src') || '';
        if (!src || src.startsWith('chrome-extension:') || src.includes('avatar') || src.includes('favicon') || src.includes('google-logo')) return false;
        if (img.naturalWidth < 100 && img.width < 100 && !src.startsWith('data:image/')) return false;
        return true;
      });

      const newFound = [];
      for (const img of allImgs) {
        const src = img.src || img.getAttribute('src') || '';
        if (src && !beforeSendSrcs.has(src)) {
          if (img.complete && (img.naturalWidth > 100 || src.startsWith('data:image/'))) {
            newFound.push({
              id: 'img_flow_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
              dataUrl: src,
              url: src,
              prompt: currentPrompt,
              timestamp: Date.now()
            });
          }
        }
      }

      if (newFound.length > 0) {
        await new Promise((r) => setTimeout(r, 1200));
        return newFound;
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    return [];
  }

  // Tải ảnh về máy
  function triggerFlowImageDownload(img) {
    const cleanPrompt = (img.prompt || 'flow_image')
      .slice(0, 35)
      .trim()
      .replace(/[\\/*?:"<>|]/g, '_')
      .replace(/\s+/g, '_');
    const filename = `Flow_${cleanPrompt}_${Date.now().toString().slice(-4)}.png`;

    try {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGE',
        url: img.dataUrl || img.url,
        filename
      }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          downloadViaAnchor(img.dataUrl || img.url, filename);
        }
      });
    } catch (_) {
      downloadViaAnchor(img.dataUrl || img.url, filename);
    }
  }

  function downloadViaAnchor(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 2000);
  }

  // -------------------------------------------------------------
  // 5. Gallery & Lightbox
  // -------------------------------------------------------------
  function renderGallery() {
    const grid = document.getElementById('flow-gallery-grid');
    const countEl = document.getElementById('gallery-total-count');
    const tabCountEl = document.getElementById('tab-gallery-count');
    const triggerImgCount = document.getElementById('badge-count-image');

    if (countEl) countEl.innerText = capturedImages.length;
    if (tabCountEl) tabCountEl.innerText = capturedImages.length;
    if (triggerImgCount) triggerImgCount.innerText = `🖼️ ${capturedImages.length}`;

    if (!grid) return;

    if (capturedImages.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; display:flex;">
          <div class="empty-icon">🖼️</div>
          <p>Chưa có ảnh nào được tạo.</p>
          <span class="empty-sub">Hãy nhập prompt ở tab "Tạo Ảnh Hàng Loạt" để bắt đầu!</span>
        </div>
      `;
      return;
    }

    grid.innerHTML = capturedImages.map((img) => `
      <div class="flow-gallery-card" data-id="${img.id}">
        <img src="${img.dataUrl || img.url}" class="flow-gallery-thumb" alt="${escapeHtml(img.prompt || 'Image')}" loading="lazy" />
        <div class="flow-gallery-meta">
          <div class="flow-gallery-prompt" title="${escapeHtml(img.prompt || '')}">${escapeHtml(img.prompt || 'Untitled')}</div>
          <div class="flow-gallery-card-actions">
            <button class="btn-card-action btn-card-download" data-id="${img.id}">📥 Tải về</button>
            <button class="btn-card-action btn-card-view" data-id="${img.id}">🔍 Xem to</button>
          </div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.flow-gallery-thumb, .btn-card-view').forEach((el) => {
      el.addEventListener('click', (e) => {
        const card = e.currentTarget.closest('.flow-gallery-card');
        const id = card?.getAttribute('data-id');
        const img = capturedImages.find((item) => item.id === id);
        if (img) openLightbox(img);
      });
    });

    grid.querySelectorAll('.btn-card-download').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const img = capturedImages.find((item) => item.id === id);
        if (img) triggerFlowImageDownload(img);
      });
    });
  }

  let currentLightboxImg = null;

  function openLightbox(img) {
    currentLightboxImg = img;
    const lb = document.getElementById('flow-image-lightbox');
    const lbImg = document.getElementById('flow-lightbox-img');
    const lbPrompt = document.getElementById('flow-lightbox-prompt');
    if (!lb || !lbImg || !lbPrompt) return;

    lbImg.src = img.dataUrl || img.url;
    lbPrompt.innerText = img.prompt || 'Google Flow Generated Image';
    lb.classList.add('active');
  }

  function closeLightbox() {
    const lb = document.getElementById('flow-image-lightbox');
    if (lb) lb.classList.remove('active');
  }

  // -------------------------------------------------------------
  // 6. Gán sự kiện UI
  // -------------------------------------------------------------
  function setupEvents() {
    const trigger = document.getElementById('flow-sniffer-trigger');
    const panel = document.getElementById('flow-sniffer-panel');
    const toggleBtn = document.getElementById('sniffer-toggle-btn');
    const closeBtn = document.getElementById('btn-close-panel');
    const clearBtn = document.getElementById('btn-clear-all');
    const exportBtn = document.getElementById('btn-export-json');
    const searchInput = document.getElementById('sniffer-search-input');

    // Mở / Đóng Panel
    const togglePanel = () => {
      isPanelOpen = !isPanelOpen;
      if (isPanelOpen) {
        panel.classList.remove('flow-panel-hidden');
        toggleBtn.textContent = '▼';
      } else {
        panel.classList.add('flow-panel-hidden');
        toggleBtn.textContent = '▲';
      }
    };

    trigger.addEventListener('click', (e) => {
      if (e.target.closest('#sniffer-toggle-btn') || !isPanelOpen) {
        togglePanel();
      }
    });

    closeBtn.addEventListener('click', () => {
      isPanelOpen = false;
      panel.classList.add('flow-panel-hidden');
      toggleBtn.textContent = '▲';
    });

    // Top Main Tabs Navigation
    document.querySelectorAll('.panel-main-nav .nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-main-nav .nav-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.main-tab-pane').forEach((p) => p.classList.remove('active'));

        tab.classList.add('active');
        const targetTab = tab.getAttribute('data-main-tab');
        activeMainTab = targetTab;
        const targetPane = document.getElementById(`pane-${targetTab}`);
        if (targetPane) targetPane.classList.add('active');

        if (targetTab === 'gallery') renderGallery();
      });
    });

    // Batch Prompts Counter
    const promptsInput = document.getElementById('batch-prompts-input');
    const promptsCountTag = document.getElementById('flow-prompts-count');
    if (promptsInput && promptsCountTag) {
      promptsInput.addEventListener('input', () => {
        const count = promptsInput.value.split('\n').filter((l) => l.trim().length > 0).length;
        promptsCountTag.innerText = `${count} prompt`;
      });
    }

    // Nút Bắt Đầu / Dừng Batch
    const btnStart = document.getElementById('btn-flow-start-batch');
    const btnStop = document.getElementById('btn-flow-stop-batch');
    if (btnStart) btnStart.addEventListener('click', startBatchImageGeneration);
    if (btnStop) btnStop.addEventListener('click', stopBatchImageGeneration);

    // Nút Xóa Log Batch
    const btnClearLogs = document.getElementById('btn-clear-flow-logs');
    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', () => {
        const box = document.getElementById('flow-live-logs');
        if (box) box.innerHTML = '';
      });
    }

    // Gallery Actions
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

    const btnDownloadAll = document.getElementById('btn-download-all-gallery');
    if (btnDownloadAll) {
      btnDownloadAll.addEventListener('click', () => {
        if (capturedImages.length === 0) {
          alert('Không có ảnh nào để tải!');
          return;
        }
        logFlowProgress('📥 Đang tải tuần tự ' + capturedImages.length + ' ảnh...', 'log-info');
        capturedImages.forEach((img, idx) => {
          setTimeout(() => triggerFlowImageDownload(img), idx * 400);
        });
      });
    }

    // Lightbox events
    const btnCloseLb = document.getElementById('btn-close-lightbox');
    const lbBackdrop = document.querySelector('.flow-lightbox-backdrop');
    if (btnCloseLb) btnCloseLb.addEventListener('click', closeLightbox);
    if (lbBackdrop) lbBackdrop.addEventListener('click', closeLightbox);

    const btnLbDownload = document.getElementById('btn-lightbox-download');
    if (btnLbDownload) {
      btnLbDownload.addEventListener('click', () => {
        if (currentLightboxImg) triggerFlowImageDownload(currentLightboxImg);
      });
    }

    const btnLbCopyPrompt = document.getElementById('btn-lightbox-copy-prompt');
    if (btnLbCopyPrompt) {
      btnLbCopyPrompt.addEventListener('click', () => {
        if (currentLightboxImg?.prompt) {
          navigator.clipboard.writeText(currentLightboxImg.prompt);
          btnLbCopyPrompt.innerText = '✅ Đã Copy!';
          setTimeout(() => (btnLbCopyPrompt.innerText = '📋 Copy Prompt'), 1500);
        }
      });
    }

    // Xóa tất cả API
    clearBtn.addEventListener('click', () => {
      if (confirm('Bạn có chắc chắn muốn xóa danh sách API đã bắt?')) {
        capturedRequests = [];
        selectedRequestId = null;
        chrome.storage.local.set({ flow_captured_requests: [] });
        updateUI();
      }
    });

    // Nút kích hoạt lấy reCAPTCHA Token với User Activation
    const grabRecaptchaBtn = document.getElementById('btn-grab-recaptcha');
    if (grabRecaptchaBtn) {
      grabRecaptchaBtn.addEventListener('click', () => {
        grabRecaptchaBtn.innerText = '⏳ Đang nạp...';
        window.postMessage(
          {
            target: 'INJECTED_TAB_EXECUTOR',
            action: 'TRIGGER_RECAPTCHA',
            requestId: 'req_recaptcha_click_' + Date.now(),
          },
          '*'
        );
        setTimeout(() => {
          grabRecaptchaBtn.innerText = '✅ Đã Lấy Token!';
          setTimeout(() => {
            grabRecaptchaBtn.innerText = '⚡ Token reCAPTCHA';
          }, 2000);
        }, 800);
      });
    }

    // Xuất JSON
    exportBtn.addEventListener('click', () => {
      if (capturedRequests.length === 0) {
        alert('Chưa có dữ liệu API để xuất!');
        return;
      }
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(capturedRequests, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `Google_Flow_APIs_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });

    // Nút copy request tạo ảnh mới nhất gửi cho AI
    const btnCopyLatestImgReq = document.getElementById('btn-copy-latest-image-request');
    if (btnCopyLatestImgReq) {
      btnCopyLatestImgReq.addEventListener('click', () => {
        if (capturedRequests.length === 0) {
          alert('Chưa bắt được request nào. Bạn hãy F5 và thao tác tạo ảnh thử 1 lần trên Flow!');
          return;
        }

        const targetReq =
          capturedRequests.find((r) => r.category === 'image') ||
          capturedRequests.find((r) => r.method === 'POST' && (r.url.includes('aisandbox') || r.url.includes('flow') || r.url.includes('labs'))) ||
          capturedRequests[0];

        const exportData = {
          capturedTime: new Date(targetReq.timestamp).toLocaleString(),
          url: targetReq.url,
          method: targetReq.method,
          category: targetReq.category,
          headers: targetReq.headers,
          body: targetReq.body,
          response: targetReq.response,
          curl: targetReq.curl
        };

        navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
          btnCopyLatestImgReq.innerText = '✅ Đã Copy!';
          logFlowProgress('📋 Đã copy toàn bộ dữ liệu request: [' + targetReq.method + ' ' + targetReq.url.split('?')[0] + ']. Bạn hãy dán (Ctrl+V) vào chat nhé!', 'log-success');
          setTimeout(() => (btnCopyLatestImgReq.innerText = '📋 Copy Request Cho AI'), 2500);
        });
      });
    }

    // Nút xuất JSON nhanh từ thanh tiêu đề Live Logs
    const btnExportQuick = document.getElementById('btn-export-captured-json-quick');
    if (btnExportQuick) {
      btnExportQuick.addEventListener('click', () => {
        if (capturedRequests.length === 0) {
          alert('Chưa có dữ liệu API để xuất!');
          return;
        }
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(capturedRequests, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', dataStr);
        downloadAnchor.setAttribute('download', `Google_Flow_Captured_APIs_${Date.now()}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      });
    }

    // Lọc theo Tab trong Sniffer
    document.querySelectorAll('.filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.getAttribute('data-filter');
        updateUI();
      });
    });

    // Tìm kiếm
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        updateUI();
      });
    }

    // Switch Tabs trong Chi tiết (Payload / Response / Headers / cURL)
    document.querySelectorAll('.detail-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.detail-tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.detail-tab-content').forEach((c) => c.classList.remove('active'));

        btn.classList.add('active');
        const targetTab = btn.getAttribute('data-tab');
        const targetContent = document.getElementById(`tab-content-${targetTab}`);
        if (targetContent) targetContent.classList.add('active');
      });
    });

    setupCopyButtons();
  }

  function setupCopyButtons() {
    const copyToClipboard = (text, btnElement, successMsg = 'Đã Copy!') => {
      if (!text) {
        alert('Không có dữ liệu để copy!');
        return;
      }
      navigator.clipboard.writeText(typeof text === 'object' ? JSON.stringify(text, null, 2) : String(text)).then(() => {
        const originalText = btnElement.innerText;
        btnElement.innerText = `✅ ${successMsg}`;
        btnElement.classList.add('btn-copied');
        setTimeout(() => {
          btnElement.innerText = originalText;
          btnElement.classList.remove('btn-copied');
        }, 1800);
      });
    };

    document.getElementById('btn-copy-curl')?.addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.curl, this, 'Đã copy cURL!');
    });

    document.getElementById('btn-copy-payload')?.addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.body, this, 'Đã copy Payload!');
    });

    document.getElementById('btn-copy-response')?.addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.response, this, 'Đã copy Response!');
    });

    document.getElementById('btn-copy-token')?.addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req && req.headers) {
        const token =
          req.headers['authorization'] ||
          req.headers['x-goog-api-key'] ||
          req.headers['x-goog-authuser'] ||
          req.headers['cookie'];
        if (token) {
          copyToClipboard(token, this, 'Đã copy Token!');
        } else {
          alert('Không tìm thấy Authorization hoặc Token header trong request này!');
        }
      }
    });

    document.getElementById('btn-copy-url')?.addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.url, this, 'Đã copy URL!');
    });
  }

  // -------------------------------------------------------------
  // 7. Cập nhật Giao diện Sniffer (Render Update)
  // -------------------------------------------------------------
  function updateUI() {
    if (!widgetContainer) {
      if (document.body) createFloatingUI();
      else return;
    }

    const countAll = capturedRequests.length;
    const countProject = capturedRequests.filter((r) => r.category === 'project').length;
    const countVideo = capturedRequests.filter((r) => r.category === 'video').length;
    const countImage = capturedRequests.filter((r) => r.category === 'image').length;
    const countPoll = capturedRequests.filter((r) => r.category === 'poll').length;
    const countOther = capturedRequests.filter((r) => r.category === 'other').length;

    // Cập nhật Badge Trigger
    const elCountAll = document.getElementById('badge-count-all');
    const elCountProject = document.getElementById('badge-count-project');
    const elCountVideo = document.getElementById('badge-count-video');
    const elCountImage = document.getElementById('badge-count-image');

    if (elCountAll) elCountAll.textContent = countAll;
    if (elCountProject) elCountProject.textContent = `📁 ${countProject}`;
    if (elCountVideo) elCountVideo.textContent = `🎬 ${countVideo}`;
    if (elCountImage) elCountImage.textContent = `🖼️ ${capturedImages.length}`;

    // Cập nhật Tab Count
    const tabAll = document.getElementById('tab-count-all');
    const tabProject = document.getElementById('tab-count-project');
    const tabVideo = document.getElementById('tab-count-video');
    const tabImage = document.getElementById('tab-count-image');
    const tabPoll = document.getElementById('tab-count-poll');
    const tabOther = document.getElementById('tab-count-other');

    if (tabAll) tabAll.textContent = countAll;
    if (tabProject) tabProject.textContent = countProject;
    if (tabVideo) tabVideo.textContent = countVideo;
    if (tabImage) tabImage.textContent = countImage;
    if (tabPoll) tabPoll.textContent = countPoll;
    if (tabOther) tabOther.textContent = countOther;

    // Lọc danh sách hiển thị
    let filtered = capturedRequests;
    if (activeFilter !== 'all') {
      filtered = filtered.filter((r) => r.category === activeFilter);
    }
    if (searchQuery) {
      filtered = filtered.filter(
        (r) =>
          r.url.toLowerCase().includes(searchQuery) ||
          r.method.toLowerCase().includes(searchQuery) ||
          (r.body && JSON.stringify(r.body).toLowerCase().includes(searchQuery)) ||
          (r.response && JSON.stringify(r.response).toLowerCase().includes(searchQuery))
      );
    }

    const listContainer = document.getElementById('request-items-list');
    const emptyState = document.getElementById('list-empty-state');

    if (listContainer && emptyState) {
      if (filtered.length === 0) {
        listContainer.innerHTML = '';
        emptyState.style.display = 'flex';
      } else {
        emptyState.style.display = 'none';
        listContainer.innerHTML = filtered
          .map((req) => {
            const isSelected = req.id === selectedRequestId;
            const timeStr = new Date(req.timestamp).toLocaleTimeString();
            const shortUrl = formatShortUrl(req.url);

            return `
              <div class="request-item ${isSelected ? 'selected' : ''} req-cat-${req.category}" data-id="${req.id}">
                <div class="req-item-top">
                  <span class="req-method method-${req.method.toLowerCase()}">${req.method}</span>
                  <span class="req-status status-${getStatusClass(req.status)}">${req.status || 'ERR'}</span>
                  <span class="req-cat-tag tag-${req.category}">${req.categoryIcon} ${req.categoryLabel}</span>
                  <span class="req-time">${timeStr}</span>
                </div>
                <div class="req-item-url" title="${req.url}">${escapeHtml(shortUrl)}</div>
                ${renderPayloadSnippet(req)}
              </div>
            `;
          })
          .join('');

        listContainer.querySelectorAll('.request-item').forEach((el) => {
          el.addEventListener('click', () => {
            selectedRequestId = el.getAttribute('data-id');
            updateUI();
          });
        });
      }
    }

    renderDetailPane();
  }

  function renderPayloadSnippet(req) {
    if (!req.body) return '';
    try {
      let snippet = '';
      if (typeof req.body === 'object') {
        const prompt = req.body.prompt || req.body.textPrompt || (req.body.requests && req.body.requests[0]?.prompt);
        const title = req.body.title || req.body.displayName || req.body.projectName;
        if (prompt) snippet = `💬 Prompt: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`;
        else if (title) snippet = `📁 Tên: "${title}"`;
        else snippet = JSON.stringify(req.body).substring(0, 60);
      } else {
        snippet = String(req.body).substring(0, 60);
      }
      return `<div class="req-item-snippet">${escapeHtml(snippet)}</div>`;
    } catch {
      return '';
    }
  }

  function renderDetailPane() {
    const emptyDetail = document.getElementById('detail-empty-state');
    const detailBox = document.getElementById('detail-content-box');
    const selectedReq = capturedRequests.find((r) => r.id === selectedRequestId);

    if (!emptyDetail || !detailBox) return;

    if (!selectedReq) {
      emptyDetail.style.display = 'flex';
      detailBox.style.display = 'none';
      return;
    }

    emptyDetail.style.display = 'none';
    detailBox.style.display = 'flex';

    const methodEl = document.getElementById('detail-method');
    if (methodEl) {
      methodEl.textContent = selectedReq.method;
      methodEl.className = `method-tag method-${selectedReq.method.toLowerCase()}`;
    }

    const statusEl = document.getElementById('detail-status');
    if (statusEl) {
      statusEl.textContent = selectedReq.status || 'ERR';
      statusEl.className = `status-tag status-${getStatusClass(selectedReq.status)}`;
    }

    const catBadge = document.getElementById('detail-category-badge');
    if (catBadge) {
      catBadge.textContent = `${selectedReq.categoryIcon} ${selectedReq.categoryLabel}`;
      catBadge.className = `category-badge tag-${selectedReq.category}`;
    }

    const durEl = document.getElementById('detail-duration');
    if (durEl) durEl.textContent = `${selectedReq.duration}ms`;

    const urlEl = document.getElementById('detail-full-url');
    if (urlEl) urlEl.value = selectedReq.url;

    const codePayload = document.getElementById('code-payload');
    if (codePayload) {
      codePayload.textContent = selectedReq.body
        ? typeof selectedReq.body === 'object'
          ? JSON.stringify(selectedReq.body, null, 2)
          : selectedReq.body
        : '// Không có Request Body';
    }

    const codeResponse = document.getElementById('code-response');
    if (codeResponse) {
      codeResponse.textContent = selectedReq.response
        ? typeof selectedReq.response === 'object'
          ? JSON.stringify(selectedReq.response, null, 2)
          : selectedReq.response
        : '// Response trống hoặc đang xử lý';
    }

    const codeCurl = document.getElementById('code-curl');
    if (codeCurl) codeCurl.textContent = selectedReq.curl;

    const reqHeadersTable = document.getElementById('table-req-headers');
    const resHeadersTable = document.getElementById('table-res-headers');

    if (reqHeadersTable) reqHeadersTable.innerHTML = renderHeadersRows(selectedReq.headers);
    if (resHeadersTable) resHeadersTable.innerHTML = renderHeadersRows(selectedReq.resHeaders);
  }

  function renderHeadersRows(headers) {
    if (!headers || Object.keys(headers).length === 0) {
      return `<tr><td colspan="2" class="empty-header-row">(Trống)</td></tr>`;
    }
    return Object.keys(headers)
      .map(
        (key) => `
        <tr>
          <td class="header-name">${escapeHtml(key)}</td>
          <td class="header-value">${escapeHtml(headers[key])}</td>
        </tr>
      `
      )
      .join('');
  }

  function formatShortUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  }

  function getStatusClass(status) {
    if (status >= 200 && status < 300) return '2xx';
    if (status >= 300 && status < 400) return '3xx';
    if (status >= 400 && status < 500) return '4xx';
    if (status >= 500) return '5xx';
    return 'err';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Khởi tạo UI sau khi DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingUI);
  } else {
    createFloatingUI();
  }
})();
