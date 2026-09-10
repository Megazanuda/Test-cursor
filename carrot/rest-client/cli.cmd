@echo off
rem Запуск CLI на Windows: UTF-8 в консоли + node из этой же папки.
chcp 65001 >nul
node "%~dp0cli.js" %*
