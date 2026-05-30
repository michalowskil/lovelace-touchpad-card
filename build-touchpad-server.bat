@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
if exist "%VENV_PY%" (
  set "PYTHON=%VENV_PY%"
  echo Using Python from virtualenv: %PYTHON%
  goto :build
)

set "PYTHON=python"
echo Using system Python: %PYTHON%

:build
set "SERVER_VERSION_FILE=%ROOT%backend\VERSION"
if not exist "%SERVER_VERSION_FILE%" (
  echo Missing backend version file: %SERVER_VERSION_FILE%
  exit /b 1
)
set /p SERVER_VERSION=<"%SERVER_VERSION_FILE%"

echo Building backend\dist\touchpad-server.exe (tray, default) ...
%PYTHON% -m PyInstaller ^
  --onefile ^
  --noconsole ^
  --add-data "%ROOT%backend\VERSION;." ^
  --name touchpad-server ^
  --distpath "%ROOT%backend\dist" ^
  --workpath "%ROOT%backend\build" ^
  --specpath "%ROOT%backend\build" ^
  "%ROOT%backend\touchpad_tray.py" || goto :error

> "%ROOT%backend\dist\touchpad-server.version.json" echo {"name":"touchpad-server","version":"%SERVER_VERSION%","asset":"touchpad-server.exe"}
echo Done: backend\dist\touchpad-server.exe (tray)
echo Done: backend\dist\touchpad-server.version.json
exit /b 0

:error
echo ERROR: PyInstaller returned error code %errorlevel%.
exit /b %errorlevel%
