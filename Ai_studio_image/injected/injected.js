/**
 * Injected Script - Google AI Studio Image Sniffer & In-Tab Automation
 * Chạy trong MAIN World: Hook fetch/XHR, lưu persistent template chuẩn, In-Tab Direct API Executor
 */
(function () {
  const SENDER_ID = 'AI_STUDIO_IMAGE_SNIFFER';
  const EXECUTOR_TARGET = 'AI_STUDIO_TAB_EXECUTOR';
  const RESPONSE_TARGET = 'AI_STUDIO_TAB_EXECUTOR_RESPONSE';

  console.log('🚀 [AI Studio Image Sniffer] Injected script running in Main World...');

  // Chống Chrome background throttling khi người dùng chuyển sang tab khác
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
    window.addEventListener('webkitvisibilitychange', (e) => e.stopImmediatePropagation(), true);
  } catch (_) {}

  let lastImageRequestTemplate = null;

  // Khôi phục template từ localStorage nếu có
  try {
    const saved = localStorage.getItem('__ai_studio_last_image_template__');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (isTrueImageEndpoint(parsed.url)) {
        lastImageRequestTemplate = parsed;
        console.log('🎯 [AI Studio Sniffer] Khôi phục Request Template chuẩn từ localStorage:', lastImageRequestTemplate.url);
      }
    }
  } catch (_) {}

    // Hàm kiểm tra xem URL có đúng là endpoint sinh nội dung / ảnh hay không
  function isTrueImageEndpoint(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();

    // 1. Loại bỏ các endpoint chắc chắn không tạo ảnh
    if (u.includes('generatetitle') || u.includes('resolvedriveresource') || u.includes('submitbatchlog')) {
      return false;
    }

    // MakerSuiteService là tên service dùng chung cho rất nhiều RPC (collect,
    // GenerateTitle, lưu prompt...). Chỉ tên service không đủ để kết luận đây
    // là request sinh nội dung; nếu không template sẽ liên tục bị RPC khác ghi đè.
    return /(?:^|[\/$:.])(streamgeneratecontent|generatecontent|bidigeneratecontent)(?:$|[/?&:.])/i.test(url);
  }

  function saveTemplate(tpl) {
    if (!tpl || !tpl.url || !tpl.bodySample) return;
    if (!isTrueImageEndpoint(tpl.url) || !tpl.hasImages) return;

    lastImageRequestTemplate = tpl;
    try {
      localStorage.setItem('__ai_studio_last_image_template__', JSON.stringify(tpl));
    } catch (_) {}

    window.postMessage({
      source: SENDER_ID,
      type: 'TEMPLATE_CAPTURED',
      template: tpl
    }, '*');
    console.log('🎯 [AI Studio Sniffer] Đã lưu Request Template tạo ảnh chuẩn:', tpl.url);
  }

  function parseHeaders(headers) {
    const result = {};
    if (!headers) return result;
    try {
      if (headers instanceof Headers) {
        headers.forEach((val, key) => {
          result[key.toLowerCase()] = val;
        });
      } else if (Array.isArray(headers)) {
        headers.forEach(([k, v]) => {
          result[k.toLowerCase()] = v;
        });
      } else if (typeof headers === 'object') {
        Object.keys(headers).forEach((k) => {
          result[k.toLowerCase()] = headers[k];
        });
      }
    } catch (e) {
      console.warn('[AI Studio Sniffer] parseHeaders error:', e);
    }
    return result;
  }

  async function parseBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      try {
        let clean = body;
        if (clean.startsWith(")]}'")) clean = clean.substring(4).trim();
        return JSON.parse(clean);
      } catch {
        return body;
      }
    }
    if (body instanceof FormData) {
      const obj = {};
      body.forEach((value, key) => {
        obj[key] = value instanceof File ? `[File: ${value.name} (${value.size}B)]` : value;
      });
      return { _type: 'FormData', data: obj };
    }
    try {
      return JSON.parse(JSON.stringify(body));
    } catch {
      return String(body);
    }
  }

  function extractPromptFromPayload(payload) {
    if (!payload) return '';
    try {
      if (typeof payload === 'string') {
        try {
          let clean = payload;
          if (clean.startsWith(")]}'")) clean = clean.substring(4).trim();
          payload = JSON.parse(clean);
        } catch {
          return payload.substring(0, 300);
        }
      }

      if (payload.contents && Array.isArray(payload.contents)) {
        for (let i = payload.contents.length - 1; i >= 0; i--) {
          const item = payload.contents[i];
          if (item.parts && Array.isArray(item.parts)) {
            for (const part of item.parts) {
              if (part.text && typeof part.text === 'string') {
                return part.text.trim();
              }
            }
          }
        }
      }

      if (payload.prompt && typeof payload.prompt === 'string') return payload.prompt.trim();
      if (payload.userTurn && payload.userTurn.text) return payload.userTurn.text.trim();
      if (payload.textPrompt) return payload.textPrompt.trim();

      const jsonStr = JSON.stringify(payload);
      const textMatch = jsonStr.match(/"text"\s*:\s*"([^"]+)"/);
      if (textMatch && textMatch[1]) {
        return textMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
      }
    } catch (e) {
      console.warn('[AI Studio Sniffer] extractPrompt error:', e);
    }
    return '';
  }

  // Payload nội bộ của AI Studio lưu hội thoại dưới dạng protobuf JSON array:
  // mỗi turn là một array có một phần tử role "user" và nội dung nằm trong
  // phần tử anh em. Lấy prompt ở user turn cuối cùng, không dựa vào DOM.
  function extractLastUserPromptFromRpc(payload) {
    let lastPrompt = '';

    const collectNaturalStrings = (value, output) => {
      if (typeof value === 'string') {
        const text = value.trim();
        if (
          text && text.length <= 2000 &&
          !/^(user|model|assistant|thinking|text|image)$/i.test(text) &&
          !/^models\//i.test(text) &&
          !/^(image|application)\//i.test(text) &&
          !/^https?:\/\//i.test(text)
        ) output.push(text);
        return;
      }
      if (Array.isArray(value)) value.forEach((item) => collectNaturalStrings(item, output));
      else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectNaturalStrings(item, output));
    };

    const walk = (value) => {
      if (Array.isArray(value)) {
        const roleIndex = value.findIndex((item) => typeof item === 'string' && item.toLowerCase() === 'user');
        if (roleIndex >= 0) {
          const candidates = [];
          value.forEach((item, index) => {
            if (index !== roleIndex) collectNaturalStrings(item, candidates);
          });
          if (candidates.length) lastPrompt = candidates[candidates.length - 1];
        }
        value.forEach(walk);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(walk);
      }
    };

    try { walk(payload); } catch (_) {}
    return lastPrompt;
  }

  // Đệ quy quét response tìm hình ảnh (hỗ trợ cả JSON lồng chuỗi string trong Google RPC)
  function extractImagesFromResponse(data, promptText = '') {
    const images = [];
    if (!data) return images;

    function walk(obj) {
      if (!obj) return;

      // Unpack chuỗi JSON lồng nhau trong Google RPC
      if (typeof obj === 'string') {
        if (obj.includes('inlineData') || obj.includes('imageBytes') || obj.includes('data:image')) {
          try {
            const inner = JSON.parse(obj);
            walk(inner);
          } catch (_) {}
        }
        return;
      }

      if (typeof obj !== 'object') return;

      if (obj.inlineData && obj.inlineData.data) {
        const mime = obj.inlineData.mimeType || 'image/png';
        const b64 = obj.inlineData.data;
        images.push({
          id: 'img_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
          mimeType: mime,
          base64: b64,
          dataUrl: b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`,
          prompt: promptText || '',
          timestamp: Date.now(),
          sizeApprox: Math.round((b64.length * 3) / 4)
        });
      }

      if (obj.imageBytes && typeof obj.imageBytes === 'string' && obj.imageBytes.length > 500) {
        const mime = obj.mimeType || 'image/png';
        const b64 = obj.imageBytes;
        images.push({
          id: 'img_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
          mimeType: mime,
          base64: b64,
          dataUrl: b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`,
          prompt: promptText || '',
          timestamp: Date.now(),
          sizeApprox: Math.round((b64.length * 3) / 4)
        });
      }

      if (obj.b64_json && typeof obj.b64_json === 'string' && obj.b64_json.length > 500) {
        const mime = 'image/png';
        const b64 = obj.b64_json;
        images.push({
          id: 'img_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
          mimeType: mime,
          base64: b64,
          dataUrl: `data:${mime};base64,${b64}`,
          prompt: promptText || '',
          timestamp: Date.now(),
          sizeApprox: Math.round((b64.length * 3) / 4)
        });
      }

      if (typeof obj.url === 'string' && (obj.url.includes('googleusercontent.com') || obj.url.match(/\.(png|jpe?g|webp)($|\?)/i))) {
        images.push({
          id: 'img_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
          mimeType: 'image/png',
          base64: null,
          dataUrl: obj.url,
          prompt: promptText || '',
          timestamp: Date.now(),
          isRemoteUrl: true
        });
      }

      for (const k of Object.keys(obj)) {
        if (typeof obj[k] === 'object' || typeof obj[k] === 'string') {
          walk(obj[k]);
        }
      }
    }

    try {
      walk(data);
    } catch (e) {
      console.warn('[AI Studio Sniffer] Walk response error:', e);
    }

        // Failsafe regex search: Chỉ quét các trường ảnh đặc trưng (tránh nhầm lẫn Drive/Auth metadata)
    if (images.length === 0 && data) {
      try {
        const rawStr = typeof data === 'string' ? data : JSON.stringify(data);
        if (rawStr.includes('image') || rawStr.includes('inlineData') || rawStr.includes('imageBytes')) {
          const patterns = [
            /"(?:imageBytes|b64_json|bytesBase64Encoded)"\s*:\s*"([A-Za-z0-9+/=]{100,})"/g,
            /"inlineData"\s*:\s*\{[^}]*"data"\s*:\s*"([A-Za-z0-9+/=]{100,})"/g,
            /data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]{100,})/g
          ];
          for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(rawStr)) !== null) {
              const b64 = match[1];
              if (!images.some((img) => img.base64 && img.base64.slice(0, 50) === b64.slice(0, 50))) {
                images.push({
                  id: 'img_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
                  mimeType: 'image/png',
                  base64: b64,
                  dataUrl: `data:image/png;base64,${b64}`,
                  prompt: promptText || '',
                  timestamp: Date.now(),
                  sizeApprox: Math.round((b64.length * 3) / 4)
                });
              }
            }
            if (images.length > 0) break;
          }
        }
      } catch (err) {
        console.warn('[AI Studio Sniffer] Regex image fallback error:', err);
      }
    }

    return images;
  }

  function notifyCaptured(reqData, extractedImages = []) {
    window.postMessage(
      {
        source: SENDER_ID,
        type: 'API_CAPTURED',
        payload: reqData,
        images: extractedImages || []
      },
      '*'
    );
  }

  // 1. Hook fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const startTime = Date.now();
    const id = 'req_' + Math.random().toString(36).substr(2, 9) + '_' + startTime;

    let url = '';
    let method = 'GET';
    let reqHeaders = {};
    let reqBody = null;

    try {
      if (typeof args[0] === 'string') {
        url = args[0];
      } else if (args[0] instanceof Request) {
        url = args[0].url;
        method = args[0].method || 'GET';
        reqHeaders = parseHeaders(args[0].headers);
        try {
          const cloneReq = args[0].clone();
          reqBody = await cloneReq.text();
        } catch (_) {}
      } else if (args[0] instanceof URL) {
        url = args[0].toString();
      }

      if (args[1] && typeof args[1] === 'object') {
        if (args[1].method) method = args[1].method.toUpperCase();
        if (args[1].headers) {
          reqHeaders = { ...reqHeaders, ...parseHeaders(args[1].headers) };
        }
        if (args[1].body) {
          reqBody = args[1].body;
        }
      }

      try {
        url = new URL(url, window.location.href).href;
      } catch (_) {}
    } catch (err) {
      console.warn('[AI Studio Sniffer] Error parsing fetch input:', err);
    }

    const parsedReqBody = await parseBody(reqBody);
    const promptText = extractPromptFromPayload(parsedReqBody);
        const isImageEndpoint = isTrueImageEndpoint(url);

    // Gửi log mạng về Content Script cho Live Logs
    const endpointShort = (url || '').split('/').pop().split('?')[0] || url;
    if (method === 'POST' && !url.includes('google-analytics') && !url.includes('doubleclick') && !url.includes('telemetry')) {
      window.postMessage({
        source: SENDER_ID,
        type: 'LOG_NETWORK',
        method,
        endpointShort,
        url,
        isImageEndpoint
      }, '*');
    }

    try {
      const response = await originalFetch.apply(this, args);
      const endTime = Date.now();
      const duration = endTime - startTime;

      const cloneRes = response.clone();
      let resHeaders = {};
      try {
        resHeaders = parseHeaders(cloneRes.headers);
      } catch (_) {}

      let resBody = null;
      let contentType = resHeaders['content-type'] || '';

      try {
        let text = await cloneRes.text();
        if (text.startsWith(")]}'")) {
          text = text.substring(4).trim();
        }
        try {
          resBody = JSON.parse(text);
        } catch {
          if (text.includes('data: ') || text.includes('"inlineData"') || text.includes('imageBytes')) {
            try {
              const lines = text.split('\n');
              const parsedChunks = [];
              for (const line of lines) {
                const clean = line.replace(/^data:\s*/, '').trim();
                if (clean && clean !== '[DONE]') {
                  try { parsedChunks.push(JSON.parse(clean)); } catch (_) {}
                }
              }
              resBody = parsedChunks.length > 0 ? parsedChunks : text;
            } catch {
              resBody = text.length > 50000 ? text.substring(0, 50000) + '... [Truncated]' : text;
            }
          } else {
            resBody = text.length > 50000 ? text.substring(0, 50000) + '... [Truncated]' : text;
          }
        }
      } catch (err) {
        resBody = '[Error parsing response body]';
      }

      const extractedImages = extractImagesFromResponse(resBody, promptText);

      // Chỉ một response thực sự có ảnh mới được phép trở thành template.
      // Endpoint GenerateContent cũng phục vụ text, title và nhiều tác vụ phụ.
      if (method === 'POST' && response.ok && isImageEndpoint && extractedImages.length > 0) {
        saveTemplate({
          url,
          headers: reqHeaders,
          method,
          bodySample: parsedReqBody,
          capturedAt: Date.now(),
          prompt: promptText,
          hasImages: extractedImages.length > 0
        });
      }

      if (isImageEndpoint || extractedImages.length > 0) {
        notifyCaptured(
          {
            id,
            type: 'fetch',
            url,
            method,
            headers: reqHeaders,
            body: parsedReqBody,
            prompt: promptText,
            status: response.status,
            statusText: response.statusText,
            resHeaders,
            response: resBody,
            timestamp: startTime,
            duration,
            isImageApi: extractedImages.length > 0 || isImageEndpoint
          },
          extractedImages
        );
      }

      return response;
    } catch (error) {
      const endTime = Date.now();
      if (isImageEndpoint) {
        notifyCaptured(
          {
            id,
            type: 'fetch',
            url,
            method,
            headers: reqHeaders,
            body: parsedReqBody,
            prompt: promptText,
            status: 0,
            statusText: 'Failed / Network Error',
            resHeaders: {},
            response: { error: error.message || String(error) },
            timestamp: startTime,
            duration: endTime - startTime,
            isImageApi: isImageEndpoint
          },
          []
        );
      }
      throw error;
    }
  };

  // 2. Hook XMLHttpRequest
  const XHR = window.XMLHttpRequest;
  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalSetRequestHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function (method, url, ...rest) {
    this._sniffer_data = {
      id: 'xhr_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
      method: (method || 'GET').toUpperCase(),
      url: typeof url === 'string' ? url : String(url),
      headers: {},
      startTime: Date.now()
    };
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XHR.prototype.setRequestHeader = function (header, value) {
    if (this._sniffer_data && this._sniffer_data.headers) {
      this._sniffer_data.headers[header.toLowerCase()] = value;
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XHR.prototype.send = function (body) {
    if (!this._sniffer_data) {
      return originalSend.apply(this, arguments);
    }

    const data = this._sniffer_data;
    data.rawBody = body;

    const onComplete = async () => {
      const endTime = Date.now();
      const duration = endTime - data.startTime;

      let resBody = null;
      try {
        let text = this.responseText;
        if (text && text.startsWith(")]}'")) text = text.substring(4).trim();
        try {
          resBody = JSON.parse(text);
        } catch {
          resBody = text && text.length > 50000 ? text.substring(0, 50000) + '... [Truncated]' : text;
        }
      } catch (_) {}

      const parsedBody = await parseBody(body);
      const promptText = extractPromptFromPayload(parsedBody);
      const extractedImages = extractImagesFromResponse(resBody, promptText);
      const isImageEndpoint = isTrueImageEndpoint(data.url);

      if (data.method === 'POST' && this.status >= 200 && this.status < 300 && isImageEndpoint && extractedImages.length > 0) {
        saveTemplate({
          url: data.url,
          headers: data.headers,
          method: data.method,
          bodySample: parsedBody,
          capturedAt: Date.now(),
          prompt: promptText,
          hasImages: extractedImages.length > 0
        });
      }

      if (isImageEndpoint || extractedImages.length > 0) {
        notifyCaptured(
          {
            id: data.id,
            type: 'xhr',
            url: data.url,
            method: data.method,
            headers: data.headers,
            body: parsedBody,
            prompt: promptText,
            status: this.status,
            statusText: this.statusText,
            response: resBody,
            timestamp: data.startTime,
            duration,
            isImageApi: extractedImages.length > 0 || isImageEndpoint
          },
          extractedImages
        );
      }
    };

    this.addEventListener('load', onComplete);
    this.addEventListener('error', onComplete);

    return originalSend.apply(this, arguments);
  };

  // 3. In-Tab Executor
  function fetchThroughExtension(request) {
    return new Promise((resolve, reject) => {
      const requestId = 'bg_fetch_' + Math.random().toString(36).slice(2) + '_' + Date.now();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onResponse);
        reject(new Error('Background fetch timeout (90s)'));
      }, 90000);
      function onResponse(event) {
        if (event.source !== window || event.data?.target !== 'AI_STUDIO_BACKGROUND_FETCH_RESPONSE' || event.data.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener('message', onResponse);
        if (event.data.result?.success) resolve(event.data.result);
        else reject(new Error(event.data.result?.error || 'Background fetch failed'));
      }
      window.addEventListener('message', onResponse);
      window.postMessage({ target: 'AI_STUDIO_BACKGROUND_FETCH_REQUEST', requestId, request }, '*');
    });
  }

  function prepareReplayCookie(cookie) {
    return new Promise((resolve) => {
      const requestId = 'cookie_' + Math.random().toString(36).slice(2) + '_' + Date.now();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onResponse);
        resolve({ success: false, error: 'Debugger prepare timeout' });
      }, 10000);
      function onResponse(event) {
        if (event.source !== window || event.data?.target !== 'AI_STUDIO_PREPARE_REPLAY_COOKIE_RESPONSE' || event.data.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener('message', onResponse);
        resolve(event.data.result || { success: false, error: 'No debugger response' });
      }
      window.addEventListener('message', onResponse);
      window.postMessage({ target: 'AI_STUDIO_PREPARE_REPLAY_COOKIE', requestId, cookie }, '*');
    });
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.target !== EXECUTOR_TARGET) {
      return;
    }

    const { requestId, action, payload } = event.data;

    const reply = (success, data = null, error = null) => {
      window.postMessage(
        {
          target: RESPONSE_TARGET,
          requestId,
          success,
          data,
          error
        },
        '*'
      );
    };

    try {
      // Action: DOM_SUBMIT_PROMPT (UI Automation)
      if (action === 'DOM_SUBMIT_PROMPT') {
        const promptToRun = (payload.prompt || '').trim();
        if (!promptToRun) {
          return reply(false, null, 'Prompt không được để trống!');
        }

        console.log('🤖 [AI Studio UI] Bắt đầu điền prompt:', promptToRun);

        // 1. Tìm ô nhập prompt trên trang AI Studio
        const selectors = [
          'textarea[placeholder*="Start typing" i]',
          'textarea[placeholder*="Type something" i]',
          'textarea[placeholder*="prompt" i]',
          'ms-prompt-textarea textarea',
          'ms-chat-turn textarea',
          'textarea.chat-input',
          'div[contenteditable="true"][aria-label*="prompt" i]',
          'div[contenteditable="true"]',
          'textarea'
        ];

        let targetInput = null;
        for (const sel of selectors) {
          const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
            if (el.closest && el.closest('#ai-studio-root')) return false;
            // Bỏ qua textarea trong khung cài đặt System Instructions
            if (el.closest && el.closest('ms-system-instructions, .system-instructions, ms-system-prompt')) return false;
            return el.offsetParent !== null;
          });
          if (els.length > 0) {
            // LUÔN LẤY Ô NHẬP Ở DƯỚI ĐÁY CÙNG (ô nhập chat hiện tại, không lấy các lượt chat cũ phía trên)
            targetInput = els[els.length - 1];
            break;
          }
        }

        if (!targetInput) {
          return reply(false, null, 'Không tìm thấy khung nhập Prompt trên trang AI Studio!');
        }

        // 2. Chờ AI Studio idle nếu lượt trước chưa xong (nút Stop vẫn hiển thị)
        for (let waitStop = 0; waitStop < 30; waitStop++) {
          const btns = Array.from(document.querySelectorAll('button')).filter(
            (b) => !b.closest('#ai-studio-root') && b.offsetParent !== null
          );
          const stopBtn = btns.find((b) => {
            const t = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
            return t.includes('stop') || t.includes('dừng') || t.includes('cancel');
          });
          if (!stopBtn) break;
          console.log('⏳ [AI Studio UI] Đang đợi lượt trước kết thúc...');
          await new Promise((r) => setTimeout(r, 1000));
        }

        // 3. Xóa giá trị cũ và điền prompt mới bằng execCommand (chuẩn người dùng gõ thật)
        targetInput.focus();
        targetInput.select();

        let inserted = false;
        try {
          document.execCommand('selectAll', false, null);
          inserted = document.execCommand('insertText', false, promptToRun);
        } catch (_) {}

        if (!inserted || targetInput.value !== promptToRun) {
          const setter =
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

          if (setter) {
            setter.call(targetInput, promptToRun);
          } else {
            targetInput.value = promptToRun;
          }
        }

        targetInput.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptToRun }));
        targetInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptToRun }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

        // Gửi Ctrl+Enter NGAY LẬP TỨC khi ô nhập đang có nội dung đầy đủ (kích hoạt lệnh Run bản địa của AI Studio)
        const enterEvtInit = {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          composed: true
        };
        targetInput.dispatchEvent(new KeyboardEvent('keydown', enterEvtInit));
        targetInput.dispatchEvent(new KeyboardEvent('keypress', enterEvtInit));
        targetInput.dispatchEvent(new KeyboardEvent('keyup', enterEvtInit));

        // 4. Tìm NÚT GỬI PROMPT (Chỉ tìm ở thanh công cụ dưới đáy, TUYỆT ĐỐI không tìm trong tin nhắn chat cũ!)
        function isSubmitButtonCandidate(b) {
          if (!b) return false;
          if (b.closest && b.closest('#ai-studio-root')) return false;
          if (b.offsetParent === null) return false;
          if (b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('disabled')) return false;

          // TUYỆT ĐỐI BỎ QUA nút bên trong các lượt chat cũ (đây là nơi chứa nút Rerun tạo lại ảnh cũ!)
          if (b.closest && b.closest('ms-chat-turn:not(:has(textarea)), .chat-turn:not(:has(textarea)), ms-turn-actions, .turn-actions, .response-actions')) return false;

          const text = (b.innerText || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const tooltip = (b.getAttribute('mattooltip') || b.getAttribute('title') || '').toLowerCase();

          // TUYỆT ĐỐI BỎ QUA rerun, retry, edit, thumbs, copy, share, delete, tools, mic
          if (
            text.includes('rerun') || aria.includes('rerun') || tooltip.includes('rerun') ||
            text.includes('retry') || aria.includes('retry') || tooltip.includes('retry') ||
            text.includes('tools') || aria.includes('tool') ||
            text.includes('mic') || aria.includes('mic') || aria.includes('voice') ||
            text.includes('thumb') || aria.includes('thumb') ||
            text.includes('copy') || aria.includes('copy') ||
            text.includes('edit') || aria.includes('edit') ||
            text.includes('delete') || aria.includes('delete') ||
            text.includes('settings') || aria.includes('setting')
          ) {
            return false;
          }

          // Khớp chính xác Run, Add hoặc Send (không bị dính chữ rerun)
          const isRun = /^run\b/i.test(text) || /^run\b/i.test(aria) || /^run\b/i.test(tooltip) || b.classList.contains('run-button');
          const isAdd = /^add\b/i.test(text) || /^add\b/i.test(aria) || /^add\b/i.test(tooltip);
          const isSend = /^send\b/i.test(text) || /^send\b/i.test(aria) || /^send\b/i.test(tooltip) || b.classList.contains('send-button');

          return isRun || isAdd || isSend;
        }

        function findSubmitButton() {
          // 1. Leo dần từ targetInput lên các cấp cha (tìm nút trong cùng khung nhập liệu)
          let curr = targetInput.parentElement;
          while (curr && curr !== document.body) {
            const btns = Array.from(curr.querySelectorAll('button, [role="button"]'));
            for (const b of btns) {
              if (isSubmitButtonCandidate(b)) return b;
            }
            // Dừng lại nếu đã ra tới khung editor lớn
            if (curr.tagName === 'MS-PROMPT-EDITOR' || curr.tagName === 'MS-CHAT-INPUT') break;
            curr = curr.parentElement;
          }

          // 2. Nếu leo lên chưa thấy, tìm từ DƯỚI LÊN TRÊN toàn trang (ưu tiên nút ở thanh đáy)
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
          for (let i = allButtons.length - 1; i >= 0; i--) {
            const b = allButtons[i];
            if (isSubmitButtonCandidate(b)) return b;
          }

          return null;
        }

        // 5. Chờ nút submit sáng lên và click (thử tối đa 3 giây)
        let clicked = false;
        let lastClickedBtn = null;
        for (let attempt = 0; attempt < 30; attempt++) {
          const btn = findSubmitButton();
          if (btn) {
            const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled');
            if (!isDisabled) {
              btn.focus();
              btn.click();
              clicked = true;
              lastClickedBtn = btn;
              console.log('✅ [AI Studio UI] Đã click nút Submit thành công:', btn);
              break;
            }
          }
          // Kích thích nhẹ input nếu Angular cần
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 100));
        }

        // Nếu vừa bấm nút "Add", chờ nút chuyển sang "Run" và bấm tiếp nút Run (không giới hạn khác node object)
        if (clicked && lastClickedBtn) {
          const btnText = (lastClickedBtn.innerText || '').trim().toLowerCase();
          const btnAria = (lastClickedBtn.getAttribute('aria-label') || '').toLowerCase();
          if (btnText.startsWith('add') || btnAria.includes('add')) {
            await new Promise((r) => setTimeout(r, 350));
            // Thử tìm nút trong tối đa 15 lần (1.5 giây)
            for (let rAttempt = 0; rAttempt < 15; rAttempt++) {
              const nextBtn = findSubmitButton();
              if (nextBtn) {
                const nextText = (nextBtn.innerText || '').trim().toLowerCase();
                const nextAria = (nextBtn.getAttribute('aria-label') || '').toLowerCase();
                if (nextText.startsWith('run') || nextAria.includes('run') || !nextText.startsWith('add')) {
                  nextBtn.focus();
                  nextBtn.click();
                  console.log('✅ [AI Studio UI] Đã click tiếp nút Run sau khi Add:', nextBtn);
                  break;
                }
              }
              await new Promise((r) => setTimeout(r, 100));
            }
          }
        }

        // Gửi thêm Ctrl+Enter dự phòng
        targetInput.dispatchEvent(new KeyboardEvent('keydown', enterEvtInit));
        targetInput.dispatchEvent(new KeyboardEvent('keyup', enterEvtInit));

        return reply(true, { message: 'Đã gửi prompt vào AI Studio thành công!', prompt: promptToRun });
      }

      // Action: DIRECT_API_GENERATE
      if (action === 'DIRECT_API_GENERATE') {
        const promptToRun = payload.prompt || '';
        if (!promptToRun) {
          return reply(false, null, 'Prompt không được để trống!');
        }

        let activeTemplate = payload.template || lastImageRequestTemplate;
        if (!activeTemplate || !isTrueImageEndpoint(activeTemplate.url)) {
          try {
            const saved = localStorage.getItem('__ai_studio_last_image_template__');
            if (saved) {
              const p = JSON.parse(saved);
              if (isTrueImageEndpoint(p.url)) activeTemplate = p;
            }
          } catch (_) {}
        }

        if (!activeTemplate || !activeTemplate.url) {
          return reply(false, null, 'NEED_BOOTSTRAP_TEMPLATE');
        }

        const endpointName = activeTemplate.url.split('/').pop().split('?')[0];
        console.log('⚡ [AI Studio Sniffer] Direct API Executing to endpoint:', endpointName, activeTemplate.url);
        if (activeTemplate.url.toLowerCase().includes('generatetitle')) {
          return reply(false, null, 'LỖI: Request template đang là GenerateTitle (chỉ đặt tên chat), không phải GenerateContent/StreamGenerateContent. Hãy tạo 1 ảnh trên AI Studio để bắt lại đúng endpoint!');
        }

        const reqBody = JSON.parse(JSON.stringify(activeTemplate.bodySample || {}));

        let replaced = false;
        const rpcUserPrompt = extractLastUserPromptFromRpc(activeTemplate.bodySample);
        const oldPrompt = rpcUserPrompt || activeTemplate.prompt || extractPromptFromPayload(activeTemplate.bodySample);
        if (reqBody.contents && Array.isArray(reqBody.contents)) {
          const lastContent = reqBody.contents[reqBody.contents.length - 1];
          if (lastContent && lastContent.parts && Array.isArray(lastContent.parts)) {
            for (const p of lastContent.parts) {
              if (typeof p.text === 'string') {
                p.text = promptToRun;
                replaced = true;
                break;
              }
            }
          }
        }

        if (!replaced && reqBody.prompt) {
          reqBody.prompt = promptToRun;
          replaced = true;
        }

        let bodyPayloadToSend = reqBody;
        if (!replaced) {
          // Google RPC có thể bọc payload trong object/array nhiều tầng. Thay
          // đúng string prompt cũ trên cây dữ liệu để không làm hỏng JSON escape.
          const replacePromptDeep = (value) => {
            if (typeof value === 'string') {
              if (oldPrompt && (value === oldPrompt || value.trim() === oldPrompt.trim())) {
                replaced = true;
                return promptToRun;
              }
              return value;
            }
            if (Array.isArray(value)) return value.map(replacePromptDeep);
            if (value && typeof value === 'object') {
              Object.keys(value).forEach((key) => {
                value[key] = replacePromptDeep(value[key]);
              });
            }
            return value;
          };
          bodyPayloadToSend = replacePromptDeep(reqBody);
        }

        if (!replaced) {
          const stringCandidates = [];
          const replaceTargets = [];
          const collectStrings = (value, path = '$') => {
            if (stringCandidates.length >= 12) return;
            if (typeof value === 'string') {
              if (value.trim() && value.length <= 300) {
                stringCandidates.push(path + '=' + JSON.stringify(value));
                if (
                  value.length <= 200 &&
                  /[a-zA-ZÀ-ỹ]/.test(value) &&
                  !/^(user|model|text|image|true|false|null)$/i.test(value) &&
                  !/https?:|image\/|gemini-|application\/|^[A-Z0-9_:.\/-]+$/.test(value)
                ) {
                  replaceTargets.push({ value, path });
                }
              }
              return;
            }
            if (Array.isArray(value)) {
              value.forEach((item, index) => collectStrings(item, path + '[' + index + ']'));
            } else if (value && typeof value === 'object') {
              Object.keys(value).forEach((key) => collectStrings(value[key], path + '.' + key));
            }
          };
          collectStrings(reqBody);

          // Payload protobuf dạng array không có key `text`. Với request ảnh đã
          // được bắt đúng endpoint, chuỗi ngôn ngữ tự nhiên cuối cùng thường là
          // prompt của user. Chỉ dùng fallback khi có đúng một ứng viên an toàn.
          if (replaceTargets.length === 1) {
            const targetValue = replaceTargets[0].value;
            const replaceExactDeep = (value) => {
              if (typeof value === 'string') return value === targetValue ? promptToRun : value;
              if (Array.isArray(value)) return value.map(replaceExactDeep);
              if (value && typeof value === 'object') {
                Object.keys(value).forEach((key) => { value[key] = replaceExactDeep(value[key]); });
              }
              return value;
            };
            bodyPayloadToSend = replaceExactDeep(reqBody);
            replaced = true;
          } else {
            return reply(false, null, 'Không tìm thấy prompt cũ ' + JSON.stringify(oldPrompt || '') + ' trong payload. Chuỗi ứng viên: ' + stringCandidates.join(' | '));
          }
        }

        // webRequest trả cả các header do Chrome/HTTP2 tự quản lý. Replay các
        // header đó có thể làm fetch bị chặn trước khi gửi (TypeError: Failed to
        // fetch). Chỉ giữ header mà API thực sự cần.
        const allowedHeaderNames = new Set([
          'accept',
          'authorization',
          'content-type',
          'x-origin',
          // Present on every successful MakerSuite RPC in the captured trace.
          // Unlike x-browser-* this is an application header and is CORS-safe.
          'x-user-agent'
        ]);
        const fetchHeaders = {};
        for (const [headerName, headerValue] of Object.entries(activeTemplate.headers || {})) {
          const normalizedName = headerName.toLowerCase();
          if ((allowedHeaderNames.has(normalizedName) ||
              normalizedName.startsWith('x-goog-') ||
              // These carry AI Studio's current visit/tier context and are accepted
              // by the MakerSuite RPC CORS policy. x-browser-*, x-client-data and
              // x-user-agent are browser-managed; replaying them causes fetch to be
              // blocked before the request reaches Google.
              normalizedName.startsWith('x-aistudio-')) &&
              typeof headerValue === 'string') {
            fetchHeaders[normalizedName] = headerValue;
          }
        }
        if (!fetchHeaders['content-type']) fetchHeaders['content-type'] = 'application/json';

        let res;
        try {
          const cookieHeader = activeTemplate.headers?.cookie;
          if (cookieHeader) {
            const prepared = await prepareReplayCookie(cookieHeader);
            if (!prepared.success) console.warn('[AI Studio Sniffer] Cookie interception unavailable:', prepared.error);
          }
          res = await originalFetch(activeTemplate.url, {
            method: activeTemplate.method || 'POST',
            headers: fetchHeaders,
            body: JSON.stringify(bodyPayloadToSend),
            credentials: 'include'
          });
        } catch (fetchError) {
          let endpointOrigin = '';
          try { endpointOrigin = new URL(activeTemplate.url).origin; } catch (_) {}
          return reply(false, null,
            'FETCH_BLOCKED: ' + (fetchError?.message || String(fetchError)) +
            ' | endpoint=' + endpointOrigin +
            ' | headers=' + Object.keys(fetchHeaders).join(',') +
            ' | bodyType=' + (Array.isArray(bodyPayloadToSend) ? 'array' : typeof bodyPayloadToSend)
          );
        }

        const rawText = await res.text();
        let resJson = null;
        let cleanText = rawText;
        if (cleanText.startsWith(")]}'")) cleanText = cleanText.substring(4).trim();
        try {
          resJson = JSON.parse(cleanText);
        } catch {
          // Parse SSE stream chunks
          const lines = cleanText.split('\n');
          const chunks = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const dataContent = trimmed.slice(5).trim();
              if (dataContent && dataContent !== '[DONE]') {
                try {
                  chunks.push(JSON.parse(dataContent));
                } catch (_) {}
              }
            }
          }
          resJson = chunks.length > 0 ? chunks : cleanText;
        }

        if (!res.ok) {
          const authInfo = [
            'authorization=' + (fetchHeaders.authorization ? 'yes' : 'no'),
            'apiKey=' + (fetchHeaders['x-goog-api-key'] ? 'yes' : 'no'),
            'authUser=' + (fetchHeaders['x-goog-authuser'] || 'none'),
            'transport=page',
            'authAgeSec=' + (activeTemplate.authRefreshedAt ? Math.round((Date.now() - activeTemplate.authRefreshedAt) / 1000) : 'stale-template')
          ].join(',');
          return reply(false, null, 'API Error (' + res.status + ') [' + authInfo + ']: ' + (typeof resJson === 'object' ? JSON.stringify(resJson) : rawText.substring(0, 300)));
        }

        const extractedImages = extractImagesFromResponse(resJson, promptToRun);

        if (!extractedImages || extractedImages.length === 0) {
          const preview = rawText.length > 250 ? rawText.substring(0, 250) + '...' : rawText;
          console.warn('[AI Studio Sniffer] Response không chứa dữ liệu ảnh:', preview);
          return reply(false, null, 'API phản hồi (Status ' + res.status + ') nhưng không tìm thấy ảnh Base64. Phản hồi: ' + preview);
        }

        return reply(true, {
          images: extractedImages,
          rawResponse: resJson,
          prompt: promptToRun
        });
      }

      reply(false, null, 'Action không hợp lệ: ' + action);
    } catch (err) {
      console.error('[AI Studio Sniffer] Executor error:', err);
      reply(false, null, err.message || String(err));
    }
  });

  console.log('✅ [AI Studio Image Sniffer] Hook & In-Tab Executor Ready.');
})();
