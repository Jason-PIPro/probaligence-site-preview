@echo off
setlocal
cd /d "%~dp0"
set PORT=8137

echo ============================================================
echo   PI Probaligence site - local preview
echo ============================================================
echo.

REM Find Python (the launcher 'py' first, then 'python')
set PYCMD=
where py >nul 2>nul && set PYCMD=py
if not defined PYCMD ( where python >nul 2>nul && set PYCMD=python )
if not defined PYCMD (
  echo  ERROR: Python was not found on this PC.
  echo  Install Python from https://www.python.org/downloads/ (tick "Add to PATH"),
  echo  then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo  Starting the preview server in a separate window...
start "PI Probaligence preview server - KEEP OPEN" cmd /k "cd /d ""%~dp0"" && %PYCMD% -m http.server %PORT%"

echo  Waiting for the server to start...
ping -n 3 127.0.0.1 >nul

echo  Opening http://localhost:%PORT%/ in your browser.
start "" "http://localhost:%PORT%/"

echo.
echo  DONE. The site should be open in your browser.
echo  - If the page looks unstyled, press Ctrl+F5 to hard-refresh.
echo  - The server runs in the other window titled "...KEEP OPEN".
echo    Close that window when you are finished.
echo.
echo  You can close THIS window now.
timeout /t 8 >nul
endlocal
