@echo off
REM Double-click this file to set up and start the Job Tracker app.
REM It just hands off to setup_and_run.ps1 with the execution-policy prompt
REM pre-answered for this one run (doesn't change any system-wide setting).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_and_run.ps1"
echo.
pause
