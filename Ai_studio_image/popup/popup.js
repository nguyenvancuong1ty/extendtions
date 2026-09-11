/**
 * Popup Script - Google AI Studio Image Studio
 */

document.addEventListener('DOMContentLoaded', () => {
  const statImages = document.getElementById('stat-images');
  const statApis = document.getElementById('stat-apis');
  const btnOpenAiStudio = document.getElementById('btn-open-ai-studio');
  const btnOpenPanel = document.getElementById('btn-open-panel-in-page');
  const btnQuickRun = document.getElementById('btn-quick-run');
  const quickInput = document.getElementById('quick-prompt-input');
  const recentGrid = document.getElementById('recent-images-grid');
  const btnClear = document.getElementById('btn-clear-storage');
  const statusIndicator = document.getElementById('tab-status-indicator');

  // 1. Kiểm tra tab AI Studio
  chrome.tabs.query({ url: '*://aistudio.google.com/*' }, (tabs) => {
    if (tabs && tabs.length > 0) {
      statusIndicator.innerHTML = '<span class="dot-online"></span> Đã kết nối tab AI Studio';
      statusIndicator.style.color = '#34d399';
    } else {
      statusIndicator.innerHTML = '<span class="dot-online" style="background:#f59e0b;"></span> Chưa mở AI Studio';
      statusIndicator.style.color = '#fbbf24';
    }
  });

  // 2. Load stats & recent images
  function loadData() {
    chrome.storage.local.get(['ai_studio_requests', 'ai_studio_images'], (res) => {
      const requests = res.ai_studio_requests || [];
      const images = res.ai_studio_images || [];

      if (statImages) statImages.innerText = images.length;
      if (statApis) statApis.innerText = requests.length;

      if (recentGrid) {
        if (images.length === 0) {
          recentGrid.innerHTML = '<div class="recent-empty">Chưa có ảnh nào được tạo</div>';
          return;
        }

        recentGrid.innerHTML = '';
        images.slice(0, 6).forEach((img) => {
          const div = document.createElement('div');
          div.className = 'recent-thumb';
          div.title = (img.prompt || 'AI Image') + ' (Bấm để tải về)';
          div.innerHTML = `<img src="${img.dataUrl}" alt="Thumb" />`;
          div.addEventListener('click', () => {
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_IMAGE',
              dataUrl: img.dataUrl,
              filename: 'ai_studio_' + Date.now() + '.png'
            });
          });
          recentGrid.appendChild(div);
        });
      }
    });
  }

  loadData();

  // 3. Mở Studio Panel Ngay Trên Trang
  if (btnOpenPanel) {
    btnOpenPanel.addEventListener('click', () => {
      chrome.tabs.query({ url: '*://aistudio.google.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) {
          alert('Vui lòng mở một tab AI Studio trước!');
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_STUDIO_PANEL' }, (res) => {
          window.close(); // Đóng popup để người dùng thao tác trên trang
        });
      });
    });
  }

  // 4. Mở AI Studio Tab Mới
  if (btnOpenAiStudio) {
    btnOpenAiStudio.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'OPEN_AI_STUDIO',
        url: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-lite-image'
      });
    });
  }

  // 5. Quick Prompt Generator
  if (btnQuickRun) {
    btnQuickRun.addEventListener('click', () => {
      const prompt = quickInput.value.trim();
      if (!prompt) return;

      chrome.tabs.query({ url: '*://aistudio.google.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) {
          alert('Vui lòng mở trang AI Studio trước!');
          return;
        }

        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(
          tabId,
          {
            type: 'QUICK_SUBMIT_PROMPT',
            prompt
          },
          (res) => {
            quickInput.value = '';
            alert('Đã gửi prompt tới AI Studio! Chuyển sang tab AI Studio để xem ảnh đang sinh.');
          }
        );
      });
    });
  }

  // 6. Xóa dữ liệu
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm('Xóa toàn bộ lịch sử ảnh và API đã lưu?')) {
        chrome.storage.local.set({ ai_studio_requests: [], ai_studio_images: [] }, () => {
          loadData();
        });
      }
    });
  }
});
