@echo off
set NEURANETDIR=%~dp0

rmdir /s /q %NEURANETDIR%\backend\apps\neuranet\cms
mkdir %NEURANETDIR%\backend\apps\neuranet\cms
rmdir /s /q %NEURANETDIR%\backend\apps\neuranet\db\ai_db
mkdir %NEURANETDIR%\backend\apps\neuranet\db\ai_db

echo Done.
