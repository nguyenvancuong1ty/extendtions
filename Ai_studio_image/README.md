# Google AI Studio Image Generator & API Sniffer (Chrome / Edge Extension)

Extension trình duyệt (Manifest V3) chuyên dụng dành cho **Google AI Studio** tại địa chỉ:  
🔗 **https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-lite-image**

Cơ chế hoạt động tương tự như **Gg_flow**, cung cấp công cụ tự động bắt mạng, bóc tách ảnh AI chất lượng cao, tự động hóa tạo ảnh hàng loạt (Batch Generator) và tải ảnh trực tiếp về máy tính.

---

## ✨ Cơ Chế Hoạt Động Mới: Sniffer & Direct Replay

1. **🚫 Không điền prompt vào chatbox DOM**: Hoàn toàn không can thiệp vào khung chat hay click nút Run của trang, tránh mọi rủi ro lag hoặc lỗi DOM.
2. **📡 Tự động bắt Request & Auth của tài khoản Google**:
   - Khi bạn tạo thử 1 bức ảnh đầu tiên trên AI Studio, extension sẽ **bắt trọn vẹn Request** (Endpoint, Headers, Auth Token `Bearer ya29...`, Cookies, Body Sample).
   - Tự động lưu Request này làm **Account Template** sẵn sàng sử dụng.
3. **⚡ Direct Request Replay (Tạo ảnh siêu nhanh)**:
   - Khi chạy hàng loạt, extension chỉ cần thay prompt mới vào body của request đã bắt và gửi trực tiếp tới máy chủ Google (chạy ngầm 100%).
   - Tận dụng 100% hạn mức miễn phí của tài khoản Google trên web, không cần trả phí cho Developer API.
4. **👥 Hỗ trợ Nhiều Tài Khoản (Multi-Account)**:
   - Dễ dàng bắt và lưu Auth của nhiều tài khoản Google khác nhau (`/u/0/`, `/u/1/`, `/u/2/`...).
   - Tự động xoay vòng tài khoản (**Round-Robin**) để tạo ảnh liên tục số lượng lớn.
5. **🛡️ Không tự động tải ảnh khi F5**: Đã xử lý triệt để, chỉ tải duy nhất ảnh mới do phiên batch tạo ra.

---

## 🎯 Hướng Dẫn Sử Dụng Nhanh

### Bước 1: Nạp lại Extension
1. Mở `chrome://extensions` trên trình duyệt.
2. Bấm nút **Tải lại (Biểu tượng xoay tròn 🔄)** tại tiện ích **Google AI Studio Image Generator & Sniffer**.

### Bước 2: Bắt Request & Auth Token (Chỉ cần làm 1 lần cho mỗi tài khoản)
1. Truy cập tab AI Studio:  
   🔗 [https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-lite-image](https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-lite-image)
2. Gõ và tạo thử **1 bức ảnh bất kỳ** trên khung chat AI Studio (ví dụ: `cat`).
3. Ngay khi ảnh được tạo, tiện ích sẽ **tự động tóm Request & Auth Token** của tài khoản hiện tại và hiển thị thông báo màu xanh `🎯 Đã bắt thành công Request & Auth!`.

### Bước 3: Chạy tạo ảnh hàng loạt (Direct Request Replay)
1. Mở bảng điều khiển tiện ích (bấm vào biểu tượng **✨ AI Studio Image** ở góc dưới phải).
2. Dán danh sách prompt cần tạo vào ô nhập (mỗi dòng 1 prompt).
3. Bấm **🚀 Bắt Đầu Tạo Ảnh (Direct Request)**.
4. Tiện ích sẽ gọi trực tiếp các request ngầm, bóc tách ảnh Base64 và tự động tải file `.png` về máy tính của bạn!

### Bước 4: Thêm nhiều tài khoản khác (Tùy chọn)
- Chuyển sang tab **👥 Quản Lý Tài Khoản & Auth**.
- Bấm nút **👤 Mở Tab Tài khoản 2 (/u/1/)** (hoặc `/u/2/`, `/u/3/`...).
- Trên tab mới, cũng tạo thử 1 ảnh để tiện ích bắt Auth của tài khoản thứ hai.
- Giờ đây bạn đã có nhiều tài khoản được lưu và extension sẽ tự động xoay vòng giữa các tài khoản khi tạo ảnh!
