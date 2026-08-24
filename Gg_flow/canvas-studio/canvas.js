/**
 * Canvas Studio Engine (V2.2 Full Google Flow Controls & Download API)
 * Matched 100% with Google Flow UI: Frames, Ingredients, Aspect 9:16/16:9, Durations 4s/6s/8s/10s, Variations x1-x4, Credits & MP4 Download
 */

(function () {
  const state = {
    nodes: [],
    connections: [],
    view: {
      panX: 60,
      panY: 60,
      zoom: 0.95,
      isPanning: false,
      startX: 0,
      startY: 0,
    },
    draggingNode: null,
    dragOffset: { x: 0, y: 0 },
    activeProjectId: 'b7a26d33-1e21-43eb-b217-2078a909f2d4',
    projectTitle: 'Dự Án Phim AI',
    isBatchRunning: false,
    cancelBatch: false,
    logs: [],
    recaptchaToken: '',
  };

  const viewport = document.getElementById('canvas-viewport');
  const nodesContainer = document.getElementById('nodes-container');
  const svgConnections = document.getElementById('connections-svg');
  const gridLayer = document.getElementById('canvas-grid');
  const zoomLevelEl = document.getElementById('hud-zoom-level');
  const bridgeStatusPill = document.getElementById('bridge-status-pill');
  const bridgeStatusText = document.getElementById('bridge-status-text');
  const projectTitleEl = document.getElementById('current-project-title');
  const executionHud = document.getElementById('execution-hud');
  const execTitle = document.getElementById('hud-exec-title');
  const execDesc = document.getElementById('hud-exec-desc');

  const logDrawer = document.getElementById('log-drawer');
  const logContainer = document.getElementById('log-messages-container');
  const logCounter = document.getElementById('log-counter');
  const btnToggleLogs = document.getElementById('btn-toggle-logs');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  const btnCopyLogs = document.getElementById('btn-copy-all-logs');
  const btnClearLogs = document.getElementById('btn-clear-logs');

  function calculateCredits(duration = '8s', count = 1, mode = 'video') {
    if (mode === 'image') return count * 2;
    let base = 7;
    if (duration === '4s') base = 7;
    else if (duration === '6s') base = 11;
    else if (duration === '8s') base = 15;
    else if (duration === '10s') base = 19;
    return base * count;
  }

  function addLog(logItem) {
    state.logs.push(logItem);
    logCounter.textContent = state.logs.length;

    const emptyMsg = logContainer.querySelector('.log-empty-msg');
    if (emptyMsg) emptyMsg.remove();

    const el = document.createElement('div');
    el.className = `log-item level-${logItem.level}`;

    let detailHtml = '';
    if (logItem.detail) {
      const detailStr =
        typeof logItem.detail === 'object' ? JSON.stringify(logItem.detail, null, 2) : String(logItem.detail);
      detailHtml = `<pre class="log-detail-box"><code>${escapeHtml(detailStr)}</code></pre>`;
    }

    el.innerHTML = `
      <div class="log-item-header">
        <span class="log-time">[${logItem.timestamp}]</span>
        <span class="log-level log-level-${logItem.level}">${logItem.level}</span>
        <span class="log-msg">${escapeHtml(logItem.message)}</span>
      </div>
      ${detailHtml}
    `;

    logContainer.appendChild(el);
    logContainer.scrollTop = logContainer.scrollHeight;

    if (logItem.level === 'error') {
      logDrawer.classList.remove('drawer-collapsed');
    }
  }

  window.flowBridge.onLog((item) => addLog(item));

  btnToggleLogs.addEventListener('click', () => logDrawer.classList.toggle('drawer-collapsed'));
  btnCloseDrawer.addEventListener('click', () => logDrawer.classList.add('drawer-collapsed'));
  btnClearLogs.addEventListener('click', () => {
    state.logs = [];
    logCounter.textContent = '0';
    logContainer.innerHTML = '<div class="log-empty-msg">Chưa có log. Mọi thao tác và lỗi API sẽ xuất hiện tại đây!</div>';
  });

  btnCopyLogs.addEventListener('click', () => {
    if (state.logs.length === 0) return alert('Chưa có log nào!');
    const text = state.logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}\n` +
          (l.detail ? JSON.stringify(l.detail, null, 2) + '\n' : '')
      )
      .join('\n----------------------------------------\n');

    navigator.clipboard.writeText(text).then(() => {
      const orig = btnCopyLogs.innerText;
      btnCopyLogs.innerText = '✅ Đã Copy Log!';
      setTimeout(() => (btnCopyLogs.innerText = orig), 1500);
    });
  });

  function loadInitialStoryboard() {
    const saved = localStorage.getItem('flow_canvas_storyboard_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.nodes && parsed.nodes.length > 0) {
          state.nodes = parsed.nodes;
          state.connections = parsed.connections || [];
          state.projectTitle = parsed.projectTitle || 'Dự Án Phim AI';
          state.activeProjectId = parsed.activeProjectId || state.activeProjectId;
          projectTitleEl.textContent = state.projectTitle;
          renderAll();
          return;
        }
      } catch (_) {}
    }
    createDemoStoryboard();
  }

  function createDemoStoryboard() {
    state.nodes = [
      {
        id: 'shot_1',
        shotNumber: 1,
        title: 'Shot 1: Flycam Biển Hoàng Hôn',
        prompt: 'Cinematic drone shot flying over a tropical turquoise ocean at golden hour sunset, soft sunlight reflections on waves, hyperrealistic 4k',
        mode: 'video', // 'video' | 'image'
        subMode: 'frames', // 'frames' | 'ingredients'
        modelKey: 'abra_t2v_8s',
        aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE', // 'VIDEO_ASPECT_RATIO_LANDSCAPE' (16:9) | 'VIDEO_ASPECT_RATIO_PORTRAIT' (9:16)
        duration: '8s', // '4s' | '6s' | '8s' | '10s'
        variationsCount: 1, // 1 | 2 | 3 | 4
        seed: 20625,
        startFrameUrl: null,
        endFrameUrl: null,
        x: 60,
        y: 80,
        status: 'idle',
        mediaId: null,
        videoUrl: null,
      },
      {
        id: 'shot_2',
        shotNumber: 2,
        title: 'Shot 2: Sóng Biển & Rạn San Hô',
        prompt: 'Close-up slow motion of crystal clear ocean wave crashing gently against a colorful coral reef, sunlight rays penetrating underwater',
        mode: 'video',
        subMode: 'frames',
        modelKey: 'abra_t2v_8s',
        aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
        duration: '8s',
        variationsCount: 1,
        seed: 48912,
        startFrameUrl: null,
        endFrameUrl: null,
        x: 520,
        y: 80,
        status: 'idle',
        mediaId: null,
        videoUrl: null,
      },
      {
        id: 'shot_3',
        shotNumber: 3,
        title: 'Shot 3: Đàn Cá Đuối Lướt Qua',
        prompt: 'Majestic giant manta rays gliding gracefully together under deep blue crystal clear ocean, cinematic camera pan, National Geographic documentary style',
        mode: 'video',
        subMode: 'frames',
        modelKey: 'abra_t2v_8s',
        aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
        duration: '8s',
        variationsCount: 1,
        seed: 73190,
        startFrameUrl: null,
        endFrameUrl: null,
        x: 980,
        y: 80,
        status: 'idle',
        mediaId: null,
        videoUrl: null,
      },
    ];

    state.connections = [
      { from: 'shot_1', to: 'shot_2' },
      { from: 'shot_2', to: 'shot_3' },
    ];

    state.projectTitle = 'Kịch Bản Mẫu: Đại Dương Huyền Bí';
    projectTitleEl.textContent = state.projectTitle;
    saveState();
    renderAll();
  }

  function saveState() {
    localStorage.setItem(
      'flow_canvas_storyboard_v2',
      JSON.stringify({
        nodes: state.nodes,
        connections: state.connections,
        projectTitle: state.projectTitle,
        activeProjectId: state.activeProjectId,
      })
    );
  }

  function updateTransform() {
    nodesContainer.style.transform = `translate(${state.view.panX}px, ${state.view.panY}px) scale(${state.view.zoom})`;
    gridLayer.style.transform = `translate(${state.view.panX % 28}px, ${state.view.panY % 28}px)`;
    zoomLevelEl.textContent = `${Math.round(state.view.zoom * 100)}%`;
    renderConnections();
  }

  function renderAll() {
    renderNodes();
    renderConnections();
  }

  function renderNodes() {
    nodesContainer.innerHTML = '';

    state.nodes.forEach((node) => {
      const el = document.createElement('div');
      el.className = `shot-node state-${node.status}`;
      el.id = `node-${node.id}`;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;

      let statusClass = 'tag-idle';
      let statusText = '🟡 Chờ tạo';
      if (node.status === 'generating') {
        statusClass = 'tag-generating';
        statusText = '⏳ Đang render...';
      } else if (node.status === 'completed') {
        statusClass = 'tag-completed';
        statusText = `🟢 Hoàn tất (${node.duration || '8s'})`;
      } else if (node.status === 'failed') {
        statusClass = 'tag-failed';
        statusText = '🔴 Lỗi render';
      }

      const requiredCredits = calculateCredits(node.duration, node.variationsCount, node.mode);

      el.innerHTML = `
        <div class="node-port port-input" title="Cổng Nhận Khung Hình Từ Shot Trước"></div>
        <div class="node-port port-output" title="Cổng Nối Sang Shot Kế Tiếp"></div>

        <!-- Node Header -->
        <div class="node-header" data-drag-handle="true">
          <div class="node-title-group">
            <span class="shot-badge">SHOT #${node.shotNumber}</span>
            <span class="node-status-tag ${statusClass}">${statusText}</span>
          </div>
          <div class="node-actions">
            <button class="btn-node-icon btn-duplicate" title="Nhân bản Shot" data-id="${node.id}">⎘</button>
            <button class="btn-node-icon btn-delete" title="Xóa Shot" data-id="${node.id}">✕</button>
          </div>
        </div>

        <!-- Node Body: Google Flow Controls Panel -->
        <div class="node-body">
          <!-- 1. Mode Switcher (Image / Video) & (Frames / Ingredients) -->
          <div class="flow-control-row">
            <div class="flow-pill-group">
              <button class="flow-pill-btn ${node.mode === 'image' ? 'active' : ''} btn-mode-image" data-id="${node.id}">
                🖼️ Image
              </button>
              <button class="flow-pill-btn ${node.mode === 'video' ? 'active' : ''} btn-mode-video" data-id="${node.id}">
                📹 Video
              </button>
            </div>

            <div class="flow-pill-group">
              <button class="flow-pill-btn ${node.subMode === 'frames' ? 'active' : ''} btn-submode-frames" data-id="${node.id}" title="Khung hình Chuyển Cảnh Start/End">
                🔳 Frames
              </button>
              <button class="flow-pill-btn ${node.subMode === 'ingredients' ? 'active' : ''} btn-submode-ingredients" data-id="${node.id}" title="Nguyên liệu Phong cách">
                🧪 Ingredients
              </button>
            </div>
          </div>

          <!-- 2. Aspect Ratio Selector (9:16 / 16:9) -->
          <div class="flow-aspect-group">
            <button class="aspect-btn ${node.aspectRatio === 'VIDEO_ASPECT_RATIO_PORTRAIT' ? 'active' : ''} btn-aspect-portrait" data-id="${node.id}">
              <span class="aspect-icon">📱</span>
              <span>0 9:16 (Dọc)</span>
            </button>
            <button class="aspect-btn ${node.aspectRatio === 'VIDEO_ASPECT_RATIO_LANDSCAPE' ? 'active' : ''} btn-aspect-landscape" data-id="${node.id}">
              <span class="aspect-icon">🖥️</span>
              <span>▭ 16:9 (Ngang)</span>
            </button>
          </div>

          <!-- 3. Model Selector Dropdown -->
          <div class="node-field">
            <label>AI Model Engine:</label>
            <select class="node-select select-model" data-id="${node.id}">
              <option value="abra_t2v_8s" ${node.modelKey === 'abra_t2v_8s' ? 'selected' : ''}>Veo 3.1 Quality (Điện ảnh)</option>
              <option value="veo_3_1_fast" ${node.modelKey === 'veo_3_1_fast' ? 'selected' : ''}>Omni Flash (Siêu tốc)</option>
              <option value="veo_2_0_t2v" ${node.modelKey === 'veo_2_0_t2v' ? 'selected' : ''}>Veo 2.0 Standard</option>
            </select>
          </div>

          <!-- 4. Duration Selector (4s / 6s / 8s / 10s) -->
          <div class="node-field">
            <label>Thời lượng Video:</label>
            <div class="flow-segmented-group">
              ${['4s', '6s', '8s', '10s']
                .map(
                  (d) =>
                    `<button class="segmented-item ${node.duration === d ? 'active' : ''} btn-duration" data-id="${node.id}" data-duration="${d}">${d}</button>`
                )
                .join('')}
            </div>
          </div>

          <!-- 5. Variations Count (x1 / x2 / x3 / x4) -->
          <div class="node-field">
            <label>Số lượng Biến Thể (Variations):</label>
            <div class="flow-segmented-group">
              ${[1, 2, 3, 4]
                .map(
                  (c) =>
                    `<button class="segmented-item ${node.variationsCount === c ? 'active' : ''} btn-variation" data-id="${node.id}" data-count="${c}">x${c}</button>`
                )
                .join('')}
            </div>
          </div>

          <!-- 6. Keyframe Slots: [Start Frame] <-> [End Frame] (Hỗ trợ Image-to-Video) -->
          <div class="keyframes-container">
            <div class="keyframe-box" id="start-frame-${node.id}">
              <div class="keyframe-header">
                <span>Start Frame</span>
                ${node.startFrameUrl ? `<button class="btn-clear-frame" data-id="${node.id}" data-frame="start">✕</button>` : ''}
              </div>
              <div class="keyframe-preview">
                ${node.startFrameUrl ? `<img src="${node.startFrameUrl}" alt="Start">` : `<span>+ Ảnh Đầu</span>`}
              </div>
            </div>

            <div class="keyframe-link-icon">⇄</div>

            <div class="keyframe-box" id="end-frame-${node.id}">
              <div class="keyframe-header">
                <span>End Frame</span>
                ${node.endFrameUrl ? `<button class="btn-clear-frame" data-id="${node.id}" data-frame="end">✕</button>` : ''}
              </div>
              <div class="keyframe-preview">
                ${node.endFrameUrl ? `<img src="${node.endFrameUrl}" alt="End">` : `<span>+ Ảnh Cuối</span>`}
              </div>
            </div>
          </div>

          <!-- 7. Prompt Input Box -->
          <div class="node-field">
            <label>Prompt Mô Tả Cảnh:</label>
            <textarea class="node-textarea input-prompt" placeholder="What do you want to create?" data-id="${node.id}">${escapeHtml(node.prompt)}</textarea>
          </div>

          <!-- 8. Seed & Random Dice -->
          <div class="node-field">
            <div class="field-header-flex">
              <label>Seed (Hạt giống):</label>
              <span class="credit-estimate-pill">⚡ Sử dụng: <b>${requiredCredits} credits</b></span>
            </div>
            <div class="seed-input-group">
              <input type="number" class="node-input input-seed" data-id="${node.id}" value="${node.seed}" />
              <button class="btn-dice btn-random-seed" data-id="${node.id}" title="Ngẫu nhiên Seed">🎲</button>
            </div>
          </div>

          <!-- 9. Video Display Player -->
          <div class="node-video-container" id="video-box-${node.id}">
            ${
              node.videoUrl
                ? `<video class="node-video-player" src="${node.videoUrl}" controls loop autoplay muted></video>`
                : `<div class="video-placeholder">
                     <span>🎬 Chưa có video</span>
                     <small style="color:#64748b;">Bấm Render để tạo cảnh này</small>
                   </div>`
            }
          </div>
        </div>

        <!-- Node Footer: Render & Direct MP4 Download -->
        <div class="node-footer">
          <button class="btn-render-shot btn-action-render" data-id="${node.id}">
            ${node.status === 'generating' ? '⏳ Đang render...' : '▶ Render Shot Này'}
          </button>
          ${
            node.mediaId
              ? `<button class="btn-download-mp4 btn-action-download" data-id="${node.id}" title="Tải file MP4 gốc chất lượng cao">⬇ Tải MP4 HD</button>`
              : ''
          }
        </div>
      `;

      setupNodeEvents(el, node);
      nodesContainer.appendChild(el);
    });
  }

  function setupNodeEvents(el, node) {
    const handle = el.querySelector('[data-drag-handle="true"]');
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.btn-node-icon')) return;
      state.draggingNode = node;
      state.dragOffset.x = (e.clientX - state.view.panX) / state.view.zoom - node.x;
      state.dragOffset.y = (e.clientY - state.view.panY) / state.view.zoom - node.y;
      el.classList.add('selected');
      e.stopPropagation();
    });

    // Mode Toggle
    el.querySelector('.btn-mode-image').addEventListener('click', () => {
      node.mode = 'image';
      saveState();
      renderAll();
    });
    el.querySelector('.btn-mode-video').addEventListener('click', () => {
      node.mode = 'video';
      saveState();
      renderAll();
    });

    // Submode Toggle
    el.querySelector('.btn-submode-frames').addEventListener('click', () => {
      node.subMode = 'frames';
      saveState();
      renderAll();
    });
    el.querySelector('.btn-submode-ingredients').addEventListener('click', () => {
      node.subMode = 'ingredients';
      saveState();
      renderAll();
    });

    // Aspect Ratio
    el.querySelector('.btn-aspect-portrait').addEventListener('click', () => {
      node.aspectRatio = 'VIDEO_ASPECT_RATIO_PORTRAIT';
      saveState();
      renderAll();
    });
    el.querySelector('.btn-aspect-landscape').addEventListener('click', () => {
      node.aspectRatio = 'VIDEO_ASPECT_RATIO_LANDSCAPE';
      saveState();
      renderAll();
    });

    // Model Select
    el.querySelector('.select-model').addEventListener('change', (e) => {
      node.modelKey = e.target.value;
      saveState();
    });

    // Duration Buttons
    el.querySelectorAll('.btn-duration').forEach((btn) => {
      btn.addEventListener('click', () => {
        node.duration = btn.getAttribute('data-duration');
        saveState();
        renderAll();
      });
    });

    // Variation Buttons
    el.querySelectorAll('.btn-variation').forEach((btn) => {
      btn.addEventListener('click', () => {
        node.variationsCount = parseInt(btn.getAttribute('data-count'), 10) || 1;
        saveState();
        renderAll();
      });
    });

    // Prompt
    el.querySelector('.input-prompt').addEventListener('input', (e) => {
      node.prompt = e.target.value;
      saveState();
    });

    // Seed
    el.querySelector('.input-seed').addEventListener('change', (e) => {
      node.seed = parseInt(e.target.value, 10) || 0;
      saveState();
    });

    el.querySelector('.btn-random-seed').addEventListener('click', () => {
      node.seed = Math.floor(Math.random() * 999999);
      el.querySelector('.input-seed').value = node.seed;
      saveState();
    });

    // Delete / Duplicate / Render
    el.querySelector('.btn-delete').addEventListener('click', () => deleteNode(node.id));
    el.querySelector('.btn-duplicate').addEventListener('click', () => duplicateNode(node.id));
    el.querySelector('.btn-action-render').addEventListener('click', () => renderSingleShot(node.id));

    // Direct MP4 Download Button
    const downloadBtn = el.querySelector('.btn-action-download');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        if (!node.mediaId) return;
        downloadBtn.innerText = '⏳ Đang tải...';
        try {
          const safeName = `Shot_${node.shotNumber}_${node.prompt.slice(0, 25).replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
          await window.flowBridge.downloadVideo(node.mediaId, safeName);
          downloadBtn.innerText = '✅ Đã Tải Về!';
          setTimeout(() => (downloadBtn.innerText = '⬇ Tải MP4 HD'), 2000);
        } catch (err) {
          alert('Lỗi tải video: ' + err.message);
          downloadBtn.innerText = '⬇ Tải MP4 HD';
        }
      });
    }
  }

  function renderConnections() {
    svgConnections.innerHTML = '';

    state.connections.forEach((conn) => {
      const fromNode = state.nodes.find((n) => n.id === conn.from);
      const toNode = state.nodes.find((n) => n.id === conn.to);

      if (!fromNode || !toNode) return;

      const nodeWidth = 380;
      const startX = (fromNode.x + nodeWidth) * state.view.zoom + state.view.panX;
      const startY = (fromNode.y + 35) * state.view.zoom + state.view.panY;
      const endX = toNode.x * state.view.zoom + state.view.panX;
      const endY = (toNode.y + 35) * state.view.zoom + state.view.panY;

      const dx = Math.abs(endX - startX) * 0.5;
      const cp1X = startX + dx;
      const cp1Y = startY;
      const cp2X = endX - dx;
      const cp2Y = endY;

      const pathData = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute(
        'class',
        `wire-path ${fromNode.status === 'generating' || toNode.status === 'generating' ? 'wire-animated' : ''}`
      );

      svgConnections.appendChild(path);
    });
  }

  function addShotNode() {
    const lastNode = state.nodes[state.nodes.length - 1];
    const newShotNum = state.nodes.length + 1;
    const newId = `shot_${Date.now()}`;

    const newNode = {
      id: newId,
      shotNumber: newShotNum,
      title: `Shot ${newShotNum}: Phân Cảnh Tiếp`,
      prompt: 'Cinematic continuation shot, seamless camera motion, beautiful lighting, 4k 60fps',
      mode: 'video',
      subMode: 'frames',
      modelKey: 'abra_t2v_8s',
      aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      duration: '8s',
      variationsCount: 1,
      seed: Math.floor(Math.random() * 999999),
      startFrameUrl: null,
      endFrameUrl: null,
      x: lastNode ? lastNode.x + 440 : 100,
      y: lastNode ? lastNode.y : 100,
      status: 'idle',
      mediaId: null,
      videoUrl: null,
    };

    state.nodes.push(newNode);
    if (lastNode) state.connections.push({ from: lastNode.id, to: newId });
    saveState();
    renderAll();
  }

  function deleteNode(nodeId) {
    if (state.nodes.length <= 1) return alert('Phải giữ lại ít nhất 1 Shot!');
    state.nodes = state.nodes.filter((n) => n.id !== nodeId);
    state.connections = state.connections.filter((c) => c.from !== nodeId && c.to !== nodeId);
    state.nodes.forEach((n, idx) => (n.shotNumber = idx + 1));
    saveState();
    renderAll();
  }

  function duplicateNode(nodeId) {
    const original = state.nodes.find((n) => n.id === nodeId);
    if (!original) return;

    const newId = `shot_${Date.now()}`;
    const copy = {
      ...JSON.parse(JSON.stringify(original)),
      id: newId,
      shotNumber: state.nodes.length + 1,
      x: original.x + 440,
      y: original.y + 40,
      status: 'idle',
      mediaId: null,
      videoUrl: null,
      seed: Math.floor(Math.random() * 999999),
    };

    state.nodes.push(copy);
    saveState();
    renderAll();
  }

  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.shot-node')) return;
    state.view.isPanning = true;
    state.view.startX = e.clientX - state.view.panX;
    state.view.startY = e.clientY - state.view.panY;
  });

  window.addEventListener('mousemove', (e) => {
    if (state.view.isPanning) {
      state.view.panX = e.clientX - state.view.startX;
      state.view.panY = e.clientY - state.view.startY;
      updateTransform();
      return;
    }

    if (state.draggingNode) {
      state.draggingNode.x = (e.clientX - state.view.panX) / state.view.zoom - state.dragOffset.x;
      state.draggingNode.y = (e.clientY - state.view.panY) / state.view.zoom - state.dragOffset.y;

      const nodeEl = document.getElementById(`node-${state.draggingNode.id}`);
      if (nodeEl) {
        nodeEl.style.left = `${state.draggingNode.x}px`;
        nodeEl.style.top = `${state.draggingNode.y}px`;
      }
      renderConnections();
    }
  });

  window.addEventListener('mouseup', () => {
    state.view.isPanning = false;
    if (state.draggingNode) {
      document.querySelectorAll('.shot-node').forEach((n) => n.classList.remove('selected'));
      state.draggingNode = null;
      saveState();
    }
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const newZoom = Math.min(Math.max(state.view.zoom * zoomFactor, 0.4), 2.5);

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    state.view.panX = mouseX - (mouseX - state.view.panX) * (newZoom / state.view.zoom);
    state.view.panY = mouseY - (mouseY - state.view.panY) * (newZoom / state.view.zoom);
    state.view.zoom = newZoom;

    updateTransform();
  });

  document.getElementById('hud-zoom-in').addEventListener('click', () => {
    state.view.zoom = Math.min(state.view.zoom * 1.15, 2.5);
    updateTransform();
  });

  document.getElementById('hud-zoom-out').addEventListener('click', () => {
    state.view.zoom = Math.max(state.view.zoom * 0.85, 0.4);
    updateTransform();
  });

  document.getElementById('hud-zoom-reset').addEventListener('click', () => {
    state.view.zoom = 1.0;
    state.view.panX = 60;
    state.view.panY = 60;
    updateTransform();
  });

  document.getElementById('hud-fit-all').addEventListener('click', () => {
    if (state.nodes.length === 0) return;
    let minX = Infinity,
      minY = Infinity;
    state.nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
    });
    state.view.panX = 60 - minX;
    state.view.panY = 60 - minY;
    state.view.zoom = 0.85;
    updateTransform();
  });

  async function renderSingleShot(nodeId) {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    node.status = 'generating';
    renderAll();

    try {
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: `Bắt đầu render [Shot #${node.shotNumber}]...`,
        detail: {
          prompt: node.prompt,
          model: node.modelKey,
          aspectRatio: node.aspectRatio,
          duration: node.duration,
          variations: node.variationsCount,
          seed: node.seed,
          projectId: state.activeProjectId,
        },
      });

      const res = await window.flowBridge.generateVideo({
        prompt: node.prompt,
        modelKey: node.modelKey,
        aspectRatio: node.aspectRatio,
        duration: node.duration,
        variationsCount: node.variationsCount,
        seed: node.seed,
        projectId: state.activeProjectId,
        recaptchaToken: state.recaptchaToken || '',
      });

      const mediaItem = res.media?.[0];
      if (!mediaItem || !mediaItem.name) {
        throw new Error('Google không trả về Media ID. Phản hồi: ' + JSON.stringify(res));
      }

      node.mediaId = mediaItem.name;
      saveState();

      const result = await window.flowBridge.waitForVideoCompletion(
        node.mediaId,
        state.activeProjectId,
        (prog) => {
          console.log(`[Shot #${node.shotNumber}] Đang render... lần thử ${prog.attempts}`);
        }
      );

      node.status = 'completed';
      const opName = result.media?.name || node.mediaId;
      node.videoUrl = `https://aisandbox-pa.googleapis.com/v1/media/${opName}:download?alt=media`;

      saveState();
      renderAll();
      return result;
    } catch (err) {
      console.error(`[Shot #${node.shotNumber}] Lỗi:`, err);
      node.status = 'failed';
      renderAll();

      addLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'error',
        message: `[Shot #${node.shotNumber}] Render thất bại: ${err.message}`,
        detail: {
          error: err.message,
          httpStatus: err.status,
          url: err.url,
          rawResponse: err.rawResponse,
        },
      });

      logDrawer.classList.remove('drawer-collapsed');
    }
  }

  async function runAllShots() {
    if (state.isBatchRunning) return;
    state.isBatchRunning = true;
    state.cancelBatch = false;

    executionHud.classList.remove('hud-hidden');
    const total = state.nodes.length;

    for (let i = 0; i < total; i++) {
      if (state.cancelBatch) break;

      const node = state.nodes[i];
      execTitle.textContent = `Đang Render Shot #${node.shotNumber} / ${total}...`;
      execDesc.textContent = `Prompt: "${node.prompt.substring(0, 40)}..."`;

      try {
        await renderSingleShot(node.id);
      } catch (err) {
        console.warn('Lỗi ở shot', node.shotNumber, err);
      }
    }

    state.isBatchRunning = false;
    executionHud.classList.add('hud-hidden');
  }

  document.getElementById('hud-exec-cancel').addEventListener('click', () => {
    state.cancelBatch = true;
    state.isBatchRunning = false;
    executionHud.classList.add('hud-hidden');
  });

  const modalTimeline = document.getElementById('modal-timeline');
  const timelinePlayer = document.getElementById('timeline-video-player');
  const timelineShotsList = document.getElementById('timeline-shots-list');
  const timelineEmptyMsg = document.getElementById('timeline-empty-msg');
  const timelineCurrentName = document.getElementById('timeline-current-shot-name');

  let currentTimelineIndex = 0;
  let finishedShots = [];

  function openTimelineModal() {
    finishedShots = state.nodes.filter((n) => n.videoUrl);

    if (finishedShots.length === 0) {
      timelineEmptyMsg.style.display = 'block';
      timelinePlayer.style.display = 'none';
      timelineShotsList.innerHTML = '';
    } else {
      timelineEmptyMsg.style.display = 'none';
      timelinePlayer.style.display = 'block';

      timelineShotsList.innerHTML = finishedShots
        .map(
          (s, idx) => `
        <button class="timeline-shot-pill ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
          🎬 Shot #${s.shotNumber} (${s.duration || '8s'})
        </button>
      `
        )
        .join('');

      currentTimelineIndex = 0;
      playTimelineShot(0);

      timelineShotsList.querySelectorAll('.timeline-shot-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          playTimelineShot(idx);
        });
      });
    }

    modalTimeline.classList.remove('modal-hidden');
  }

  function playTimelineShot(idx) {
    if (idx < 0 || idx >= finishedShots.length) return;
    currentTimelineIndex = idx;
    const shot = finishedShots[idx];

    timelineShotsList.querySelectorAll('.timeline-shot-pill').forEach((b, i) => {
      b.classList.toggle('active', i === idx);
    });

    timelineCurrentName.textContent = `Đang phát: Shot #${shot.shotNumber} - "${shot.prompt.substring(0, 50)}..."`;
    timelinePlayer.src = shot.videoUrl;
    timelinePlayer.play().catch(() => {});

    timelinePlayer.onended = () => {
      if (currentTimelineIndex + 1 < finishedShots.length) {
        playTimelineShot(currentTimelineIndex + 1);
      }
    };
  }

  const modalSettings = document.getElementById('modal-settings');
  const inputToken = document.getElementById('settings-input-token');
  const inputProjectId = document.getElementById('settings-input-project-id');
  const settingsBridgeStatus = document.getElementById('settings-bridge-status');
  const settingsTokenStatus = document.getElementById('settings-token-status');

  async function checkBridgeConnection() {
    try {
      const session = await window.flowBridge.getSession();
      if (session.hasToken) {
        bridgeStatusPill.className = 'status-pill status-connected';
        bridgeStatusText.textContent = session.hasRecaptchaToken
          ? '🟢 Bridge & reCAPTCHA: Sẵn Sàng'
          : '🟢 Bridge: Sẵn Sàng (Tab Flow: Bấm "⚡ Lấy Token")';
        settingsBridgeStatus.textContent = '✅ Đã kết nối';
        settingsTokenStatus.textContent = `🔑 Token: ${session.tokenPreview} | 🛡️ reCAPTCHA: ${
          session.hasRecaptchaToken ? '✅ Đã có' : '🟡 Chưa nạp'
        }`;
        if (session.projectId) state.activeProjectId = session.projectId;
        if (session.fullToken) inputToken.value = session.fullToken;
        if (session.fullRecaptchaToken) state.recaptchaToken = session.fullRecaptchaToken;
      } else {
        bridgeStatusPill.className = 'status-pill status-connecting';
        bridgeStatusText.textContent = '🟡 Bridge: Chờ Token (Mở tab Google Flow)';
        settingsBridgeStatus.textContent = '🟡 Đã kết nối Extension nhưng chưa có Token';
        settingsTokenStatus.textContent = 'Hãy mở tab labs.google/fx/tools/flow để tự nhận Token';
      }
    } catch (_) {
      bridgeStatusPill.className = 'status-pill status-disconnected';
      bridgeStatusText.textContent = '🔴 Chưa cài Extension hoặc Reload tab';
      settingsBridgeStatus.textContent = '❌ Chưa phát hiện Extension';
      settingsTokenStatus.textContent = 'Vui lòng cài đặt Extension tại D:\\Extendtions';
    }
  }

  document.getElementById('btn-add-node').addEventListener('click', addShotNode);
  document.getElementById('btn-run-all').addEventListener('click', runAllShots);
  document.getElementById('btn-view-timeline').addEventListener('click', openTimelineModal);
  document.getElementById('btn-ai-storyboard').addEventListener('click', () => {
    if (confirm('Tạo lại 3 phân cảnh mẫu mới?')) {
      createDemoStoryboard();
    }
  });

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    inputProjectId.value = state.activeProjectId;
    modalSettings.classList.remove('modal-hidden');
    checkBridgeConnection();
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const customToken = inputToken.value.trim();
    const customProjectId = inputProjectId.value.trim();
    if (customToken || customProjectId) {
      await window.flowBridge.setToken(customToken, customProjectId);
    }
    if (customProjectId) state.activeProjectId = customProjectId;
    saveState();
    modalSettings.classList.add('modal-hidden');
    checkBridgeConnection();
  });

  document.getElementById('btn-test-bridge').addEventListener('click', checkBridgeConnection);

  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-modal');
      document.getElementById(modalId).classList.add('modal-hidden');
      if (modalId === 'modal-timeline') timelinePlayer.pause();
    });
  });

  document.getElementById('btn-save-project').addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `Flow_Storyboard_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  const fileInput = document.getElementById('file-input-project');
  document.getElementById('btn-load-project').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const loaded = JSON.parse(event.target.result);
        if (loaded.nodes) {
          state.nodes = loaded.nodes;
          state.connections = loaded.connections || [];
          state.projectTitle = loaded.projectTitle || 'Loaded Project';
          projectTitleEl.textContent = state.projectTitle;
          saveState();
          renderAll();
          alert('Đã mở kịch bản thành công!');
        }
      } catch (err) {
        alert('File kịch bản không hợp lệ: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  loadInitialStoryboard();
  updateTransform();
  setTimeout(checkBridgeConnection, 1000);
})();
