/**
 * Injected Script - Google Labs Flow API Hook & In-Tab Executor (V2.2 Full Features & Download API)
 */
(function () {
  const SENDER_ID = 'FLOW_API_SNIFFER';
  const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
  let lastCapturedRecaptchaToken = '';

  // Chống Chrome background throttling khi người dùng chuyển sang tab khác
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
    window.addEventListener('webkitvisibilitychange', (e) => e.stopImmediatePropagation(), true);
  } catch (_) {}

  let lastCapturedAuthHeader = '';
  let lastCapturedImageApiTemplate = null;
  let lastCapturedBoqParams = {
    fSid: '8866498657022135732',
    bl: 'boq_labs-ai-sandbox-frontend_20260909.10_p0',
    at: 'AIQ-s5iTNlpxKFqhFYgT3czlS-5z:1789119960414',
    projectId: '622115a8-5f52-407b-82be-8323e88b9a1a'
  };

  try {
    const saved = localStorage.getItem('__flow_image_api_template__');
    if (saved) lastCapturedImageApiTemplate = JSON.parse(saved);
  } catch (_) {}

  try {
    const savedBoq = localStorage.getItem('__flow_boq_params__');
    if (savedBoq) lastCapturedBoqParams = { ...lastCapturedBoqParams, ...JSON.parse(savedBoq) };
  } catch (_) {}

  try {
    const savedRecaptcha = localStorage.getItem('__flow_recaptcha_token__');
    if (savedRecaptcha) lastCapturedRecaptchaToken = savedRecaptcha;
  } catch (_) {}

  // Trích xuất tức thời thông số phiên Google Flow từ mọi gói tin URL & Body
  function extractBoqParamsFromUrlAndBody(url, body) {
    if (!url || !url.includes('/AiSandboxAngularFrontend/data/batchexecute')) return;
    try {
      const u = new URL(url, window.location.origin);
      const fSid = u.searchParams.get('f.sid');
      const bl = u.searchParams.get('bl');
      const sp = u.searchParams.get('source-path');
      const projMatch = (sp || '').match(/\/project\/([a-zA-Z0-9_\-]+)/i);
      const projectId = projMatch ? projMatch[1] : '';

      let at = '';
      if (body && typeof body === 'string') {
        const qs = new URLSearchParams(body);
        at = qs.get('at') || '';

        const fReq = qs.get('f.req');
        if (fReq && fReq.includes('ogiZ0b')) {
          try {
            const parsed = JSON.parse(fReq);
            const inner = JSON.parse(parsed[0][0][1]);
            const tokenFromPayload = inner?.[1]?.[0]?.[7]?.[10]?.[0] || inner?.[3]?.[10]?.[0];
            if (tokenFromPayload && typeof tokenFromPayload === 'string' && tokenFromPayload.length > 20) {
              lastCapturedRecaptchaToken = tokenFromPayload;
              try { localStorage.setItem('__flow_recaptcha_token__', tokenFromPayload); } catch (_) {}
            }
          } catch (_) {}
        }
      }

      if (fSid || at || projectId) {
        lastCapturedBoqParams = {
          fSid: fSid || lastCapturedBoqParams.fSid || '8866498657022135732',
          bl: bl || lastCapturedBoqParams.bl || 'boq_labs-ai-sandbox-frontend_20260909.10_p0',
          at: at || lastCapturedBoqParams.at || 'AIQ-s5iTNlpxKFqhFYgT3czlS-5z:1789119960414',
          projectId: projectId || lastCapturedBoqParams.projectId || '622115a8-5f52-407b-82be-8323e88b9a1a'
        };
        try {
          localStorage.setItem('__flow_boq_params__', JSON.stringify(lastCapturedBoqParams));
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Tự động hook grecaptcha.enterprise.execute để bắt token fresh từ chính Google Flow
  function tryHookRecaptcha() {
    try {
      if (window.grecaptcha?.enterprise?.execute && !window.grecaptcha.enterprise._flow_hooked) {
        const origExecute = window.grecaptcha.enterprise.execute;
        window.grecaptcha.enterprise.execute = async function (...args) {
          try {
            const tok = await origExecute.apply(this, args);
            if (tok && typeof tok === 'string' && tok.length > 20) {
              lastCapturedRecaptchaToken = tok;
              try { localStorage.setItem('__flow_recaptcha_token__', tok); } catch (_) {}
            }
            return tok;
          } catch (e) {
            return origExecute.apply(this, args);
          }
        };
        window.grecaptcha.enterprise._flow_hooked = true;
      }
    } catch (_) {}
  }
  tryHookRecaptcha();
  setInterval(tryHookRecaptcha, 1000);

  function getBoqParams() {
    let wiz = window.WIZ_global_data || {};

    // Quét các thẻ <script> trên trang tìm SNlM0e (at token) và FdrFJe (fSid) nếu window.WIZ_global_data rỗng
    if (!wiz.SNlM0e || !wiz.FdrFJe) {
      try {
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
          const content = scripts[i].textContent || '';
          if (content.includes('SNlM0e') || content.includes('FdrFJe') || content.includes('WIZ_global_data')) {
            const snMatch = content.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
            const fdrMatch = content.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
            const cfbMatch = content.match(/"cfb2h"\s*:\s*"([^"]+)"/);
            if (snMatch || fdrMatch) {
              wiz = {
                ...wiz,
                SNlM0e: snMatch ? snMatch[1] : wiz.SNlM0e,
                FdrFJe: fdrMatch ? fdrMatch[1] : wiz.FdrFJe,
                cfb2h: cfbMatch ? cfbMatch[1] : wiz.cfb2h
              };
              break;
            }
          }
        }
      } catch (_) {}
    }

    const fSid = wiz.FdrFJe || lastCapturedBoqParams.fSid || '8866498657022135732';
    const bl = wiz.cfb2h || lastCapturedBoqParams.bl || 'boq_labs-ai-sandbox-frontend_20260909.10_p0';
    const at = wiz.SNlM0e || lastCapturedBoqParams.at || 'AIQ-s5iTNlpxKFqhFYgT3czlS-5z:1789119960414';
    const projMatch = window.location.pathname.match(/\/project\/([a-zA-Z0-9_\-]+)/i);
    const projectId = projMatch ? projMatch[1] : (lastCapturedBoqParams.projectId || '622115a8-5f52-407b-82be-8323e88b9a1a');
    return { fSid, bl, at, projectId };
  }

  // Trích xuất link ảnh từ response boq (ogiZ0b)
  function extractGeneratedImageFromBoq(rawText, promptText) {
    const images = [];
    if (!rawText) return images;

    try {
      const cleaned = rawText.replace(/^\)\]\}'\s*/, '');
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

    // Fallback regex nếu cấu trúc bên trong thay đổi
    if (images.length === 0) {
      const matches = rawText.match(/https:\\\/\\\/flow-content\.google\\\/image\\\/[^"'\\s\\]+|https:\/\/flow-content\.google\/image\/[^"'\\s\\]+/g);
      if (matches && matches.length > 0) {
        const cleanUrls = [...new Set(matches.map((m) => m.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/')))];
        cleanUrls.forEach((u) => {
          images.push({
            id: 'img_' + Math.random().toString(36).substr(2, 9),
            url: u,
            dataUrl: u,
            prompt: promptText,
            timestamp: Date.now()
          });
        });
      }
    }

    return images;
  }

  // -------------------------------------------------------------
  // Lấy reCAPTCHA Token chuẩn Google Flow
  // -------------------------------------------------------------
  window.__flowGetRecaptchaToken = async function (actionName = 'MEDIA_GENERATION') {
    try {
      if (window.grecaptcha?.enterprise) {
        const executePromise = (async () => {
          if (typeof window.grecaptcha.enterprise.ready === 'function') {
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 2000);
              window.grecaptcha.enterprise.ready(() => {
                clearTimeout(timer);
                resolve(true);
              });
            });
          }
          if (typeof window.grecaptcha.enterprise.execute === 'function') {
            return await window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action: actionName });
          }
          return '';
        })();

        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(''), 4000));
        const token = await Promise.race([executePromise, timeoutPromise]);
        if (token && typeof token === 'string' && token.length > 20) {
          lastCapturedRecaptchaToken = token;
          try { localStorage.setItem('__flow_recaptcha_token__', token); } catch (_) {}
          console.log(`✅ [FlowSniffer] Đã tạo Token reCAPTCHA (${actionName}):`, token.substring(0, 25) + '...');
          window.postMessage(
            {
              source: SENDER_ID,
              type: 'RECAPTCHA_TOKEN_CAPTURED',
              token: token,
            },
            '*'
          );
          return token;
        }
      }
    } catch (err) {
      console.warn('⚠️ [FlowSniffer] Lỗi lấy token:', err);
    }
    return lastCapturedRecaptchaToken || '';
  };

  // Helpers
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
      console.warn('[FlowSniffer] parseHeaders error:', e);
    }
    return result;
  }

  async function parseBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
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
    if (body instanceof URLSearchParams) {
      const obj = {};
      body.forEach((val, key) => {
        obj[key] = val;
      });
      return { _type: 'URLSearchParams', data: obj };
    }
    try {
      return JSON.parse(JSON.stringify(body));
    } catch {
      return String(body);
    }
  }

  function notifyCaptured(reqData) {
    if (reqData.headers && reqData.headers['authorization']) {
      lastCapturedAuthHeader = reqData.headers['authorization'];
    }

    if (reqData.body?.clientContext?.recaptchaContext?.token) {
      lastCapturedRecaptchaToken = reqData.body.clientContext.recaptchaContext.token;
      window.postMessage(
        {
          source: SENDER_ID,
          type: 'RECAPTCHA_TOKEN_CAPTURED',
          token: lastCapturedRecaptchaToken,
        },
        '*'
      );
    }

    const urlLower = (reqData.url || '').toLowerCase();
    const isPostOrPut = reqData.method === 'POST' || reqData.method === 'PUT';

    // Tự động bắt thông số boq (f.sid, bl, at, projectId) từ batchexecute
    if (reqData.url && reqData.url.includes('/AiSandboxAngularFrontend/data/batchexecute')) {
      try {
        const u = new URL(reqData.url, window.location.origin);
        const fSid = u.searchParams.get('f.sid');
        const bl = u.searchParams.get('bl');
        const sp = u.searchParams.get('source-path');
        const projMatch = (sp || '').match(/\/project\/([a-zA-Z0-9_\-]+)/i);
        const projectId = projMatch ? projMatch[1] : '';

        let at = '';
        if (reqData.body && typeof reqData.body === 'string') {
          const qs = new URLSearchParams(reqData.body);
          at = qs.get('at') || '';

          // Trích xuất reCAPTCHA token từ ogiZ0b nếu có
          const fReq = qs.get('f.req');
          if (fReq && fReq.includes('ogiZ0b')) {
            try {
              const parsed = JSON.parse(fReq);
              const inner = JSON.parse(parsed[0][0][1]);
              const tokenFromPayload = inner?.[1]?.[0]?.[7]?.[10]?.[0] || inner?.[3]?.[10]?.[0];
              if (tokenFromPayload && typeof tokenFromPayload === 'string' && tokenFromPayload.length > 20) {
                lastCapturedRecaptchaToken = tokenFromPayload;
                try {
                  localStorage.setItem('__flow_recaptcha_token__', tokenFromPayload);
                } catch (_) {}
              }
            } catch (_) {}
          }
        }

        if (fSid || at || projectId) {
          lastCapturedBoqParams = {
            fSid: fSid || lastCapturedBoqParams.fSid || '',
            bl: bl || lastCapturedBoqParams.bl || 'boq_labs-ai-sandbox-frontend_20260909.10_p0',
            at: at || lastCapturedBoqParams.at || '',
            projectId: projectId || lastCapturedBoqParams.projectId || ''
          };
          try {
            localStorage.setItem('__flow_boq_params__', JSON.stringify(lastCapturedBoqParams));
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Log chi tiết vào DevTools Console cho mọi request Sandbox / Labs / Flow
    if (isPostOrPut && (urlLower.includes('aisandbox-pa') || urlLower.includes('labs.google/fx') || urlLower.includes('batchexecute'))) {
      console.log(
        '%c📡 [FLOW SNIFFER] ' + reqData.method + ' ' + reqData.url,
        'background: #0284c7; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
        {
          url: reqData.url,
          method: reqData.method,
          headers: reqData.headers,
          body: reqData.body,
          response: reqData.response
        }
      );
      window.__lastFlowApiRequest = reqData;
    }

    // Tự động bắt và lưu template API Tạo Ảnh
    const bodyStr = typeof reqData.body === 'object' ? JSON.stringify(reqData.body).toLowerCase() : String(reqData.body || '').toLowerCase();
    const isImageCandidate =
      isPostOrPut &&
      !urlLower.includes('batchcheckasyncvideogenerationstatus') &&
      !urlLower.includes('batchasyncgeneratevideotext') &&
      !urlLower.includes('batchlogfrontendevents') &&
      !urlLower.includes('general.submitbatchlog') &&
      (
        urlLower.includes('image') ||
        urlLower.includes('flowmedia') ||
        urlLower.includes('batchgenerate') ||
        urlLower.includes('text2image') ||
        bodyStr.includes('image') ||
        bodyStr.includes('prompt') ||
        bodyStr.includes('structuredprompt') ||
        bodyStr.includes('nano_banana') ||
        bodyStr.includes('flash-lite-image') ||
        bodyStr.includes('imagemodelname')
      );

    if (isImageCandidate && reqData.body) {
      lastCapturedImageApiTemplate = {
        url: reqData.url,
        method: reqData.method,
        headers: reqData.headers,
        bodySample: reqData.body,
        responseSample: reqData.response,
        timestamp: Date.now()
      };
      try {
        localStorage.setItem('__flow_image_api_template__', JSON.stringify(lastCapturedImageApiTemplate));
      } catch (_) {}
      console.log(
        '%c🎯 [FLOW CAPTURE] ĐÃ BẮT ĐƯỢC MẪU REQUEST TẠO ẢNH:',
        'background: #16a34a; color: white; padding: 4px 8px; font-weight: bold; border-radius: 4px;',
        lastCapturedImageApiTemplate
      );
    }

    window.postMessage(
      {
        source: SENDER_ID,
        type: 'API_CAPTURED',
        payload: reqData,
      },
      '*'
    );
  }

  // -------------------------------------------------------------
  // 1. Hook window.fetch
  // -------------------------------------------------------------
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
      console.warn('[FlowSniffer] Error parsing fetch request input:', err);
    }

    extractBoqParamsFromUrlAndBody(url, reqBody);

    const parsedReqBody = await parseBody(reqBody);

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
        if (contentType.includes('application/json')) {
          resBody = await cloneRes.json();
        } else if (
          contentType.includes('text/') ||
          contentType.includes('application/javascript') ||
          contentType.includes('application/xml') ||
          contentType.includes('application/x-www-form-urlencoded')
        ) {
          const text = await cloneRes.text();
          try {
            resBody = JSON.parse(text);
          } catch {
            resBody = text.length > 50000 ? text.substring(0, 50000) + '... [Truncated]' : text;
          }
        } else {
          resBody = `[Binary / Stream / ${contentType || 'Unknown'}]`;
        }
      } catch (err) {
        try {
          resBody = await cloneRes.text();
        } catch (_) {
          resBody = '[Unable to parse response body]';
        }
      }

      notifyCaptured({
        id,
        type: 'fetch',
        url,
        method,
        headers: reqHeaders,
        body: parsedReqBody,
        status: response.status,
        statusText: response.statusText,
        resHeaders,
        response: resBody,
        timestamp: startTime,
        duration,
      });

      return response;
    } catch (error) {
      const endTime = Date.now();
      notifyCaptured({
        id,
        type: 'fetch',
        url,
        method,
        headers: reqHeaders,
        body: parsedReqBody,
        status: 0,
        statusText: 'Failed / Network Error',
        resHeaders: {},
        response: { error: error.message || String(error) },
        timestamp: startTime,
        duration: endTime - startTime,
      });
      throw error;
    }
  };

  // -------------------------------------------------------------
  // 2. Hook XMLHttpRequest
  // -------------------------------------------------------------
  const XHR = window.XMLHttpRequest;
  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalSetRequestHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function (method, url, ...rest) {
    this._sniffer_data = {
      id: 'xhr_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
      method: (method || 'GET').toUpperCase(),
      url: new URL(url, window.location.href).href,
      headers: {},
      startTime: 0,
    };
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XHR.prototype.setRequestHeader = function (header, value) {
    if (this._sniffer_data) {
      this._sniffer_data.headers[header.toLowerCase()] = value;
    }
    return originalSetRequestHeader.apply(this, [header, value]);
  };

  XHR.prototype.send = function (body) {
    if (!this._sniffer_data) {
      return originalSend.apply(this, [body]);
    }

    const data = this._sniffer_data;
    data.startTime = Date.now();
    data.rawBody = body;

    extractBoqParamsFromUrlAndBody(data.url, body);

    this.addEventListener('loadend', async function () {
      const endTime = Date.now();
      const duration = endTime - data.startTime;

      let resBody = null;
      let resHeaders = {};

      try {
        const rawHeaders = this.getAllResponseHeaders() || '';
        rawHeaders.split('\r\n').forEach((line) => {
          const parts = line.split(': ');
          if (parts.length >= 2) {
            resHeaders[parts[0].toLowerCase()] = parts.slice(1).join(': ');
          }
        });
      } catch (_) {}

      try {
        if (this.responseType === '' || this.responseType === 'text') {
          try {
            resBody = JSON.parse(this.responseText);
          } catch {
            resBody = this.responseText;
          }
        } else if (this.responseType === 'json') {
          resBody = this.response;
        } else {
          resBody = `[Response Type: ${this.responseType}]`;
        }
      } catch (_) {
        resBody = this.response;
      }

      const parsedBody = await parseBody(data.rawBody);

      notifyCaptured({
        id: data.id,
        type: 'xhr',
        url: data.url,
        method: data.method,
        headers: data.headers,
        body: parsedBody,
        status: this.status,
        statusText: this.statusText,
        resHeaders,
        response: resBody,
        timestamp: data.startTime,
        duration,
      });
    });

    return originalSend.apply(this, [body]);
  };

  // -------------------------------------------------------------
  // 3. In-Tab Executor Handler (Tạo Video, Kiểm tra tiến độ, Tải MP4)
  // -------------------------------------------------------------
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.target !== 'INJECTED_TAB_EXECUTOR') {
      return;
    }

    const { requestId, action, payload, token, recaptchaToken } = event.data;

    try {
      if (action === 'TRIGGER_RECAPTCHA') {
        const tok = await window.__flowGetRecaptchaToken('VIDEO_GENERATION');
        window.postMessage(
          {
            target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
            requestId,
            success: true,
            data: { token: tok },
          },
          '*'
        );
        return;
      }

      // ---------------------------------------------------------
      // Action: GENERATE_IMAGE (Direct Background API - 0 Credits)
      // ---------------------------------------------------------
      // ---------------------------------------------------------
      // Action: GENERATE_IMAGE (Direct Background BOQ API - 0 Credits)
      // ---------------------------------------------------------
      if (action === 'GENERATE_IMAGE') {
        const promptText = (payload?.prompt || '').trim();
        const aspectRatio = payload?.aspectRatio || '16:9';
        const variationsCount = Math.max(1, Math.min(payload?.count || 1, 4));

        if (!promptText) {
          window.postMessage({
            target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
            requestId,
            success: false,
            error: 'Prompt không được để trống!'
          }, '*');
          return;
        }

        console.log('🚀 [Flow Direct API] Bắt đầu gọi API sinh ảnh ngầm (BOQ ogiZ0b):', promptText);

        // 1. Trích xuất Session parameters
        const { fSid, bl, at, projectId } = getBoqParams();
        const targetProjectId = payload?.projectId || projectId;

        if (!targetProjectId) {
          throw new Error('Không xác định được Project ID trên Google Flow. Vui lòng mở 1 Project!');
        }

        // 2. Lấy reCAPTCHA Token mới (Action MEDIA_GENERATION)
        const freshRecaptchaToken =
          (await window.__flowGetRecaptchaToken('MEDIA_GENERATION')) ||
          payload.recaptchaToken ||
          lastCapturedRecaptchaToken ||
          '';

        // 3. Ánh xạ Aspect Ratio sang Enum Flow: 16:9 -> 3, 1:1 -> 1, 9:16 -> 2, 4:3 -> 4, 3:4 -> 5
        let aspectNum = 3;
        if (aspectRatio === '1:1') aspectNum = 1;
        else if (aspectRatio === '9:16') aspectNum = 2;
        else if (aspectRatio === '16:9') aspectNum = 3;
        else if (aspectRatio === '4:3') aspectNum = 4;
        else if (aspectRatio === '3:4') aspectNum = 5;

        // 4. Gửi request(s) tương ứng với số lượng biến thể (variationsCount)
        const generatedImages = [];

        for (let v = 0; v < variationsCount; v++) {
          const currentSeed = Math.floor(Math.random() * 2147483647);
          const reqId = Math.floor(Math.random() * 899999) + 100000;
          const uuid1 = crypto.randomUUID().toUpperCase();
          const uuid2 = crypto.randomUUID().toUpperCase();
          const uuid3 = crypto.randomUUID().toUpperCase();

          const innerPayload = [
            null,
            [
              [
                null,
                null,
                null,
                currentSeed,
                aspectNum,
                "HARBOR_SEAL", // Nano Banana 2 Lite - 0 credits!
                null,
                [
                  null,
                  22,
                  null,
                  null,
                  null,
                  targetProjectId,
                  null,
                  null,
                  null,
                  null,
                  [
                    freshRecaptchaToken,
                    1
                  ]
                ],
                [
                  [
                    [
                      promptText
                    ]
                  ]
                ],
                null,
                null,
                null,
                uuid1,
                uuid2
              ]
            ],
            1,
            [
              null,
              22,
              null,
              null,
              null,
              targetProjectId,
              null,
              null,
              null,
              null,
              [
                freshRecaptchaToken,
                1
              ]
            ],
            [
              uuid3
            ]
          ];

          const fReqValue = JSON.stringify([
            [
              [
                "ogiZ0b",
                JSON.stringify(innerPayload),
                null,
                "generic"
              ]
            ]
          ]);

          const url = `https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b&source-path=${encodeURIComponent('/project/' + targetProjectId)}&bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(fSid)}&hl=en&_reqid=${reqId}&rt=c`;

          const rawPostData = 'f.req=' + encodeURIComponent(fReqValue) + (at ? '&at=' + encodeURIComponent(at) : '') + '&';

          console.log(`📡 [Flow Direct API] Đang gửi batchexecute ogiZ0b (biến thể #${v + 1}/${variationsCount})...`);

          const sendStartTime = Date.now();
          const rawText = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.withCredentials = true;
            xhr.setRequestHeader('x-same-domain', '1');
            xhr.setRequestHeader('content-type', 'application/x-www-form-urlencoded;charset=utf-8');
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.responseText);
              } else {
                reject(new Error(`Google Flow HTTP ${xhr.status}: ${xhr.responseText.substring(0, 300)}`));
              }
            };
            xhr.onerror = () => reject(new Error('Lỗi kết nối mạng khi gửi batchexecute tới Google Flow'));
            xhr.send(rawPostData);
          });

          // Ghi lại vào Sniffer để hiển thị trên bảng điều khiển & xuất log JSON
          try {
            notifyCaptured({
              id: 'xhr_batch_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
              type: 'xhr',
              url,
              method: 'POST',
              headers: { 'x-same-domain': '1', 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
              body: bodyParams.toString() + '&',
              status: 200,
              statusText: 'OK',
              resHeaders: {},
              response: rawText,
              timestamp: sendStartTime,
              duration: Date.now() - sendStartTime,
            });
          } catch (_) {}

          // Kiểm tra xem batchexecute có trả về mã lỗi RPC hay không
          if (rawText.includes('"wrb.fr","ogiZ0b",null') || rawText.includes('"er",')) {
            const errMatch = rawText.match(/\["wrb\.fr","ogiZ0b",null,null,null,\[(\d+)\]/);
            if (errMatch) {
              const rpcCode = errMatch[1];
              const desc = rpcCode === '3' ? 'INVALID_ARGUMENT (tham số không hợp lệ)' :
                           rpcCode === '7' ? 'PERMISSION_DENIED (phiên hết hạn hoặc chưa đăng nhập)' :
                           rpcCode === '8' ? 'RESOURCE_EXHAUSTED (quá tải rate limit)' :
                           rpcCode === '16' ? 'UNAUTHENTICATED (cần F5 làm mới phiên)' : `Mã RPC ${rpcCode}`;
              throw new Error(`Google Flow từ chối: ${desc}`);
            }
          }

          const extracted = extractGeneratedImageFromBoq(rawText, promptText);
          if (extracted && extracted.length > 0) {
            generatedImages.push(...extracted);
          } else {
            console.warn(`⚠️ [Flow Direct API] Chưa trích xuất được link ảnh từ response #${v + 1}:`, rawText.substring(0, 400));
          }
        }

        if (generatedImages.length === 0) {
          throw new Error('Google Flow không trả về link ảnh hợp lệ. Vui lòng kiểm tra phiên đăng nhập.');
        }

        console.log('✅ [Flow Direct API] Thành công! Nhận được', generatedImages.length, 'ảnh:', generatedImages);

        window.postMessage({
          target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
          requestId,
          success: true,
          data: {
            images: generatedImages
          }
        }, '*');
        return;
      }

      // ---------------------------------------------------------
      // Action: FLOW_DOM_SUBMIT_IMAGE (UI Automation on Google Flow)
      // ---------------------------------------------------------
      if (action === 'FLOW_DOM_SUBMIT_IMAGE') {
        const promptToRun = (payload?.prompt || '').trim();
        const aspectRatio = payload?.aspectRatio; // '16:9', '4:3', '1:1', '3:4', '9:16'
        const count = payload?.count; // 1, 2, 3, 4
        if (!promptToRun) {
          window.postMessage({
            target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
            requestId,
            success: false,
            error: 'Prompt không được để trống!'
          }, '*');
          return;
        }

        console.log('🤖 [Flow UI] Điền prompt vào Google Flow:', promptToRun);

        // 1. Tìm ô nhập prompt trên Google Flow
        const inputSelectors = [
          'textarea[placeholder*="What do you want to create" i]',
          'input[placeholder*="What do you want to create" i]',
          'textarea[placeholder*="create" i]',
          'div[contenteditable="true"][placeholder*="create" i]',
          'div[contenteditable="true"][data-placeholder*="create" i]',
          'div[contenteditable="true"]',
          'textarea',
          'input[type="text"]'
        ];

        let targetInput = null;
        for (const sel of inputSelectors) {
          const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
            if (el.closest && el.closest('#flow-sniffer-root')) return false;
            return el.offsetParent !== null;
          });
          if (els.length > 0) {
            targetInput = els[els.length - 1];
            break;
          }
        }

        if (!targetInput) {
          window.postMessage({
            target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
            requestId,
            success: false,
            error: 'Không tìm thấy ô nhập Prompt "What do you want to create?" trên Google Flow!'
          }, '*');
          return;
        }

        // 2. Cài đặt Tỉ lệ khung hình (Aspect Ratio) và Số lượng (Quantity) nếu popover hoặc nút có sẵn
        if (aspectRatio || count) {
          try {
            // Kiểm tra xem popover setting đã mở chưa
            let hasAspectBtns = Array.from(document.querySelectorAll('button, [role="button"]')).some(b => {
              if (b.closest && b.closest('#flow-sniffer-root')) return false;
              const t = (b.innerText || '').trim();
              return ['16:9', '4:3', '1:1', '3:4', '9:16'].includes(t);
            });

            if (!hasAspectBtns) {
              // Tìm nút pill model cạnh targetInput (chứa "Nano Banana", "Lite", "x1", "x2", ...)
              const container = targetInput.closest('form, div:has(button)') || document;
              const allBtns = Array.from(container.querySelectorAll('button, [role="button"]')).filter(b => !b.closest('#flow-sniffer-root'));
              const modelPill = allBtns.find(b => {
                const txt = (b.innerText || '').toLowerCase();
                return txt.includes('nano banana') || txt.includes('lite') || txt.includes('x1') || txt.includes('x2') || txt.includes('x3') || txt.includes('x4');
              });

              if (modelPill) {
                modelPill.click();
                await new Promise(r => setTimeout(r, 250));
              }
            }

            // Đảm bảo chọn tab Image (thay vì Video) nếu popover có nút Image
            const imgModeBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
              if (b.closest && b.closest('#flow-sniffer-root')) return false;
              const t = (b.innerText || '').trim().toLowerCase();
              return t === 'image' || t.includes('image');
            });
            if (imgModeBtn && !imgModeBtn.classList.contains('active') && imgModeBtn.getAttribute('aria-selected') !== 'true') {
              imgModeBtn.click();
              await new Promise(r => setTimeout(r, 150));
            }

            // Chọn Aspect Ratio nếu có
            if (aspectRatio) {
              const aspectBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
                if (b.closest && b.closest('#flow-sniffer-root')) return false;
                return (b.innerText || '').trim() === aspectRatio;
              });
              if (aspectBtn) {
                aspectBtn.click();
                await new Promise(r => setTimeout(r, 150));
              }
            }

            // Chọn Số lượng biến thể (x1, x2, x3, x4)
            if (count) {
              const countTarget = `x${count}`;
              const countBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
                if (b.closest && b.closest('#flow-sniffer-root')) return false;
                return (b.innerText || '').trim().toLowerCase() === countTarget.toLowerCase();
              });
              if (countBtn) {
                countBtn.click();
                await new Promise(r => setTimeout(r, 150));
              }
            }
          } catch (optErr) {
            console.warn('[Flow UI] Lỗi cấu hình Aspect Ratio/Count:', optErr);
          }
        }

        // 3. Điền prompt
        targetInput.focus();
        if (targetInput.isContentEditable) {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, promptToRun);
          targetInput.innerText = promptToRun;
        } else {
          try {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, promptToRun);
          } catch (_) {}

          if (targetInput.value !== promptToRun) {
            const setter =
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ||
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(targetInput, promptToRun);
            else targetInput.value = promptToRun;
          }
        }

        targetInput.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptToRun }));
        targetInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptToRun }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

        await new Promise(r => setTimeout(r, 200));

        // 4. Tìm NÚT SUBMIT (nút mũi tên -> cạnh ô input)
        let submitBtn = null;
        let parent = targetInput.parentElement;
        while (parent && parent !== document.body) {
          const btns = Array.from(parent.querySelectorAll('button, [role="button"]')).filter(b => {
            if (b.closest && b.closest('#flow-sniffer-root')) return false;
            if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
            return true;
          });
          for (let b of btns) {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const txt = (b.innerText || '').toLowerCase();
            const html = b.innerHTML.toLowerCase();
            if (
              aria.includes('create') || aria.includes('generate') || aria.includes('submit') || aria.includes('send') ||
              txt.includes('create') || txt.includes('generate') ||
              html.includes('arrow') || html.includes('svg')
            ) {
              submitBtn = b;
              break;
            }
          }
          if (submitBtn) break;
          parent = parent.parentElement;
        }

        if (!submitBtn) {
          const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
            if (b.closest && b.closest('#flow-sniffer-root')) return false;
            return b.offsetParent !== null && !b.disabled;
          });
          submitBtn = allBtns.find(b => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return aria.includes('create') || aria.includes('generate') || aria.includes('send');
          }) || allBtns[allBtns.length - 1];
        }

        if (submitBtn) {
          submitBtn.focus();
          submitBtn.click();
          console.log('✅ [Flow UI] Đã click nút Submit tạo ảnh:', submitBtn);
        } else {
          const enterEvt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          targetInput.dispatchEvent(new KeyboardEvent('keydown', enterEvt));
          targetInput.dispatchEvent(new KeyboardEvent('keypress', enterEvt));
          targetInput.dispatchEvent(new KeyboardEvent('keyup', enterEvt));
          console.log('✅ [Flow UI] Đã gửi Enter để Submit');
        }

        window.postMessage({
          target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
          requestId,
          success: true,
          data: { submitted: true, prompt: promptToRun }
        }, '*');
        return;
      }

      // ---------------------------------------------------------
      // Action: GENERATE_VIDEO (Hỗ trợ Text-to-Video, Frames, Ingredients, Variations)
      // ---------------------------------------------------------
      if (action === 'GENERATE_VIDEO') {
        const finalRecaptchaToken =
          (await window.__flowGetRecaptchaToken('VIDEO_GENERATION')) ||
          payload.recaptchaToken ||
          recaptchaToken ||
          lastCapturedRecaptchaToken ||
          '';

        const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
        const batchId = payload.batchId || crypto.randomUUID();
        const projectId = payload.projectId || 'b7a26d33-1e21-43eb-b217-2078a909f2d4';
        const promptText = payload.prompt || 'Cinematic visual scene';
        const modelKey = payload.modelKey || 'abra_t2v_8s';
        const aspectRatio = payload.aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
        const variationsCount = Math.max(1, Math.min(payload.variationsCount || 1, 4));
        const durationLength = payload.duration || '8s';

        // Tạo danh sách requests theo số lượng variation (x1, x2, x3, x4)
        const requests = [];
        for (let v = 0; v < variationsCount; v++) {
          const currentSeed =
            typeof payload.seed === 'number'
              ? v === 0
                ? payload.seed
                : payload.seed + v * 1337
              : Math.floor(Math.random() * 999999);

          const reqItem = {
            aspectRatio,
            textInput: {
              structuredPrompt: {
                parts: [{ text: promptText }],
              },
            },
            videoModelKey: modelKey,
            seed: currentSeed,
            metadata: {},
          };

          // Hỗ trợ Start Frame & End Frame nếu có
          if (payload.startImageMediaId) {
            reqItem.imageMediaId = payload.startImageMediaId;
          }
          if (payload.endImageMediaId) {
            reqItem.endImageMediaId = payload.endImageMediaId;
          }

          requests.push(reqItem);
        }

        const requestBody = {
          mediaGenerationContext: {
            batchId,
            audioFailurePreference: 'BLOCK_SILENCED_VIDEOS',
          },
          clientContext: {
            projectId,
            tool: 'PINHOLE',
            userPaygateTier: 'PAYGATE_TIER_ONE',
            sessionId: `;${Date.now()}`,
            recaptchaContext: {
              token: finalRecaptchaToken,
              applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
            },
          },
          requests,
          useV2ModelConfig: true,
        };

        const res = await originalFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(requestBody),
        });

        const rawText = await res.text();
        let resJson = null;
        try {
          resJson = JSON.parse(rawText);
        } catch {
          resJson = rawText;
        }

        if (!res.ok) {
          const errorMsg =
            typeof resJson === 'object'
              ? resJson.error?.message || JSON.stringify(resJson)
              : `HTTP ${res.status}: ${rawText.substring(0, 300)}`;

          window.postMessage(
            {
              target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
              requestId,
              success: false,
              error: errorMsg,
              status: res.status,
              rawResponse: rawText.substring(0, 1000),
              url,
            },
            '*'
          );
          return;
        }

        window.postMessage(
          {
            target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
            requestId,
            success: true,
            data: { ...resJson, batchId, projectId, seed: requests[0].seed },
          },
          '*'
        );
        return;
      }

      // ---------------------------------------------------------
      // Action: CHECK_STATUS (Kiểm tra tiến độ render qua Tab)
      // ---------------------------------------------------------
      if (action === 'CHECK_STATUS') {
        const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
        const mediaList = payload.media || [];

        const res = await originalFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ media: mediaList }),
        });

        const rawText = await res.text();
        let resJson = null;
        try {
          resJson = JSON.parse(rawText);
        } catch {
          resJson = rawText;
        }

        if (!res.ok) {
          const errorMsg =
            typeof resJson === 'object'
              ? resJson.error?.message || JSON.stringify(resJson)
              : `HTTP ${res.status}: ${rawText.substring(0, 300)}`;

          window.postMessage(
            {
              target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
              requestId,
              success: false,
              error: errorMsg,
              status: res.status,
              rawResponse: rawText.substring(0, 1000),
              url,
            },
            '*'
          );
          return;
        }

        window.postMessage(
          {
            target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
            requestId,
            success: true,
            data: resJson,
          },
          '*'
        );
        return;
      }

      // ---------------------------------------------------------
      // Action: DOWNLOAD_MEDIA (Tải Video MP4 trực tiếp về máy tính)
      // ---------------------------------------------------------
      if (action === 'DOWNLOAD_MEDIA') {
        const mediaName = payload.mediaName;
        const filename = payload.filename || `Flow_Video_${Date.now()}.mp4`;
        const downloadUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;

        console.log(`⬇️ [FlowSniffer] Đang tải MP4: ${mediaName}...`);

        const res = await originalFetch(downloadUrl, {
          method: 'GET',
          // Endpoint này dùng Cookie của trang labs.google thay vì Bearer token
        });

        if (!res.ok) {
          let errorText = '';
          try {
            errorText = await res.text();
          } catch (e) {}
          throw new Error(`Lỗi tải video từ Google HTTP ${res.status}. Chi tiết: ${errorText}`);
        }

        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(blobUrl);
        }, 5000);

        window.postMessage(
          {
            target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
            requestId,
            success: true,
            data: { downloaded: true, filename, sizeBytes: blob.size },
          },
          '*'
        );
        return;
      }

      // ---------------------------------------------------------
      // Action: GET_VIDEO_DATA (Tải video trả về Base64 cho UI hiển thị)
      // ---------------------------------------------------------
      if (action === 'GET_VIDEO_DATA') {
        const mediaName = payload.mediaName;
        const downloadUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
        
        const res = await originalFetch(downloadUrl, { method: 'GET' });
        if (!res.ok) {
          throw new Error(`Lỗi get data video HTTP ${res.status}`);
        }
        
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          window.postMessage(
            {
              target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
              requestId,
              success: true,
              data: { base64Url: reader.result }
            },
            '*'
          );
        };
        reader.readAsDataURL(blob);
        return;
      }
    } catch (err) {
      console.error('[FlowSniffer] In-Tab Executor Fetch Error:', err);
      window.postMessage(
        {
          target: 'CONTENT_TAB_EXECUTOR_RESPONSE',
          requestId,
          success: false,
          error: err.message || String(err),
          status: 0,
        },
        '*'
      );
    }
  });

  console.log('🚀 [Google Flow API Sniffer] Injected & Ready with Full Features & Download API!');
})();
