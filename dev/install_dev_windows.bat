@echo off
title DopeTool DEV (Tester) Installer
echo.
echo  ==========================================
echo   DopeTool DEV (Tester) Installer
echo  ==========================================
echo.
echo  This installs a SEPARATE tester panel that pulls updates
echo  from the 'dev' branch. Your normal DopeTool panel is untouched.
echo.

echo  Enabling CEP debug mode...
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo  [OK] Debug mode enabled

echo  Installing DopeTool Dev...
set SCRIPT_DIR=%~dp0
set DEST=%APPDATA%\Adobe\CEP\extensions\DopeToolDev

if exist "%DEST%" (
  echo  Existing tester install found - updating...
  rmdir /s /q "%DEST%"
)

mkdir "%DEST%" >nul 2>&1

rem Copy the whole repo (parent of this dev folder), then apply dev overrides
xcopy "%SCRIPT_DIR%..\*" "%DEST%\" /E /I /H /Y >nul 2>&1
copy /Y "%SCRIPT_DIR%manifest.xml"  "%DEST%\CSXS\manifest.xml" >nul 2>&1
copy /Y "%SCRIPT_DIR%.debug"        "%DEST%\.debug" >nul 2>&1
copy /Y "%SCRIPT_DIR%channel.json"  "%DEST%\channel.json" >nul 2>&1

rem Remove the git folder from the installed copy (not needed to run)
if exist "%DEST%\.git" rmdir /s /q "%DEST%\.git"

echo  [OK] DopeTool Dev installed (tracks 'dev' branch)

echo.
echo  ==========================================
echo   Tester install complete!
echo.
echo   Open After Effects and go to:
echo   Window - Extensions - DopeTool Dev
echo  ==========================================
echo.
pause
