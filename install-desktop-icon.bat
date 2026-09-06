@echo off
title Molten Metals ERP - desktop icon

REM Puts a "Molten Metals ERP" icon on the Desktop that starts the app and
REM opens it in the browser. Run this once, after setting the machine up.
REM
REM Windows has no command for creating a shortcut, so it is done through the
REM same COM object Explorer uses, driven by PowerShell.

cd /d "%~dp0"

set "TARGET=%~dp0start.bat"
set "ICON=%~dp0public\molten-metals.ico"
set "SHORTCUT=%USERPROFILE%\Desktop\Molten Metals ERP.lnk"

echo.
echo   Creating the desktop icon...
echo.

if not exist "%TARGET%" (
  echo   start.bat is missing from this folder. Nothing to point the icon at.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%');" ^
  "$s.TargetPath = '%TARGET%';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.IconLocation = '%ICON%';" ^
  "$s.Description = 'Start Molten Metals ERP and open it in the browser';" ^
  "$s.Save()"

if errorlevel 1 (
  echo.
  echo   Could not create the shortcut.
  echo   You can still start the ERP by double-clicking start.bat here.
  echo.
  pause
  exit /b 1
)

echo   Done. Look for "Molten Metals ERP" on the Desktop.
echo.
echo   Double-click it to start the ERP and open it in the browser.
echo   The window that opens is the server - closing it stops the ERP.
echo.
pause
