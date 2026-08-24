# Google Labs Flow API Sniffer (Chrome / Edge Extension)

Extension trình duyệt (Manifest V3) chuyên dụng để tự động bắt, phân tích và trích xuất toàn bộ các lệnh API khi bạn sử dụng công cụ **Google Labs FX Flow** tại địa chỉ:  
🔗 **https://labs.google/fx/tools/flow**

---

## ✨ Tính Năng Nổi Bật

1. **Tự động bắt mạng ở tầng sâu (Deep Hooking)**:
   - Hook trực tiếp `window.fetch` và `XMLHttpRequest` trong ngữ cảnh trang (Main World).
   - Bắt trọn vẹn: **URL Endpoint**, **HTTP Method**, **Headers (kèm Token / Bearer / Cookies)**, **Request Payload**, **Response Payload**, **Thời gian phản hồi (ms)**.

2. **Phân loại thông minh (Smart Categorization)**:
   - 📁 **Tạo Project**: Tự động nhận diện các API khởi tạo Project / Workspace trên Google Flow.
   - 🎬 **Tạo Video / Generate**: Nhận diện các lệnh render video, prompt, sinh video qua mô hình Veo / Imagen / VideoFX.
   - ⏳ **Tiến độ / Polling**: Bắt các request theo dõi trạng thái tiến trình xử lý video (`/operations/`, `/poll`).
   - 🌐 **API Khác**: Lưu lại các API cấu hình, thông tin tài khoản, auth token,...

3. **Giao diện Nổi trực tiếp trên trang (In-Page Floating Widget)**:
   - Một thanh widget tinh tế ở góc dưới bên phải màn hình `labs.google/fx/tools/flow`.
   - Hiển thị số lượng request bắt được theo thời gian thực.
   - Bấm mở rộng để xem bảng điều khiển chia đôi (Split View) như DevTools thu nhỏ.

4. **Trích xuất cURL & Payload với 1 click**:
   - 📋 **Copy cURL**: Tự động chuyển đổi request thành câu lệnh `curl` chuẩn (sẵn sàng dán vào Terminal, Postman, Insomnia, Python,...).
   - 📦 **Copy Payload**: Copy toàn bộ Request Body dưới dạng JSON chuẩn.
   - 📥 **Copy Response**: Copy dữ liệu phản hồi từ máy chủ Google.
   - 🔑 **Copy Token**: Tự động trích xuất Bearer Token hoặc `x-goog-api-key`.
   - 💾 **Xuất file JSON**: Tải về toàn bộ lịch sử API đã bắt để phân tích offline.

5. **Popup tiện ích**:
   - Bấm vào icon extension trên thanh công cụ để xem lại danh sách API mà không cần mở giao diện trên trang.

---

## 🚀 Hướng Dẫn Cài Đặt (Trong 1 phút)

### Bước 1: Mở trang quản lý tiện ích trên trình duyệt
- Trên **Google Chrome**: Mở tab mới và gõ `chrome://extensions`
- Trên **Microsoft Edge**: Gõ `edge://extensions`
- Trên **Brave / Cốc Cốc**: Gõ `brave://extensions` hoặc `coccoc://extensions`

### Bước 2: Bật "Chế độ dành cho nhà phát triển" (Developer mode)
- Gạt công tắc **Developer mode** (Chế độ cho nhà phát triển) ở góc trên bên phải màn hình sang trạng thái **BẬT (ON)**.

### Bước 3: Tải tiện ích vào trình duyệt
- Bấm vào nút **"Load unpacked"** (Tải tiện ích đã giải nén).
- Chọn thư mục: `D:\Extendtions`
- Bấm **Select Folder** (Chọn thư mục).

---

## 🎯 Hướng Dẫn Sử Dụng

1. Mở trình duyệt và truy cập vào: [https://labs.google/fx/tools/flow](https://labs.google/fx/tools/flow)
2. Bạn sẽ thấy biểu tượng huy hiệu nổi **⚡ Flow API Sniffer** ở góc dưới bên phải màn hình.
3. Thực hiện các thao tác:
   - **Tạo một Project mới**: Extension sẽ ngay lập tức bắt API Tạo Project và hiển thị tag xanh lá 📁 **Tạo Project**.
   - **Nhập Prompt & bấm Tạo Video**: Extension sẽ bắt API sinh video và hiển thị tag tím 🎬 **Tạo Video**.
4. Bấm vào bảng điều khiển để:
   - Xem cấu trúc Request Body (Prompt, độ phân giải, tỉ lệ khung hình, số giây, model,...).
   - Bấm **📋 Copy cURL** để chạy lại request trong Postman / Python / Code tự động hóa của bạn.
