@echo off
rem ─────────────────────────────────────────────────────────────────
rem  Persian Notes — one-click launcher for non-technical users.
rem  Double-click → checks Node → npm run dev → browser opens itself.
rem  NOTE: this file MUST stay UTF-8 *without* BOM; the chcp 65001
rem  below makes cmd decode the Persian echo lines correctly.
rem ─────────────────────────────────────────────────────────────────
chcp 65001 >nul
title Persian Notes
cd /d "%~dp0"

echo.
echo  ============================================
echo    Persian Notes - در حال آماده‌سازی جزوه
echo  ============================================
echo.

rem ── Node.js present? (npm ships with the Windows installer; a fresh
rem    install that has not rebooted explorer yet may lack PATH — fall
rem    back to the default install dir) ──────────────────────────────
where node >nul 2>nul
if not errorlevel 1 goto nodeok
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
  goto nodeok
)
echo  [X] Node.js روی این سیستم نصب نیست.
echo.
echo  الان صفحهٔ دانلود Node.js باز می‌شود:
echo    1. نسخهٔ LTS را نصب کنید - Next/Next/Finish، پیش‌فرض‌ها کافی است.
echo    2. بعد از نصب، این پنجره را ببندید و دوباره روی START-WINDOWS دابل‌کلیک کنید.
echo.
start "" https://nodejs.org/en/download
pause
exit /b 1

:nodeok
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo  [OK] Node %NODEV% پیدا شد.
echo.
echo  … سرور و برنامه بالا می‌آیند. این پنجره را نبندید!
echo  … بار اول نصب خودکار وابستگی‌ها چند دقیقه طول می‌کشد و اینترنت می‌خواهد.
echo.
echo  مرورگر خودکار باز می‌شود؛ اگر باز نشد این آدرس را در مرورگر باز کنید:
echo      http://localhost:5173
echo.
echo  ورود آزمایشی:  demo@pernote.local    رمز:  demo1234
echo.

rem ── detached browser-opener: waits until vite answers on :5173,
rem    then opens the app tab (bounded, minified window) ──────────────
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-when-ready.ps1" -Port 5173 -Url "http://localhost:5173"

rem ── predev preflight auto-creates .env / installs deps / frees ports
call npm run dev

echo.
echo  برنامه بسته شد. اگر اروری دیدید، از متن کامل ارور عکس بفرستید.
pause
