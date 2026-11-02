# Carrot REST Web

Локальная веб-страница для плейлистов и событий Carrot Broadcast:
просмотр, создание, удаление, импорт из Excel, загрузка медиа.

Без внешних npm-зависимостей. Нужен **Node.js >= 18**.

Браузер не ходит на Carrot напрямую — запросы идут через `web-server.js`
(прокси + JWT), UI лежит в папке `web/` (HTML / CSS / JS).

---

## Установка (Windows)

1. Поставь **Node.js 18+** с [nodejs.org](https://nodejs.org/).
2. В папке `carrot/rest-client`:

```bat
copy .env.example .env
notepad .env
```

3. В `.env` минимум:

```
CARROT_BASE_URL=http://АДРЕС-СЕРВЕРА:ПОРТ
CARROT_LOGIN=твой_логин
CARROT_PASSWORD=твой_пароль
```

Порт — REST API Carrot (часто `:5001`), не `8088` и не WebSocket
`24710` / `24712`.

---

## Запуск

```bat
web.cmd
```

или:

```bat
node web-server.js
```

Открой в браузере: [http://127.0.0.1:3456](http://127.0.0.1:3456)
(Chrome/Edge — для выбора папки медиа при Excel-импорте).

Логин/пароль можно ввести в форме на странице; значения из `.env`
подставляются как значения по умолчанию.

---

## Что умеет UI

- подключение к Carrot REST;
- список плейлистов и событий, сортировка, удаление;
- создание события из шаблона;
- импорт событий из Excel (шаблон → файл);
- колонка Media: имена файлов; если файла ещё нет в Carrot —
  ищем в выбранной папке на компьютере и загружаем;
- настройки: тема и папка медиа.

### Формат Excel

- первая колонка — имя события;
- последняя — External id;
- средние — переменные шаблона;
- колонка(и) Media — имена файлов (не бинарники в ячейках).

Если в Excel указан файл, которого нет ни в Carrot, ни в папке медиа —
импорт прерывается.

---

## Структура

```
rest-client/
  web-server.js     — локальный HTTP + прокси /api/*
  carrot-client.js  — REST/WS клиент Carrot (для прокси)
  web.cmd           — запуск на Windows
  web/
    index.html
    app.css
    app.js
    vendor/xlsx.full.min.js   — SheetJS для Excel
  .env.example
```

---

## API прокси (локально)

| Метод | Путь | Назначение |
| ----- | ---- | ---------- |
| GET | `/api/health` | живость сервера UI |
| POST | `/api/connect` | проверка логина / JWT |
| GET | `/api/playlists` | плейлисты |
| GET | `/api/events` | все события |
| GET | `/api/templates` | шаблоны |
| GET | `/api/media` | медиатека |
| POST | `/api/media/upload` | загрузка файла (TUS) |
| POST | `/api/events/create` | создать событие |
| POST | `/api/events/delete` | удалить событие |
