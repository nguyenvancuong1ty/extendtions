@echo off
title Google Flow AI Watermark Cleaner (Simple-LaMa)
chcp 65001 >nul
echo ========================================================
echo   🚀 DANG KHOI DONG GOOGLE FLOW WATERMARK CLEANER
echo   - Mo hinh: AI Simple-LaMa (SOTA Inpainting)
echo   - Cong ket noi: http://127.0.0.1:5055
echo   - Tu dong ket noi voi Extension Gg_flow
echo ========================================================
python "%~dp0tools\watermark_cleaner\watermark_service.py" --port 5055
pause
