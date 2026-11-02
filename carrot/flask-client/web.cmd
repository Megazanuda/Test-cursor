@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo [ошибка] Нужен Python 3.10+ в PATH. Поставь с https://www.python.org/ и галочкой Add to PATH.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [setup] Создаю виртуальное окружение .venv ...
  python -m venv .venv
  if errorlevel 1 (
    echo [ошибка] Не удалось создать .venv
    pause
    exit /b 1
  )
)

call ".venv\Scripts\activate.bat"

echo [setup] Ставлю зависимости из requirements.txt ...
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ошибка] pip install не удался
  pause
  exit /b 1
)

echo [start] Запуск Flask UI — Chrome откроется сам...
python app.py
pause
