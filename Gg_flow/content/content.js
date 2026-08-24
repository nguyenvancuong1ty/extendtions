/**
 * Content Script - Chạy trong ISOLATED World
 * Chịu trách nhiệm:
 * 1. Inject injected.js vào MAIN world
 * 2. Lắng nghe postMessage từ injected.js
 * 3. Phân loại request (Tạo Project, Tạo Video, Polling, Khác)
 * 4. Hiển thị Floating UI trực tiếp trên trang https://labs.google/fx/tools/flow
 * 5. Lưu vào chrome.storage và giao tiếp với extension popup / background
 */

(function () {
  const SENDER_ID = 'FLOW_API_SNIFFER';
  let capturedRequests = [];
  let selectedRequestId = null;
  let activeFilter = 'all'; // 'all' | 'project' | 'video' | 'poll' | 'other'
  let searchQuery = '';
  let isPanelOpen = false;

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

  // -------------------------------------------------------------
  // 2. Logic Phân loại API (Tạo Project, Tạo Video, etc.)
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
        color: '#10b981', // Emerald green
        icon: '📁',
      };
    }

    // 2. Nhận diện API Tạo Video / Generate
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
        color: '#8b5cf6', // Violet
        icon: '🎬',
      };
    }

    // 3. Nhận diện Polling / Kiểm tra tiến độ Video
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
        color: '#f59e0b', // Amber
        icon: '⏳',
      };
    }

    // 4. API khác của Google Labs / Flow
    return {
      category: 'other',
      label: 'API Khác',
      badgeClass: 'badge-other',
      color: '#3b82f6', // Blue
      icon: '🌐',
    };
  }

  // -------------------------------------------------------------
  // 3. Helper sinh cURL Command chuẩn
  // -------------------------------------------------------------
  function generateCurl(req) {
    let curl = `curl '${req.url}' \\\n`;
    curl += `  -X ${req.method} \\\n`;

    if (req.headers) {
      Object.keys(req.headers).forEach((key) => {
        // Bỏ qua pseudo-headers hoặc Content-Length tự động
        if (!key.startsWith(':') && key !== 'content-length') {
          const val = req.headers[key];
          curl += `  -H '${key}: ${val}' \\\n`;
        }
      });
    }

    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      const bodyStr = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body);
      const escapedBody = bodyStr.replace(/'/g, "'\\''");
      curl += `  --data-raw '${escapedBody}' \\\n`;
    }

    curl += `  --compressed`;
    return curl;
  }

  // -------------------------------------------------------------
  // 4. Quản lý State & Storage
  // -------------------------------------------------------------
  function addRequest(rawReq) {
    const meta = categorizeRequest(rawReq);
    if (meta.category === 'ignore') return;

    const reqItem = {
      ...rawReq,
      category: meta.category,
      categoryLabel: meta.label,
      categoryIcon: meta.icon,
      curl: generateCurl(rawReq),
    };

    // Thêm vào đầu danh sách
    capturedRequests.unshift(reqItem);
    if (capturedRequests.length > 200) {
      capturedRequests.pop();
    }

    // Nếu chưa chọn item nào, chọn item mới nhất
    if (!selectedRequestId) {
      selectedRequestId = reqItem.id;
    }

    // Gửi thông báo đến background worker để cập nhật icon badge
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE_COUNT',
        count: capturedRequests.length,
        projectCount: capturedRequests.filter((r) => r.category === 'project').length,
        videoCount: capturedRequests.filter((r) => r.category === 'video').length,
        latestRequest: reqItem,
      });

      // Lưu snapshot vào chrome.storage
      chrome.storage.local.set({ flow_captured_requests: capturedRequests.slice(0, 50) });
    } catch (_) {}

    updateUI();
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

      return true; // Giữ kết nối async
    }
  });

  // -------------------------------------------------------------
  // 5. Render UI Nổi (Floating Widget & Panel)
  // -------------------------------------------------------------
  let widgetContainer = null;

  function createFloatingUI() {
    if (document.getElementById('flow-sniffer-root')) return;

    widgetContainer = document.createElement('div');
    widgetContainer.id = 'flow-sniffer-root';
    widgetContainer.innerHTML = `
      <!-- Nút Nổi (Floating Trigger Button) -->
      <div id="flow-sniffer-trigger" title="Mở Flow API Sniffer (Bắt API Tạo Video & Project)">
        <div class="sniffer-icon-wrapper">
          <span class="sniffer-logo">⚡</span>
          <span class="sniffer-title">Flow API Sniffer</span>
        </div>
        <div class="sniffer-counters">
          <span class="badge-count count-all" id="badge-count-all">0</span>
          <span class="badge-count count-project" id="badge-count-project" title="API Tạo Project">📁 0</span>
          <span class="badge-count count-video" id="badge-count-video" title="API Tạo Video">🎬 0</span>
        </div>
        <button id="sniffer-toggle-btn" class="sniffer-btn-icon" title="Thu gọn / Mở rộng">▲</button>
      </div>

      <!-- Bảng Điều Khiển Chi Tiết (Full Panel) -->
      <div id="flow-sniffer-panel" class="flow-panel-hidden">
        <!-- Header -->
        <div class="panel-header">
          <div class="panel-header-left">
            <div class="panel-live-indicator"><span class="pulse-dot"></span> ĐANG BẮT API</div>
            <h3 class="panel-title">Google Labs Flow API Sniffer</h3>
          </div>
          <div class="panel-header-actions">
            <button id="btn-grab-recaptcha" class="btn-action" style="background:#4f46e5; border-color:#6366f1;" title="Tạo mã reCAPTCHA mới cho Canvas Studio">⚡ Lấy Token reCAPTCHA</button>
            <button id="btn-export-json" class="btn-action" title="Xuất toàn bộ API ra file JSON">💾 Xuất JSON</button>
            <button id="btn-clear-all" class="btn-action btn-danger" title="Xóa danh sách">🗑️ Xóa</button>
            <button id="btn-close-panel" class="btn-action-icon" title="Đóng bảng">✕</button>
          </div>
        </div>

        <!-- Filter & Search Bar -->
        <div class="panel-toolbar">
          <div class="panel-filter-tabs">
            <button class="filter-tab active" data-filter="all">Tất cả (<span id="tab-count-all">0</span>)</button>
            <button class="filter-tab tab-project" data-filter="project">📁 Tạo Project (<span id="tab-count-project">0</span>)</button>
            <button class="filter-tab tab-video" data-filter="video">🎬 Tạo Video (<span id="tab-count-video">0</span>)</button>
            <button class="filter-tab tab-poll" data-filter="poll">⏳ Tiến độ (<span id="tab-count-poll">0</span>)</button>
            <button class="filter-tab tab-other" data-filter="other">🌐 Khác (<span id="tab-count-other">0</span>)</button>
          </div>
          <div class="panel-search">
            <input type="text" id="sniffer-search-input" placeholder="🔍 Tìm kiếm URL, payload, prompt..." />
          </div>
        </div>

        <!-- Body: Split View (List bên trái, Detail bên phải) -->
        <div class="panel-body">
          <!-- Request List -->
          <div class="request-list-pane" id="request-list-container">
            <div class="empty-state" id="list-empty-state">
              <div class="empty-icon">📡</div>
              <p>Chưa bắt được request nào.</p>
              <span class="empty-sub">Hãy thực hiện thao tác tạo project hoặc tạo video trên Flow!</span>
            </div>
            <div class="request-items" id="request-items-list"></div>
          </div>

          <!-- Request Details Pane -->
          <div class="request-detail-pane" id="request-detail-container">
            <div class="empty-detail" id="detail-empty-state">
              <p>👈 Chọn 1 request từ danh sách để xem chi tiết & lấy cURL</p>
            </div>
            <div class="detail-content" id="detail-content-box" style="display: none;">
              <!-- Action Toolbar -->
              <div class="detail-action-bar">
                <div class="detail-info-main">
                  <span id="detail-method" class="method-tag">POST</span>
                  <span id="detail-status" class="status-tag">200</span>
                  <span id="detail-category-badge" class="category-badge">🎬 Tạo Video</span>
                  <span id="detail-duration" class="time-tag">120ms</span>
                </div>
                <div class="detail-copy-buttons">
                  <button id="btn-copy-curl" class="btn-copy btn-primary-copy" title="Copy lệnh cURL hoàn chỉnh">📋 Copy cURL</button>
                  <button id="btn-copy-payload" class="btn-copy" title="Copy Request Body JSON">📦 Copy Payload</button>
                  <button id="btn-copy-response" class="btn-copy" title="Copy Response JSON">📥 Copy Response</button>
                  <button id="btn-copy-token" class="btn-copy" title="Copy Bearer / API Key">🔑 Copy Token</button>
                </div>
              </div>

              <!-- URL Bar -->
              <div class="detail-url-box">
                <span class="url-label">URL:</span>
                <input type="text" id="detail-full-url" readonly />
                <button id="btn-copy-url" class="btn-icon-copy" title="Copy URL">📋</button>
              </div>

              <!-- Detail Tabs -->
              <div class="detail-tabs">
                <button class="detail-tab-btn active" data-tab="payload">📦 Request Body</button>
                <button class="detail-tab-btn" data-tab="response">📥 Response</button>
                <button class="detail-tab-btn" data-tab="headers">🔑 Headers</button>
                <button class="detail-tab-btn" data-tab="curl">💻 cURL Command</button>
              </div>

              <!-- Tab Contents -->
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
    `;

    document.body.appendChild(widgetContainer);
    setupEvents();
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

    // Xóa tất cả
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
            grabRecaptchaBtn.innerText = '⚡ Lấy Token reCAPTCHA';
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

    // Lọc theo Tab
    document.querySelectorAll('.filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.getAttribute('data-filter');
        updateUI();
      });
    });

    // Tìm kiếm
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      updateUI();
    });

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

    // Các nút Copy
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

    document.getElementById('btn-copy-curl').addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.curl, this, 'Đã copy cURL!');
    });

    document.getElementById('btn-copy-payload').addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.body, this, 'Đã copy Payload!');
    });

    document.getElementById('btn-copy-response').addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.response, this, 'Đã copy Response!');
    });

    document.getElementById('btn-copy-token').addEventListener('click', function () {
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

    document.getElementById('btn-copy-url').addEventListener('click', function () {
      const req = capturedRequests.find((r) => r.id === selectedRequestId);
      if (req) copyToClipboard(req.url, this, 'Đã copy URL!');
    });
  }

  // -------------------------------------------------------------
  // 7. Cập nhật Giao diện (Render Update)
  // -------------------------------------------------------------
  function updateUI() {
    if (!widgetContainer) {
      if (document.body) createFloatingUI();
      else return;
    }

    // Đếm số lượng
    const countAll = capturedRequests.length;
    const countProject = capturedRequests.filter((r) => r.category === 'project').length;
    const countVideo = capturedRequests.filter((r) => r.category === 'video').length;
    const countPoll = capturedRequests.filter((r) => r.category === 'poll').length;
    const countOther = capturedRequests.filter((r) => r.category === 'other').length;

    // Cập nhật Badge Trigger
    document.getElementById('badge-count-all').textContent = countAll;
    document.getElementById('badge-count-project').textContent = `📁 ${countProject}`;
    document.getElementById('badge-count-video').textContent = `🎬 ${countVideo}`;

    // Cập nhật Tab Count
    document.getElementById('tab-count-all').textContent = countAll;
    document.getElementById('tab-count-project').textContent = countProject;
    document.getElementById('tab-count-video').textContent = countVideo;
    document.getElementById('tab-count-poll').textContent = countPoll;
    document.getElementById('tab-count-other').textContent = countOther;

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

      // Gán sự kiện click vào item
      listContainer.querySelectorAll('.request-item').forEach((el) => {
        el.addEventListener('click', () => {
          selectedRequestId = el.getAttribute('data-id');
          updateUI();
        });
      });
    }

    // Render Chi tiết
    renderDetailPane();
  }

  function renderPayloadSnippet(req) {
    if (!req.body) return '';
    try {
      let snippet = '';
      if (typeof req.body === 'object') {
        // Tìm prompt hoặc project name nếu có
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

    if (!selectedReq) {
      emptyDetail.style.display = 'flex';
      detailBox.style.display = 'none';
      return;
    }

    emptyDetail.style.display = 'none';
    detailBox.style.display = 'flex';

    // Header info
    const methodEl = document.getElementById('detail-method');
    methodEl.textContent = selectedReq.method;
    methodEl.className = `method-tag method-${selectedReq.method.toLowerCase()}`;

    const statusEl = document.getElementById('detail-status');
    statusEl.textContent = selectedReq.status || 'ERR';
    statusEl.className = `status-tag status-${getStatusClass(selectedReq.status)}`;

    const catBadge = document.getElementById('detail-category-badge');
    catBadge.textContent = `${selectedReq.categoryIcon} ${selectedReq.categoryLabel}`;
    catBadge.className = `category-badge tag-${selectedReq.category}`;

    document.getElementById('detail-duration').textContent = `${selectedReq.duration}ms`;
    document.getElementById('detail-full-url').value = selectedReq.url;

    // Body
    document.getElementById('code-payload').textContent = selectedReq.body
      ? typeof selectedReq.body === 'object'
        ? JSON.stringify(selectedReq.body, null, 2)
        : selectedReq.body
      : '// Không có Request Body (GET/Empty)';

    // Response
    document.getElementById('code-response').textContent = selectedReq.response
      ? typeof selectedReq.response === 'object'
        ? JSON.stringify(selectedReq.response, null, 2)
        : selectedReq.response
      : '// Response trống hoặc đang xử lý';

    // cURL
    document.getElementById('code-curl').textContent = selectedReq.curl;

    // Headers Tables
    const reqHeadersTable = document.getElementById('table-req-headers');
    const resHeadersTable = document.getElementById('table-res-headers');

    reqHeadersTable.innerHTML = renderHeadersRows(selectedReq.headers);
    resHeadersTable.innerHTML = renderHeadersRows(selectedReq.resHeaders);
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

  // Helpers
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
