"""
Ví dụ gọi API nội bộ Google Flow (Tạo ảnh hàng loạt 0 credits + Tự động xóa logo Gemini)
----------------------------------------------------------------------------------------
Endpoint: http://127.0.0.1:5055/api/generate
"""

import os
import sys
import requests
import json

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

API_URL = "http://127.0.0.1:5055/api/generate"

# Danh sách mảng prompt muốn tạo
payload = {
    "prompts": [
        "A cute robotic cat sitting on a neon cyberpunk desk, digital art",
        "A cup of hot coffee with latte art on a wooden table, morning light"
    ],
    "aspectRatio": "16:9",  # Tùy chọn: "16:9", "1:1", "9:16", "4:3", "3:4"
    "variations": 1,        # Mặc định: 1 ảnh mỗi prompt
    "cleanWatermark": True  # Tự động xóa sạch logo ngôi sao Gemini bằng AI LaMa
}

print("🚀 Đang gửi mảng prompts đến API nội bộ Google Flow...")
print(f"👉 API Endpoint: {API_URL}")
print(f"📝 Số lượng prompt: {len(payload['prompts'])}")

try:
    response = requests.post(API_URL, json=payload, timeout=300)
    
    if response.status_code == 200:
        result = response.json()
        print("\n🎉 TẠO ẢNH THÀNH CÔNG!")
        print(f"📁 Thư mục lưu trên máy: {result.get('save_folder')}")
        print(f"💾 Bản lưu sạch tại: {result.get('cleaned_storage')}")
        print("\nChi tiết các ảnh:")
        for idx, item in enumerate(result.get("data", []), 1):
            print(f"[{idx}] Prompt: {item.get('prompt')}")
            print(f"    File: {item.get('filename')}")
            print(f"    URL: {item.get('url')}\n")
    else:
        print(f"❌ Lỗi HTTP {response.status_code}: {response.text}")

except requests.exceptions.ConnectionError:
    print("❌ Không thể kết nối tới Service! Hãy đảm bảo đã chạy file 'run_watermark_cleaner.bat'.")
except Exception as e:
    print(f"❌ Lỗi: {e}")
