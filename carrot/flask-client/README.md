# Carrot Flask Client

Веб-клиент Carrot Broadcast на Flask: плейлисты, события, медиа, Excel-импорт.

Браузер ходит только на локальный Flask; сервер использует `carrot_client.py`
(REST/WS + Excel). UI — HTML/CSS/JS в `web/`.

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

- разделы **События** / **Создание**;
- плейлисты, таблица событий, фильтр, multi-select, удаление;
- создание из шаблона; Media как `id;имя` или загрузка файла;
- импорт из Excel (диалог шаблона → файл);
- Media в Excel: поиск в Carrot, иначе файл из папки в **Настройки**;
- тема и папка медиа в боковом меню.

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
