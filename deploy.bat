@echo off
REM Windows entry point: pull, migrate, build, start.
REM
REM deploy.sh is a bash script and will not run in cmd or PowerShell, so this
REM hands the job to update.mjs, which does the same work in plain Node.
REM
REM   deploy                 pull, migrate, build, start
REM   deploy --no-start      stop after the build
REM   deploy --no-pull       local code, just migrate/build/start

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or not on PATH.
  echo   Install it from https://nodejs.org and open a new terminal.
  echo.
  exit /b 1
)

node "%~dp0update.mjs" %*
exit /b %errorlevel%
