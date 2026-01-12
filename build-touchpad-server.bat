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
echo Building backend\dist\touchpad-server.exe (tray, default) ...
%PYTHON% -m PyInstaller ^
  --onefile ^
  --noconsole ^
  --name touchpad-server ^
  --distpath "%ROOT%backend\dist" ^
  --workpath "%ROOT%backend\build" ^
  --specpath "%ROOT%backend\build" ^
  "%ROOT%backend\touchpad_tray.py" || goto :error

echo Done: backend\dist\touchpad-server.exe (tray)
exit /b 0

:error
echo ERROR: PyInstaller returned error code %errorlevel%.
exit /b %errorlevel%
