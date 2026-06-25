@echo off
title DopeTool Installer for Windows
echo.
echo  ==========================================
echo   DopeTool Installer for Windows
echo  ==========================================
echo.

echo  Enabling CEP debug mode...
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo  [OK] Debug mode enabled

echo  Installing DopeTool...
set DEST=%APPDATA%\Adobe\CEP\extensions\DopeTool
set SOURCE=%~dp0

if exist "%DEST%" (
  echo  Existing installation found - updating...
  rmdir /s /q "%DEST%"
)

mkdir "%DEST%" >nul 2>&1
xcopy "%SOURCE%*" "%DEST%\" /E /I /H /Y >nul 2>&1
echo  [OK] DopeTool installed

echo.
echo  ==========================================
echo   Installation complete!
echo.
echo   Open After Effects and go to:
echo   Window - Extensions - DopeTool
echo  ==========================================
echo.
pause
