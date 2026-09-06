@echo off
setlocal
title Molten Metals ERP

REM Desktop-icon launcher for the shop-floor machine.
REM
REM Does the whole thing on every click: fetch the latest code, apply any new
REM migrations, rebuild, then start and open the browser. Nothing to remember,
REM nothing to run first.
REM
REM The window it opens is the server log - closing it stops the ERP.

cd /d "%~dp0"

if "%PORT%"=="" set PORT=3000

echo.
echo   ============================================
echo     MOLTEN METALS ERP
echo   ============================================
echo.

REM ---------------------------------------------------------------- checks

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, or not on PATH.
  echo   Install it from https://nodejs.org then try again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo   .env is missing - the app cannot reach the database without it.
  echo   Copy .env.example to .env and fill in DATABASE_URL.
  echo.
  pause
  exit /b 1
)

REM Already running? Open the browser rather than starting a second copy,
REM which would fail on the port and look like a crash.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>nul
if not errorlevel 1 (
  echo   Already running. Opening the browser...
  start "" "http://localhost:%PORT%"
  timeout /t 4 >nul
  exit /b 0
)

REM -------------------------------------------------------------- start up

REM Opens the browser once the server answers, rather than immediately - a
REM browser opened too early lands on a connection-refused page and looks broken
start "" /b cmd /c "node open-when-ready.mjs %PORT%"

echo   Updating and starting. First run after a code change takes a
echo   minute or two while it rebuilds.
echo.
echo   ============================================
echo     KEEP THIS WINDOW OPEN.
echo     Closing it stops the ERP.
echo   ============================================
echo.

REM update.mjs does the lot: pull, install, migrate, build, start. It stops on
REM a failed migration or build rather than starting something broken, and a
REM missing network is a warning, not a failure.
node update.mjs

echo.
echo   The ERP has stopped.
pause
