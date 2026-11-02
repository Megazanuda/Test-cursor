#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ошибка] Нужен python3 в PATH" >&2
  exit 1
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "[setup] Создаю виртуальное окружение .venv ..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "[setup] Ставлю зависимости из requirements.txt ..."
python -m pip install --upgrade pip >/dev/null
python -m pip install -r requirements.txt

echo "[start] Запуск Flask UI — Chrome откроется сам..."
exec python app.py
