@echo off
setlocal
cd /d "%~dp0"
title OSSM HereSphere - Construction de l'installateur

rem Force le registre npm public. Le projet ne doit jamais utiliser
rem une adresse de registre interne provenant de l'environnement de developpement.
set "npm_config_registry=https://registry.npmjs.org/"
set "npm_config_replace_registry_host=always"
set "npm_config_audit=false"
set "npm_config_fund=false"

echo.
echo ============================================================
echo   OSSM HereSphere V0.1.8 RC4 - Construction de l'installateur
echo ============================================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 goto :npm_missing

if exist "node_modules" (
  echo Nettoyage d'une installation precedente incomplete...
  rmdir /s /q "node_modules" 2>nul
  if exist "node_modules" goto :locked_files
)

echo [1/4] Installation des dependances depuis registry.npmjs.org...
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto :error

echo.
echo [2/4] Verification du projet...
call npm.cmd run check
if errorlevel 1 goto :error

echo.
echo [3/4] Creation de l'installateur Windows sans signature...
call npm.cmd run build:win
if errorlevel 1 goto :error

echo.
echo [4/4] Creation de la somme SHA-256...
set "INSTALLER=%~dp0dist\OSSM-HereSphere-Setup-0.1.8-x64.exe"
if not exist "%INSTALLER%" goto :missing_installer
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%INSTALLER%'; $h=(Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower(); Set-Content -LiteralPath ($f + '.sha256.txt') -Encoding ascii -Value ($h + '  ' + [IO.Path]::GetFileName($f))"
if errorlevel 1 goto :error

echo.
echo Installateur et somme SHA-256 crees dans le dossier dist.
start "" "%~dp0dist"
pause
exit /b 0

:missing_installer
echo.
echo ECHEC : l'installateur attendu est absent apres la construction.
pause
exit /b 1

:npm_missing
echo.
echo ECHEC : npm est introuvable sur ce PC de construction.
echo Node.js/npm n'est necessaire que pour fabriquer l'installateur,
echo pas pour utiliser l'application une fois installee.
pause
exit /b 1

:locked_files
echo.
echo ECHEC : certains fichiers de node_modules sont encore verrouilles.
echo Ferme toute fenetre OSSM HereSphere, Electron, npm ou editeur ouverte
echo sur ce dossier, puis supprime node_modules et relance ce fichier.
pause
exit /b 1

:error
echo.
echo ECHEC DE LA CONSTRUCTION.
echo Copie les dernieres lignes affichees pour identifier la cause exacte.
pause
exit /b 1
