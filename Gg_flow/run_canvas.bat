@echo off
title Flow Canvas Studio
echo ========================================================
echo   Dang khoi dong Flow Canvas Studio (http://localhost:3000)
echo ========================================================
start "" "http://localhost:3000"
node "%~dp0canvas-studio\server.js"
pause
