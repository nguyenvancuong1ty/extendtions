"""
Google Flow - AI Watermark Cleaner Microservice (Powered by Simple-LaMa)
------------------------------------------------------------------------
Tự động xóa logo/watermark ngôi sao Gemini trên ảnh tạo từ Google Flow.
Cung cấp:
1. HTTP API Server (Port 5055) để Extension Gg_flow gọi trực tiếp khi sinh ảnh.
2. Watcher Mode: Tự động quét thư mục Downloads để xóa watermark khi có ảnh mới tải về.
3. Batch Mode: Xóa watermark hàng loạt ảnh trong một thư mục bất kỳ.
"""

import os
import sys
import time
import json
import base64
import io
import argparse
import uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from threading import Thread
from PIL import Image, ImageDraw

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Khởi tạo model LaMa toàn cục
print("=" * 60)
print("🚀 Đang khởi động Google Flow Watermark Cleaner (Simple-LaMa)...")
print("=" * 60)

try:
    from simple_lama_inpainting import SimpleLama
    lama_model = SimpleLama()
    print("✅ Model LaMa AI đã sẵn sàng hoạt động!")
except Exception as e:
    print(f"❌ Lỗi khi tải SimpleLama: {e}")
    print("Đang chuyển sang chế độ dự phòng OpenCV Inpaint...")
    lama_model = None

# Thư mục lưu ảnh đã làm sạch mặc định
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLEANED_DIR = os.path.join(os.path.dirname(os.path.dirname(BASE_DIR)), "cleaned_images")
os.makedirs(CLEANED_DIR, exist_ok=True)

# Quản lý hàng đợi tác vụ API nội bộ
import queue
import threading

JOB_QUEUE = queue.Queue()
JOB_EVENTS = {}
JOB_RESULTS = {}
JOB_STATES = {}
JOB_REQUEST_INDEX = {}
JOB_LOCK = threading.Lock()
LAST_TAB_HEARTBEAT = 0

MAX_PROMPTS_PER_JOB = 10
MAX_VARIATIONS = 4
VALID_ASPECT_RATIOS = {"16:9", "1:1", "9:16", "4:3", "3:4"}
TAB_HEARTBEAT_TIMEOUT_SECONDS = 60


def job_snapshot(job_id):
    with JOB_LOCK:
        state = JOB_STATES.get(job_id)
        return dict(state) if state else None


def set_job_state(job_id, status, **values):
    with JOB_LOCK:
        state = JOB_STATES.setdefault(job_id, {"job_id": job_id, "created_at": time.time()})
        state.update(values)
        state["status"] = status
        state["updated_at"] = time.time()
        return dict(state)


def discard_expired_job(job_id):
    state = job_snapshot(job_id)
    return not state or state.get("status") in {"expired", "cancelled", "completed", "failed"}


def create_gemini_watermark_mask(image: Image.Image) -> Image.Image:
    """
    Tạo mask bao trọn chính xác logo ngôi sao 4 cánh của Gemini / Google Flow ở góc dưới bên phải.
    Vị trí thực tế của ngôi sao trên ảnh Google Flow:
    - 16:9 (1376x768): Tâm cách mép phải ~98px (~7.1%), mép dưới ~97px (~12.6%).
    - 1:1, 9:16, 4:3: Tâm cách mép phải ~7-9%, mép dưới ~8-13%.
    """
    w, h = image.size
    min_dim = min(w, h)

    # Tâm ngôi sao được tính chuẩn xác theo tỉ lệ ảnh
    center_offset_x = int(w * 0.072) if w >= h else int(w * 0.09)
    center_offset_y = int(h * 0.126) if w >= h else int(h * 0.085)

    cx = w - center_offset_x
    cy = h - center_offset_y

    # Bán kính che phủ bao trọn ngôi sao và vệt phát sáng mờ
    radius = max(48, int(min_dim * 0.06))

    x0 = max(0, cx - radius)
    y0 = max(0, cy - radius)
    x1 = min(w, cx + radius)
    y1 = min(h, cy + radius)

    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle([x0, y0, x1, y1], fill=255)
    return mask


def clean_image_watermark(image: Image.Image) -> Image.Image:
    """Xóa watermark trên ảnh PIL bằng LaMa hoặc OpenCV"""
    image_rgb = image.convert("RGB")
    mask = create_gemini_watermark_mask(image_rgb)

    if lama_model is not None:
        return lama_model(image_rgb, mask)
    else:
        # Fallback dùng OpenCV nếu chưa cài LaMa
        import cv2
        import numpy as np
        img_np = cv2.cvtColor(np.array(image_rgb), cv2.COLOR_RGB2BGR)
        mask_np = np.array(mask)
        clean_np = cv2.inpaint(img_np, mask_np, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        clean_rgb = cv2.cvtColor(clean_np, cv2.COLOR_BGR2RGB)
        return Image.fromarray(clean_rgb)


class WatermarkHTTPHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        allowed_origins = {
            "https://flow.google.com",
            "https://labs.google.com",
            "http://localhost:7860",
            "http://127.0.0.1:7860",
        }
        origin = self.headers.get("Origin", "")
        if origin in allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        global LAST_TAB_HEARTBEAT
        if self.path in ["/", "/health", "/status"]:
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            is_tab_connected = (time.time() - LAST_TAB_HEARTBEAT) < TAB_HEARTBEAT_TIMEOUT_SECONDS
            resp = {
                "status": "ok",
                "service": "Google Flow AI Watermark & Internal API",
                "engine": "Simple-LaMa" if lama_model else "OpenCV-Fallback",
                "cleanedDir": CLEANED_DIR,
                "tabConnected": is_tab_connected,
                "pendingJobs": JOB_QUEUE.qsize(),
                "activeJobs": sum(1 for state in JOB_STATES.values() if state.get("status") in {"queued", "claimed", "rendering"}),
                "timestamp": int(time.time())
            }
            self.wfile.write(json.dumps(resp, ensure_ascii=False).encode("utf-8"))

        elif self.path.startswith("/api/jobs/") and self.path != "/api/jobs/poll":
            job_id = self.path.rsplit("/", 1)[-1]
            state = job_snapshot(job_id)
            if not state:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Job not found"}).encode("utf-8"))
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(state, ensure_ascii=False).encode("utf-8"))

        elif self.path == "/api/jobs/poll":
            LAST_TAB_HEARTBEAT = time.time()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()

            job = None
            while not JOB_QUEUE.empty():
                try:
                    candidate = JOB_QUEUE.get_nowait()
                except queue.Empty:
                    break
                if discard_expired_job(candidate["id"]):
                    continue
                set_job_state(candidate["id"], "claimed")
                job = candidate
                break
            if job:
                self.wfile.write(json.dumps({"hasJob": True, "job": job}, ensure_ascii=False).encode("utf-8"))
            else:
                self.wfile.write(json.dumps({"hasJob": False, "connected": True}, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()

    def do_POST(self):
        if self.path == "/clean":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))

                img_data_str = data.get("image", "")
                filename = data.get("filename", f"clean_{int(time.time())}.png")

                if not img_data_str:
                    self.send_response(400)
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "No image data provided"}).encode("utf-8"))
                    return

                # Decode base64
                if "," in img_data_str:
                    img_data_str = img_data_str.split(",", 1)[1]
                img_bytes = base64.b64decode(img_data_str)
                img = Image.open(io.BytesIO(img_bytes))

                t0 = time.time()
                clean_img = clean_image_watermark(img)
                elapsed = time.time() - t0

                # Tự động lưu 1 bản vào cleaned_images
                save_path = os.path.join(CLEANED_DIR, filename)
                os.makedirs(os.path.dirname(save_path), exist_ok=True)
                clean_img.save(save_path, format="PNG")
                print(f"✨ [LaMa Clean] Đã xóa logo trong {elapsed:.2f}s -> Lưu tại: {filename}")

                # Encode kết quả về base64 để extension có thể tải về
                buf = io.BytesIO()
                clean_img.save(buf, format="PNG")
                clean_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                res_obj = {
                    "success": True,
                    "filename": filename,
                    "elapsedSeconds": round(elapsed, 2),
                    "savedPath": save_path,
                    "cleanedImage": clean_b64
                }
                self.wfile.write(json.dumps(res_obj, ensure_ascii=False).encode("utf-8"))

            except Exception as e:
                print(f"❌ Lỗi xử lý /clean: {e}")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

        elif self.path == "/api/jobs/complete":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8")) if body else {}

                job_id = data.get("job_id")
                state = job_snapshot(job_id) if job_id else None
                if not state:
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Unknown job_id"}).encode("utf-8"))
                    return
                if state.get("status") in {"expired", "cancelled"}:
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "ignored": True, "status": state.get("status")}).encode("utf-8"))
                    return

                images = data.get("images") or []
                expected = int(state.get("expected_images", 0))
                succeeded = bool(data.get("success")) and len(images) == expected
                if succeeded:
                    JOB_RESULTS[job_id] = data
                    set_job_state(job_id, "completed", completed_at=time.time(), total_generated=len(images))
                else:
                    error = data.get("error") or f"Expected {expected} images, received {len(images)}"
                    JOB_RESULTS[job_id] = {"success": False, "error": error, "images": images}
                    set_job_state(job_id, "failed", completed_at=time.time(), error=error)
                if job_id in JOB_EVENTS:
                    JOB_EVENTS[job_id].set()

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": succeeded, "job_id": job_id}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

        elif self.path in ["/api/generate", "/v1/images/generations"]:
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8")) if body else {}

                # Kiểm tra tab Google Flow
                if (time.time() - LAST_TAB_HEARTBEAT) > TAB_HEARTBEAT_TIMEOUT_SECONDS:
                    self.send_response(503)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "error": "Tab Google Flow chưa kết nối! Vui lòng mở hoặc F5 tab https://flow.google.com trong trình duyệt."
                    }, ensure_ascii=False).encode("utf-8"))
                    return

                # Parse prompts: mảng prompts hoặc 1 prompt đơn lẻ
                raw_prompts = data.get("prompts")
                if not raw_prompts:
                    single_p = data.get("prompt")
                    if single_p:
                        raw_prompts = [single_p]
                    else:
                        self.send_response(400)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self._send_cors_headers()
                        self.end_headers()
                        self.wfile.write(json.dumps({"error": "Vui lòng truyền mảng 'prompts' hoặc chuỗi 'prompt'!"}, ensure_ascii=False).encode("utf-8"))
                        return

                if isinstance(raw_prompts, str):
                    raw_prompts = [raw_prompts]
                if not isinstance(raw_prompts, list) or not raw_prompts or any(not isinstance(p, str) or not p.strip() for p in raw_prompts):
                    raise ValueError("prompts must be a non-empty string or array of non-empty strings")
                if len(raw_prompts) > MAX_PROMPTS_PER_JOB:
                    raise ValueError(f"Too many prompts: max {MAX_PROMPTS_PER_JOB}")

                # Cấu hình mặc định: variations = 1, aspect = 16:9
                aspect_ratio = data.get("aspectRatio") or data.get("aspect_ratio") or "16:9"
                variations = int(data.get("variations") or data.get("n") or 1)
                clean_watermark = data.get("cleanWatermark", True)
                if aspect_ratio not in VALID_ASPECT_RATIOS:
                    raise ValueError(f"Unsupported aspect ratio: {aspect_ratio}")
                if not 1 <= variations <= MAX_VARIATIONS:
                    raise ValueError(f"variations must be 1-{MAX_VARIATIONS}")

                request_id = str(data.get("request_id") or self.headers.get("X-Request-ID") or uuid.uuid4().hex).strip()
                if not request_id:
                    raise ValueError("request_id must not be blank")
                with JOB_LOCK:
                    existing = JOB_REQUEST_INDEX.get(request_id)
                if existing:
                    existing_state = job_snapshot(existing)
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Duplicate request_id", "job_id": existing, "status": existing_state}, ensure_ascii=False).encode("utf-8"))
                    return

                job_id = f"job_{uuid.uuid4().hex}"
                ev = threading.Event()
                with JOB_LOCK:
                    JOB_EVENTS[job_id] = ev
                    JOB_REQUEST_INDEX[request_id] = job_id
                set_job_state(job_id, "queued", request_id=request_id, expected_images=len(raw_prompts) * variations,
                              total_prompts=len(raw_prompts), variations=variations, aspect_ratio=aspect_ratio)

                job_payload = {
                    "id": job_id,
                    "prompts": raw_prompts,
                    "aspectRatio": aspect_ratio,
                    "variations": variations,
                    "cleanWatermark": clean_watermark
                }

                print(f"📥 [API Generate] Nhận job {job_id} với {len(raw_prompts)} prompts (variations: {variations}, ratio: {aspect_ratio})")
                JOB_QUEUE.put(job_payload)

                # Chờ Extension trong tab xử lý xong (timeout 300s)
                completed = ev.wait(timeout=300)
                if not completed:
                    set_job_state(job_id, "expired", error="Timeout 300s: Google Flow chưa hoàn thành tạo ảnh.")
                    with JOB_LOCK:
                        JOB_EVENTS.pop(job_id, None)
                    self.send_response(504)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Timeout 300s: Google Flow chưa hoàn thành tạo ảnh."}, ensure_ascii=False).encode("utf-8"))
                    return

                with JOB_LOCK:
                    res_data = JOB_RESULTS.pop(job_id, {})
                    JOB_EVENTS.pop(job_id, None)
                if not res_data.get("success"):
                    self.send_response(502)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "job_id": job_id, "error": res_data.get("error", "Flow job failed")}, ensure_ascii=False).encode("utf-8"))
                    return

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()

                response_obj = {
                    "success": True,
                    "job_id": job_id,
                    "total_prompts": len(raw_prompts),
                    "save_folder": "Downloads/Flow_Images",
                    "cleaned_storage": CLEANED_DIR,
                    "data": res_data.get("images", [])
                }
                self.wfile.write(json.dumps(response_obj, ensure_ascii=False).encode("utf-8"))

            except Exception as e:
                print(f"❌ Lỗi /api/generate: {e}")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


def run_server(port=5055):
    server = ThreadingHTTPServer(("127.0.0.1", port), WatermarkHTTPHandler)
    print("\n" + "=" * 60)
    print("🎯 FLOW WATERMARK SERVICE ĐANG CHẠY")
    print(f"👉 API URL: http://127.0.0.1:{port}")
    print(f"📁 Thư mục lưu ảnh đã làm sạch: {CLEANED_DIR}")
    print("⚡ Extension Gg_flow sẽ tự động kết nối khi bạn tạo ảnh.")
    print("=" * 60 + "\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n⏹️ Đang dừng service...")
        server.server_close()


def clean_batch(folder_path):
    """Xóa watermark cho toàn bộ ảnh trong 1 folder"""
    if not os.path.exists(folder_path):
        print(f"❌ Thư mục không tồn tại: {folder_path}")
        return

    output_dir = os.path.join(folder_path, "cleaned")
    os.makedirs(output_dir, exist_ok=True)

    files = [f for f in os.listdir(folder_path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    print(f"🔍 Tìm thấy {len(files)} ảnh trong: {folder_path}")

    for idx, fname in enumerate(files, 1):
        fpath = os.path.join(folder_path, fname)
        try:
            img = Image.open(fpath)
            t0 = time.time()
            clean_img = clean_image_watermark(img)
            out_path = os.path.join(output_dir, fname)
            clean_img.save(out_path)
            print(f"[{idx}/{len(files)}] ✅ Đã làm sạch: {fname} ({time.time() - t0:.2f}s)")
        except Exception as e:
            print(f"[{idx}/{len(files)}] ❌ Lỗi ảnh {fname}: {e}")

    print(f"\n🎉 Hoàn thành! Toàn bộ ảnh đã được lưu vào: {output_dir}")


def watch_folder(watch_dir):
    """Theo dõi thư mục (vd: Downloads) và tự động xóa watermark khi có ảnh mới"""
    print(f"👀 Đang theo dõi thư mục: {watch_dir}")
    print("Tự động lọc các ảnh có tiền tố 'Flow_' để xóa watermark...")
    seen = set(os.listdir(watch_dir))

    while True:
        try:
            time.sleep(1)
            current = set(os.listdir(watch_dir))
            new_files = current - seen
            seen = current

            for f in new_files:
                if f.startswith("Flow_") and f.lower().endswith(('.png', '.jpg', '.webp')):
                    time.sleep(0.5)  # Chờ file ghi xong hoàn toàn
                    fpath = os.path.join(watch_dir, f)
                    try:
                        img = Image.open(fpath)
                        clean_img = clean_image_watermark(img)
                        # Lưu đè file sạch hoặc lưu vào cleaned
                        clean_img.save(fpath)
                        print(f"✨ [Auto Watcher] Đã xóa watermark ảnh mới: {f}")
                    except Exception as err:
                        print(f"⚠️ [Auto Watcher] Không thể xử lý {f}: {err}")
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Google Flow AI Watermark Cleaner")
    parser.add_argument("--port", type=int, default=5055, help="Port cho HTTP service (default: 5055)")
    parser.add_argument("--batch", type=str, default="", help="Đường dẫn thư mục để xóa hàng loạt")
    parser.add_argument("--watch", type=str, default="", help="Đường dẫn thư mục cần theo dõi tự động (vd: Downloads)")

    args = parser.parse_args()

    if args.batch:
        clean_batch(args.batch)
    elif args.watch:
        watch_folder(args.watch)
    else:
        run_server(args.port)
