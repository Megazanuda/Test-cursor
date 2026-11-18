#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ошибка] Нужен python3 в PATH" >&2
  exit 1
fi

VENV_PY=".venv/bin/python"

recreate_venv() {
  echo "[warn] Сломан .venv/pip — пересоздаю .venv ..."
  rm -rf .venv
  python3 -m venv .venv
}

if [[ ! -x "$VENV_PY" ]]; then
  echo "[setup] Создаю виртуальное окружение .venv ..."
  python3 -m venv .venv
fi

if ! "$VENV_PY" -c "import pip" >/dev/null 2>&1; then
  recreate_venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "[setup] Ставлю зависимости из requirements.txt ..."
if ! python -m pip install --upgrade pip >/dev/null; then
  recreate_venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  python -m pip install --upgrade pip >/dev/null
fi
if ! python -m pip install -r requirements.txt; then
  echo "[warn] pip install не удался — ensurepip + retry ..."
  python -m ensurepip --upgrade >/dev/null 2>&1 || true
  if ! python -m pip install --upgrade pip >/dev/null || ! python -m pip install -r requirements.txt; then
    recreate_venv
    # shellcheck disable=SC1091
    source .venv/bin/activate
    python -m pip install --upgrade pip >/dev/null
    python -m pip install -r requirements.txt
  fi
fi

echo "[start] Запуск Flask UI — Chrome откроется сам..."
exec python app.py
