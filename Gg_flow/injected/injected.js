/**
 * Injected Script - Google Labs Flow API Hook & In-Tab Executor (V2.2 Full Features & Download API)
 */
(function () {
  const SENDER_ID = 'FLOW_API_SNIFFER';
  const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
  let lastCapturedRecaptchaToken = '';

  // -------------------------------------------------------------
  // Lấy reCAPTCHA Token chuẩn Google Flow
  // -------------------------------------------------------------
  window.__flowGetRecaptchaToken = async function (actionName = 'VIDEO_GENERATION') {
    try {
      if (window.grecaptcha?.enterprise) {
        await new Promise((resolve) => window.grecaptcha.enterprise.ready(() => resolve(true)));
        const token = await window.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, {
          action: actionName,
        });
        if (token && typeof token === 'string' && token.length > 20) {
          lastCapturedRecaptchaToken = token;
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
        const downloadUrl = `https://aisandbox-pa.googleapis.com/v1/media/${mediaName}:download?alt=media`;

        console.log(`⬇️ [FlowSniffer] Đang tải MP4: ${mediaName}...`);

        const res = await originalFetch(downloadUrl, {
          method: 'GET',
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!res.ok) {
          throw new Error(`Lỗi tải video từ Google HTTP ${res.status}`);
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
