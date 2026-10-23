# Carrot Flask Client

Python/Flask-порт веб-клиента Carrot Broadcast (плейлисты, события, медиа, создание).

Подробная документация по каждой функции: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Быстрый старт (Windows)

```bat
cd carrot\flask-client
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
notepad .env
web.cmd
```

Открой http://127.0.0.1:3456

## Быстрый старт (Linux/macOS)

```bash
cd carrot/flask-client
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
./web.sh
```

## Что умеет UI

- Разделы **События** / **Создание** (взаимоисключающие).
- Боковая панель «Все события» + плейлисты (скрыта по умолчанию, рейка ›/‹).
- Таблица событий: колонки, фильтр, сортировка, multi-select, удаление.
- Редактор переменных (включая Media как `id;имя` и обычный текст).
- Загрузка медиа в Carrot (TUS 1.0.0: кнопка «Загрузить медиа» и ↑ у Media-полей).
- Создание нескольких событий по шаблонам (имена и External id могут совпадать).

## Структура

```
flask-client/
  app.py                 # Flask: API + статика
  carrot_client/         # библиотека REST/WS
    client.py
    ws.py
    util.py
    errors.py
  web/static/            # index.html, app.js, app.css
  docs/ARCHITECTURE.md   # детальное описание
  requirements.txt
  .env.example
  web.cmd / web.sh
```

Старый Node-клиент остаётся в `carrot/rest-client/` (CLI ticker/stress/playout).  
Веб-UI рекомендуется запускать через Flask.

## Порты Carrot

| Порт | Назначение |
|------|------------|
| REST (часто 5001) | JWT API `/auth/generate`, `/events`, `/templates`, … |
| 24710 | WS команд: CreateEventInDB / RemoveEventFromDB |
| 24712 | WS медиа: MediaAssetLibrary/GetAssetFolder |
| 8088 | НЕ использовать — это веб-плейлист (HTML) |
