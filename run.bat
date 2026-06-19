@echo off
REM Local preview of Money on your PC. (The real app lives on your phone — see README.)
cd /d "%~dp0"
echo.
echo   Money preview running at:  http://localhost:8000
echo   (Press Ctrl+C to stop.)
echo.
python -m http.server 8000 --directory frontend
pause
