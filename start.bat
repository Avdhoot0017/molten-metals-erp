@echo off
setlocal enabledelayedexpansion
title Molten Metals ERP

REM Double-click launcher for the shop-floor machine.
REM
REM Starts the ERP and opens it in the browser. No terminal, no VS Code.
REM The window it opens is the server log - closing it stops the ERP.
REM
REM   start.bat              start it
REM   start.bat --rebuild    rebuild first (after pulling new code)
REM
REM To UPDATE the code, use deploy.bat instead - that pulls from git.

cd /d "%~dp0"

set PORT=3000
set REBUILD=0
if /i "%~1"=="--rebuild" set REBUILD=1

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

REM Already running? Just open the browser rather than starting a second one,
REM which would fail on the port and look like a crash.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>nul
if not errorlevel 1 (
  echo   Already running. Opening the browser...
  start "" "http://localhost:%PORT%"
  echo.
  echo   To stop it, close the other Molten Metals window.
  timeout /t 4 >nul
  exit /b 0
)

REM ----------------------------------------------------------- preparation

echo   Checking the database...
call npx prisma migrate deploy >nul 2>nul
if errorlevel 1 (
  echo.
  echo   The database could not be reached, or a migration failed.
  echo   Check DATABASE_URL in .env, and that PostgreSQL is running.
  echo.
  pause
  exit /b 1
)
call npx prisma generate >nul 2>nul

if not exist ".next\BUILD_ID" set REBUILD=1
if "%REBUILD%"=="1" (
  echo   Building - this takes a minute, only needed after an update...
  call npm run build
  if errorlevel 1 (
    echo.
    echo   The build failed. The ERP was not started.
    echo.
    pause
    exit /b 1
  )
)

REM -------------------------------------------------------------- start up

echo   Starting...
echo.

REM Opens the browser once the server answers, rather than immediately - a
REM browser opened too early lands on a connection-refused page and looks broken
start "" /b cmd /c "node open-when-ready.mjs %PORT%"

echo   ============================================
echo     Running at http://localhost:%PORT%
echo.
echo     KEEP THIS WINDOW OPEN.
echo     Closing it stops the ERP.
echo   ============================================
echo.

call npm start -- -p %PORT%

echo.
echo   The ERP has stopped.
pause
