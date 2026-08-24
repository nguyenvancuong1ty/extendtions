/**
 * Popup Script - Quản lý tương tác trong popup extension
 */

document.addEventListener('DOMContentLoaded', () => {
  let requests = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let activeItem = null;

  const statTotal = document.getElementById('stat-total');
  const statProject = document.getElementById('stat-project');
  const statVideo = document.getElementById('stat-video');

  const filterAll = document.getElementById('filter-all');
  const filterProject = document.getElementById('filter-project');
  const filterVideo = document.getElementById('filter-video');

  const searchInput = document.getElementById('popup-search');
  const listContainer = document.getElementById('popup-request-list');
  const emptyState = document.getElementById('popup-empty');

  const btnExport = document.getElementById('btn-popup-export');
  const btnClear = document.getElementById('btn-popup-clear');

  // Modal elements
  const modal = document.getElementById('popup-detail-modal');
  const btnModalClose = document.getElementById('btn-modal-close');
  const modalUrl = document.getElementById('modal-url');
  const modalPayload = document.getElementById('modal-payload-code');
  const modalResponse = document.getElementById('modal-response-code');
  const btnCurl = document.getElementById('btn-modal-curl');
  const btnPayload = document.getElementById('btn-modal-payload');
  const btnRes = document.getElementById('btn-modal-response');
  const btnToken = document.getElementById('btn-modal-token');

  // Load data từ storage và active tab
  function loadData() {
    // 1. Thử lấy từ storage trước
    chrome.storage.local.get(['flow_captured_requests'], (res) => {
      if (res.flow_captured_requests && Array.isArray(res.flow_captured_requests)) {
        requests = res.flow_captured_requests;
        render();
      }
    });

    // 2. Thử truy vấn active tab để lấy danh sách thời gian thực
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CAPTURED_REQUESTS' }, (response) => {
          if (chrome.runtime.lastError) {
            // Không phải trang Google Flow hoặc content script chưa inject
            return;
          }
          if (response && response.requests) {
            requests = response.requests;
            render();
          }
        });
      }
    });
  }

  loadData();

  // Filters
  filterAll.addEventListener('click', () => setFilter('all', filterAll));
  filterProject.addEventListener('click', () => setFilter('project', filterProject));
  filterVideo.addEventListener('click', () => setFilter('video', filterVideo));

  function setFilter(filter, el) {
    currentFilter = filter;
    document.querySelectorAll('.stat-card').forEach((c) => c.classList.remove('active'));
    el.classList.add('active');
    render();
  }

  // Search
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render();
  });

  // Clear
  btnClear.addEventListener('click', () => {
    if (confirm('Bạn có muốn xóa toàn bộ lịch sử API?')) {
      requests = [];
      chrome.storage.local.set({ flow_captured_requests: [] });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_CAPTURED_REQUESTS' });
        }
      });
      render();
    }
  });

  // Export
  btnExport.addEventListener('click', () => {
    if (requests.length === 0) {
      alert('Chưa có dữ liệu để xuất!');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(requests, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `Flow_APIs_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // Render logic
  function render() {
    const totalCount = requests.length;
    const projectCount = requests.filter((r) => r.category === 'project').length;
    const videoCount = requests.filter((r) => r.category === 'video').length;

    statTotal.textContent = totalCount;
    statProject.textContent = projectCount;
    statVideo.textContent = videoCount;

    let filtered = requests;
    if (currentFilter !== 'all') {
      filtered = filtered.filter((r) => r.category === currentFilter);
    }
    if (searchQuery) {
      filtered = filtered.filter(
        (r) =>
          r.url.toLowerCase().includes(searchQuery) ||
          r.method.toLowerCase().includes(searchQuery) ||
          (r.body && JSON.stringify(r.body).toLowerCase().includes(searchQuery))
      );
    }

    listContainer.querySelectorAll('.request-item').forEach((e) => e.remove());

    if (filtered.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    filtered.forEach((req) => {
      const item = document.createElement('div');
      item.className = 'request-item';

      const timeStr = new Date(req.timestamp).toLocaleTimeString();
      let shortUrl = req.url;
      try {
        const u = new URL(req.url);
        shortUrl = u.pathname + u.search;
      } catch (_) {}

      let snippet = '';
      if (req.body && typeof req.body === 'object') {
        const prompt = req.body.prompt || req.body.textPrompt || (req.body.requests && req.body.requests[0]?.prompt);
        const title = req.body.title || req.body.displayName;
        if (prompt) snippet = `💬 Prompt: "${prompt.substring(0, 45)}..."`;
        else if (title) snippet = `📁 Tên: "${title}"`;
      }

      item.innerHTML = `
        <div class="req-item-top">
          <span class="req-method method-${req.method.toLowerCase()}">${req.method}</span>
          <span class="req-status status-${getStatusClass(req.status)}">${req.status || 'ERR'}</span>
          <span class="req-cat-tag tag-${req.category}">${req.categoryIcon || '🌐'} ${req.categoryLabel || 'API'}</span>
          <span class="req-time">${timeStr}</span>
        </div>
        <div class="req-item-url" title="${req.url}">${escapeHtml(shortUrl)}</div>
        ${snippet ? `<div class="req-item-snippet">${escapeHtml(snippet)}</div>` : ''}
      `;

      item.addEventListener('click', () => openModal(req));
      listContainer.appendChild(item);
    });
  }

  // Modal logic
  function openModal(req) {
    activeItem = req;
    modalUrl.value = req.url;
    modalPayload.textContent = req.body
      ? typeof req.body === 'object'
        ? JSON.stringify(req.body, null, 2)
        : req.body
      : '// Không có body';

    modalResponse.textContent = req.response
      ? typeof req.response === 'object'
        ? JSON.stringify(req.response, null, 2)
        : req.response
      : '// Response trống';

    modal.classList.remove('modal-hidden');
  }

  btnModalClose.addEventListener('click', () => {
    modal.classList.add('modal-hidden');
    activeItem = null;
  });

  function copy(text, btn, msg = 'Đã Copy!') {
    if (!text) return alert('Không có dữ liệu!');
    navigator.clipboard.writeText(typeof text === 'object' ? JSON.stringify(text, null, 2) : String(text)).then(() => {
      const orig = btn.innerText;
      btn.innerText = `✅ ${msg}`;
      setTimeout(() => (btn.innerText = orig), 1500);
    });
  }

  btnCurl.addEventListener('click', () => activeItem && copy(activeItem.curl, btnCurl, 'cURL!'));
  btnPayload.addEventListener('click', () => activeItem && copy(activeItem.body, btnPayload, 'Payload!'));
  btnRes.addEventListener('click', () => activeItem && copy(activeItem.response, btnRes, 'Response!'));
  btnToken.addEventListener('click', () => {
    if (activeItem && activeItem.headers) {
      const token =
        activeItem.headers['authorization'] ||
        activeItem.headers['x-goog-api-key'] ||
        activeItem.headers['cookie'];
      if (token) copy(token, btnToken, 'Token!');
      else alert('Không tìm thấy Authorization token trong headers!');
    }
  });

  function getStatusClass(status) {
    if (status >= 200 && status < 300) return '2xx';
    if (status >= 400 && status < 500) return '4xx';
    if (status >= 500) return '5xx';
    return '2xx';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});
