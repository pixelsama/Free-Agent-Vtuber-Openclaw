@echo off
setlocal

echo Starting desktop development environment...

where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo npm is required. Please install Node.js first.
  exit /b 1
)

echo Installing root dependencies...
call npm install
if %errorlevel% neq 0 exit /b %errorlevel%

echo Installing front_end dependencies...
pushd front_end
call npm install
if %errorlevel% neq 0 (
  popd
  exit /b %errorlevel%
)
popd

echo Launching Electron + renderer dev servers...
call npm run desktop:dev
