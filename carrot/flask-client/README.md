# Carrot Flask Client

Веб-клиент Carrot Broadcast на Flask: плейлисты, события, медиа, Excel-импорт.

Браузер ходит только на локальный Flask; сервер использует `carrot_client.py`
(REST/WS + Excel). UI — HTML/CSS/JS в `web/`.

## Быстрый старт (Windows)

```bat
cd carrot\flask-client
copy .env.example .env
notepad .env
web.cmd
```

Нужен **Python 3.10+** в PATH (галочка *Add python.exe to PATH* при установке
с https://www.python.org/). Затем `web.cmd` сам создаст `.venv`, поставит
зависимости из `requirements.txt`, запустит сервер и откроет Google Chrome на
http://127.0.0.1:3456

Если Python не находится: закрой и снова открой `cmd` после установки, либо
используй лаунчер `py` (Python Launcher for Windows).

## Быстрый старт (Linux/macOS)

```bash
cd carrot/flask-client
cp .env.example .env
./web.sh
```

То же: venv + pip install + Flask + Chrome.

## Что умеет UI

- разделы **События** / **Создание**;
- плейлисты, таблица событий, фильтр, multi-select, удаление;
- создание из шаблона; Media как `id;имя` или загрузка файла;
- импорт из Excel (диалог шаблона → файл);
- Media в Excel: поиск в Carrot, иначе файл из папки в **Настройки**;
- тема, подключение (**Base URL / login / password** → пишутся в `.env`)
  и папка медиа в боковом меню → **Настройки**.

### Формат Excel

- первая колонка — имя;
- последняя — External id;
- средние — переменные;
- Media — имена файлов. Нет файла в Carrot и в папке → импорт прерывается.

## Структура

```
flask-client/
  app.py              # Flask: /api/* + статика
  carrot_client.py    # REST/WS клиент + Excel
  web/                # index.html, app.js, app.css
  requirements.txt
  .env.example
  web.cmd / web.sh
```

## Порты Carrot

| Порт | Назначение |
|------|------------|
| REST (часто 5001) | JWT API |
| 24710 | WS команд (создание/удаление событий) |
| 24712 | WS медиа |
| 8088 | не использовать (веб-плейлист) |
