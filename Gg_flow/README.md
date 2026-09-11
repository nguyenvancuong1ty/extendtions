# Google Flow Studio & API Bridge (Video & 0-Credit Image Generator) - v2.0.0

Extension trình duyệt (Manifest V3) đa năng dành riêng cho Google Flow tại địa chỉ:  
🔗 **https://flow.google.com** & **https://labs.google/fx/tools/flow**

---

## ✨ Tính Năng Nổi Bật

### 🎨 1. Tự Động Tạo Ảnh Hàng Loạt (0 Credits - Nano Banana 2 Lite)
- **Hoàn toàn 0 Credit**: Sử dụng mô hình `Nano Banana 2 Lite` (`gemini-3.1-flash-lite-image`), không tiêu tốn quỹ credit tháng của tài khoản Google One AI Premium (PRO).
- **Tùy biến tỉ lệ & số lượng**:
  - Tỉ lệ khung hình: `16:9` (Phong cảnh), `1:1` (Vuông Avatar), `4:3` (Chuẩn), `3:4` (Dọc vừa), `9:16` (TikTok/Shorts).
  - Biến thể: `x1`, `x2`, `x3`, `x4` ảnh đồng thời cho mỗi prompt.
- **Tự động tải về máy**: Tải ảnh chất lượng cao `.PNG` về máy tính theo đúng tên câu prompt.
- **Chạy nền không bị dừng (Anti-Throttling)**: Tích hợp cơ chế Web Audio Keep-Alive và Visibility State Spoofing, giúp extension tiếp tục tạo ảnh liên tục dù bạn chuyển sang tab khác hay thu nhỏ trình duyệt.

### 🖼️ 2. Bộ Sưu Tập Ảnh (In-Page Gallery & Lightbox)
- Lưu trữ toàn bộ ảnh đã tạo ngay trong giao diện trang.
- Xem trước phóng to (Lightbox) cực nét.
- Nút Copy Prompt và Tải từng ảnh hoặc Tải tất cả ảnh với 1 click.

### 🎬 3. Bắt & Phân Tích API (Video, Project, Polling)
- Bắt trọn vẹn request sinh Video qua Veo / Imagen / VideoFX.
- Xuất lệnh cURL, Request Payload, Response, Token Bearer / Cookie.
- Hỗ trợ Proxy Bridge kết nối Canvas Studio (Bypass CORS & reCAPTCHA).

---

## 🚀 Hướng Dẫn Cài Đặt & Cập Nhật

1. Mở trình duyệt Chrome và truy cập: `chrome://extensions`
2. Bật công tắc **"Developer mode"** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm nút **"Load unpacked"** (Tải tiện ích đã giải nén) và chọn thư mục:  
   👉 `D:\Extendtions\Gg_flow`  
   *(Nếu đã cài trước đó, chỉ cần bấm biểu tượng **Reload 🔄** tại thẻ tiện ích)*.
4. Mở hoặc F5 lại trang Google Flow của bạn:  
   🔗 **https://flow.google.com**
5. Bạn sẽ thấy biểu tượng huy hiệu nổi **⚡ Flow Studio** ở góc dưới bên phải màn hình.
6. Bấm vào huy hiệu, chọn tab **"🎨 Tạo Ảnh Hàng Loạt (0 Credits)"**, dán danh sách prompt và bấm **"🚀 Bắt Đầu Tạo Ảnh Hàng Loạt"**!
