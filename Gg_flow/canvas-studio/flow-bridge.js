/**
 * FlowBridge Client SDK (V1.2 with Live Diagnostics)
 * Cung cấp API JavaScript sạch sẽ cho Web App Canvas Studio và ghi log trực tiếp
 */

class FlowBridge {
  constructor() {
    this.source = 'FLOW_CANVAS_APP';
    this.targetSource = 'FLOW_EXTENSION_BRIDGE';
    this.callbacks = new Map();
    this.isReady = false;
    this.onStatusChange = null;
    this.logListeners = [];

    this.init();
  }

  onLog(listener) {
    this.logListeners.push(listener);
  }

  emitLog(level, message, detail = null) {
    const logItem = {
      timestamp: new Date().toLocaleTimeString(),
      level, // 'info' | 'success' | 'warn' | 'error'
      message,
      detail,
    };
    console.log(`[FlowBridge ${level.toUpperCase()}]`, message, detail || '');
    this.logListeners.forEach((fn) => fn(logItem));
  }

  init() {
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || event.data.source !== this.targetSource) {
        return;
      }

      if (event.data.type === 'BRIDGE_READY') {
        this.isReady = true;
        this.emitLog('info', 'Extension Bridge đã sẵn sàng kết nối');
        if (this.onStatusChange) this.onStatusChange(true);
        return;
      }

      const { requestId, success, data, error, status, rawResponse, url } = event.data;
      if (requestId && this.callbacks.has(requestId)) {
        const { resolve, reject } = this.callbacks.get(requestId);
        this.callbacks.delete(requestId);

        if (success) {
          this.emitLog('success', 'Nhận kết quả thành công từ Extension', data);
          resolve(data);
        } else {
          const detailedErr = new Error(error || 'Lỗi không xác định từ Extension');
          detailedErr.status = status;
          detailedErr.rawResponse = rawResponse;
          detailedErr.url = url;

          this.emitLog('error', `Lỗi API (${status || 'Network'}): ${error}`, {
            url,
            status,
            rawResponse,
          });

          reject(detailedErr);
        }
      }
    });

    if (window.__FLOW_EXTENSION_BRIDGE_READY__) {
      this.isReady = true;
    }
  }

  async send(action, payload = {}) {
    this.emitLog('info', `Gửi lệnh [${action}] đến Extension Bridge...`, payload);

    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();

      const timer = setTimeout(() => {
        if (this.callbacks.has(requestId)) {
          this.callbacks.delete(requestId);
          const err = new Error(`Request Timeout: Không nhận được phản hồi cho action [${action}] sau 45s.`);
          this.emitLog('error', err.message);
          reject(err);
        }
      }, 45000);

      this.callbacks.set(requestId, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      window.postMessage(
        {
          source: this.source,
          requestId,
          action,
          payload,
        },
        '*'
      );
    });
  }

  async getSession() {
    return await this.send('GET_SESSION');
  }

  async setToken(token, projectId = null) {
    return await this.send('SET_TOKEN', { token, projectId });
  }

  async createProject(projectTitle) {
    return await this.send('CREATE_PROJECT', { projectTitle });
  }

  async generateVideo({
    prompt,
    modelKey,
    aspectRatio,
    duration,
    variationsCount,
    seed,
    projectId,
    startImageMediaId,
    endImageMediaId,
    recaptchaToken,
  }) {
    return await this.send('GENERATE_VIDEO', {
      prompt,
      modelKey: modelKey || 'abra_t2v_8s',
      aspectRatio: aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      duration: duration || '8s',
      variationsCount: variationsCount || 1,
      seed,
      projectId,
      startImageMediaId,
      endImageMediaId,
      recaptchaToken,
    });
  }

  async downloadVideo(mediaName, filename) {
    this.emitLog('info', `Bắt đầu tải file MP4 từ Google Flow: ${filename || mediaName}...`);
    return await this.send('DOWNLOAD_MEDIA', { mediaName, filename });
  }

  async checkStatus(mediaList) {
    return await this.send('CHECK_STATUS', { media: mediaList });
  }

  async waitForVideoCompletion(mediaId, projectId, onProgress = null, maxAttempts = 40) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      this.emitLog('info', `Kiểm tra tiến độ Video (Lần ${attempts}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, 3500));

      try {
        const res = await this.checkStatus([{ name: mediaId, projectId }]);
        const media = res?.media?.[0];

        if (media) {
          const status = media.mediaMetadata?.mediaStatus?.mediaGenerationStatus;
          if (onProgress) onProgress({ status, attempts, media });

          if (status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL') {
            this.emitLog('success', '🎉 Video đã render thành công!', media);
            return {
              success: true,
              media,
              videoInfo: media.video,
              blobSize: media.mediaMetadata?.mediaBlobSize,
            };
          }

          if (status === 'MEDIA_GENERATION_STATUS_FAILED') {
            const failErr = new Error('Google Veo báo lỗi trong quá trình tạo video (Generation Failed)');
            this.emitLog('error', failErr.message, media);
            throw failErr;
          }
        }
      } catch (err) {
        if (attempts >= maxAttempts) throw err;
      }
    }
    throw new Error('Thời gian chờ tạo video quá lâu (Timeout)');
  }
}

window.flowBridge = new FlowBridge();
