# Архитектура Carrot Flask Client

Документ описывает проект **до уровня отдельных функций**: зачем каждая нужна,
что принимает, что возвращает, какие побочные эффекты и с кем взаимодействует.

---

## 1. Общая схема

```
Браузер (web/static)
    │  HTTP JSON /api/*
    ▼
Flask app.py  ──────────►  раздача index.html / app.js / app.css
    │
    ▼
carrot_client.CarrotClient
    ├── REST (requests)  →  Carrot REST :5001  (JWT + envelope)
    ├── WS 24710         →  Create/Remove Event
    └── WS 24712         →  MediaAssetLibrary
```

Браузер **никогда** не ходит на Carrot напрямую (CORS, JWT, XML WebSocket).  
Все доменные операции идут через Flask → `CarrotClient`.

### Поток типичного сеанса

1. `GET /api/health` — есть ли `.env`, подсказки для формы.
2. `POST /api/connect` — создать клиент, `authenticate()`, JWT в памяти процесса.
3. UI грузит плейлисты / события / шаблоны / медиа через `/api/*`.
4. Создание/удаление: REST попытка → при 404/405 → WebSocket 24710.
5. Медиа: REST `/assets/folder/{id}` (BFS) → при пустоте WS 24712.

---

## 2. Каталог файлов

| Путь | Роль |
|------|------|
| `app.py` | Точка входа Flask: маршруты `/api/*`, статика, singleton-клиент |
| `carrot_client/__init__.py` | Публичный API пакета |
| `carrot_client/errors.py` | `CarrotError`, таблица `ERROR_NAMES` |
| `carrot_client/util.py` | URL/XML-хелперы, GUID корня медиа |
| `carrot_client/ws.py` | Синхронные WebSocket-сессии 24710/24712 |
| `carrot_client/client.py` | Основной `CarrotClient` (REST + вызовы WS) |
| `web/static/index.html` | Разметка UI |
| `web/static/app.js` | Логика UI (состояние, таблица, редактор, создание) |
| `web/static/app.css` | Стили |
| `.env.example` | Шаблон переменных окружения |
| `requirements.txt` | pip-зависимости |
| `web.cmd` / `web.sh` | Запуск на Windows / Unix |

---

## 3. Пакет `carrot_client`

### 3.1. `errors.py`

#### `ERROR_NAMES: dict[int, str]`
Карта кодов Carrot (`errorCode` в `data`) → человекочитаемое имя.  
Ключевые: `42 AlreadyExists`, `44 NotFound`, `46 InvalidValue`.

#### `class CarrotError(Exception)`
Доменная/транспортная ошибка.

| Поле | Смысл |
|------|--------|
| `args[0]` / `str(err)` | Текст для UI/лога |
| `http_status` | HTTP-код, если ошибка с REST |
| `error_code` | Carrot `errorCode` |
| `description` | Сырое описание сервера |
| `url` | URL запроса / WS |
| `code` | Код сетевой ошибки (`ECONNREFUSED` и т.п.) |

---

### 3.2. `util.py`

#### Константы
- `MEDIA_ROOT_FOLDER_ID` — типичный GUID корня медиабиблиотеки.
- `MEDIA_EMPTY_FOLDER_ID` — `Guid.Empty`, запасной корень.
- `MEDIA_MAX_FOLDERS` — лимит BFS (250), защита от бесконечного обхода.

#### `normalize_base_url(url) → str`
Убирает хвостовые `/`, заменяет `localhost` на `127.0.0.1` (на Windows Node/Python
часто идут в IPv6 `::1`, а Carrot слушает IPv4).

#### `decode_carrot_text(s) → str`
Carrot кодирует символы как `_x0020_` (пробел) и т.п. Функция восстанавливает Unicode.

#### `xml_escape(s) → str`
Экранирование `& < > " '` для вставки в XML-команды WS.

#### `xml_field(block, name) → str|None`
Ищет значение в XML-фрагменте: сначала дочерний тег `<Name>…</Name>`,  
затем атрибут `Name="…"`. Нужно, потому что Carrot отвечает в обоих стилях.

#### `default_ws_url_from_base(base_url, port) → str|None`
Из `http://host:5001` строит `ws://host:24710` (или `wss` при https).

---

### 3.3. `ws.py` — WebSocket

Используется библиотека `websocket-client` (синхронный `WebSocketApp` + `threading.Event`).

#### `variable_to_xml(v) → str`
Сериализует одну переменную события в self-closing `<Variable … />`  
с атрибутами Id, Name, Type, Value, FieldId, ResetMedia, UseTimecode, Loop, Locked,  
DefaultValue, MinValue, MaxValue, UseDataVars.

#### `event_create_to_xml(event, message_id) → str`
Полная команда `Playlists/CreateEventInDB`.  
Если `externalId` пустой — подставляется `event["id"]` (иначе Carrot часто отвечает AlreadyExists).

#### `class _WsSession`
Внутренняя обёртка одной WS-сессии.

| Метод | Назначение |
|-------|------------|
| `next_id()` | Инкремент MessageId |
| `send(xml)` | Отправить текст на сокет |
| `finish_ok(value)` / `finish_err(err)` | Завершить сессию, выставить Event |
| `wait_result()` | Блокироваться до результата или таймаута |
| `run(on_message)` | Поднять WebSocketApp, крутить run_forever до done |

Обработка HeartBeat (сервер шлёт без MessageId):
```xml
<Command CmdGroup="HeartBeat" MessageId="-1">
  <SessionId>{uuid}</SessionId>
</Command>
```

#### `delete_event_via_ws(ws_url, login, password, event_id, timeout_ms) → dict`
Порт **24710**. Стадии:

1. `wait-client-id` — ждём `CmdGroup="ClientID"`.
2. Шлём HandShake (`AppName=ticker-web`) + `Users/LoginUnsecure`.
3. На `LoginOk` — `Playlists/RemoveEventFromDB` с `<EventId>`.
4. Успех: `EventRemovedFromDB` → `{deleted, via: "websocket"}`.

#### `create_events_via_ws(ws_url, login, password, events, timeout_ms) → list`
Порт **24710**. После LoginOk по очереди шлёт `CreateEventInDB` для каждого события.  
Успех на каждое: `EventAdded`. Ошибка `already exists` → `CarrotError` с `error_code=42`.

#### `list_media_via_ws(ws_url, folder_id, deep, timeout_ms) → list`
Порт **24712**. **Без** LoginUnsecure (на файловом канале даёт Unknown Command Group).

1. ClientID → HandShake → ждём любой ответ (handshake).
2. BFS `GetAssetFolder` по seed: preferred root, Guid.Empty, MEDIA_ROOT.
3. Парсит `<Folder>` / `<Asset>` (теги и атрибуты).
4. Soft-fail «not found» по папке — идём к следующей.

#### `run_playlist_session(...)`
Низкоуровневый вход «подключись к 24710, залогинься, отдай управление callback».  
Используется как строительный блок; UI-пути обычно вызывают `delete_*` / `create_*` напрямую.

---

### 3.4. `client.py` — `CarrotClient`

#### Конструктор `__init__(opts|**kwargs)`
Параметры (camelCase или snake_case):

| Ключ | По умолчанию | Смысл |
|------|--------------|--------|
| `baseUrl` | обязателен | REST base |
| `login` / `password` | — | JWT |
| `wsUrl` | из base + 24710 | команды |
| `wsFileUrl` | из base + 24712 | медиа |
| `senderId` / `receiverId` | ticker-client / carrot-server | envelope |
| `timeoutMs` | 10000 | HTTP timeout |
| `maxRetries` | 3 | сетевые ретраи |
| `allEventsCacheTtlMs` | 120000 | кэш «Все события» |

Держит `requests.Session`, JWT в памяти, кэш имён шаблонов и списка всех событий.

#### Внутренние методы транспорта

##### `_next_message_id() → int`
Монотонный счётчик для envelope `MessageId`.

##### `_envelope_query() → str`
`?MessageId=&Time=ISO&SenderId=&ReceiverId=` — **обязателен** на каждом REST-запросе Carrot.

##### `_ensure_token()`
Если токена нет или он старше ~55 мин — вызывает `authenticate()`.

##### `_request(method, path, body=None, *, auth=True) → data`
1. При необходимости обновляет JWT.
2. Собирает URL = `base_url + path + envelope`.
3. `Authorization: Bearer …` если auth.
4. Ретраи на сетевых сбоях (экспоненциальная пауза).
5. На HTTP 401 — один повтор после переавторизации.
6. Парсит JSON; берёт `json["data"]`.
7. Если `data.errorCode != 0` — `CarrotError`.
8. Не-JSON / HTML → понятная ошибка («это не REST, а веб-плейлист»).

##### `_try_once(method, path, body) → {ok, data|error, httpStatus}`
Один запрос без ретраев — для перебора альтернативных REST-путей удаления/медиа.

##### `_authenticate_once() → token`
`POST /auth/generate` с `{login, password, notificationsEnabled}`.

##### `authenticate() → token`
Вызывает `_authenticate_once`. При 404 пробует переключить baseUrl с/без суффикса `/api`  
(разные инсталляции Carrot по-разному монтируют swagger).

##### `refresh() → token|None`
`PUT /auth/refresh` — продлить JWT.

---

#### События

##### `list_events() → list`
`GET /events` — заголовки `{id, name, changed, externalId, …}`.

##### `get_event(event_id) → dict`
`GET /events/{id}` — полная структура с `variables`.

##### `edit_variables(event_id, vars_list) → data`
`PATCH /events/{id}/editVariables` телом `[{name, value}, …]`.

##### `delete_event(event_id) → data`
1. Перебор REST-путей remove/delete (см. код: removeFromDB, DELETE и т.д.).
2. Если все 404/405 — `delete_event_via_websocket`.
3. Инвалидирует кэш всех событий.

##### `delete_event_via_websocket(event_id) → dict`
Обёртка над `ws.delete_event_via_ws`.

##### `find_event_id_by_name(name) → str|None`
Линейный поиск по `list_events()` (для CLI/ticker; UI обычно работает с GUID).

##### `create_events(entries) → {created: [...]}`
Для каждой записи:
1. Валидация name + templateId.
2. При необходимости догружает шаблон (`get_normalized_template`) — contentId, type, variables, state.
3. Генерирует `id` (UUID); пустой externalId → id.
4. Пробует `POST /events`.
5. Неудачные — пакетом в `create_events_via_websocket`.
6. **Нет** проверки уникальности имени или ExternalId (разрешены дубликаты).

##### `create_events_via_websocket(events) → list`
Обёртка над `ws.create_events_via_ws`.

##### `_unwrap_event(raw) → event`
Иногда API отдаёт `{event, template}` — склеивает в плоский event с templateName/Id.

##### `_resolve_template_names(template_ids, seed) → dict`
Параллельно (пул) догружает имена шаблонов, кэширует в `_template_name_cache`.

##### `list_playlist_events(playlist_id) → [{event, item, story}]`
1. `get_playlist` → stories/scenarios.
2. Для каждой story — items (иногда через `get_story`).
3. По `item.eventId` — `get_event` (с обработкой ошибок).
4. Дописывает `templateName`.
Уникальность по `event.id`.

##### `list_all_events({force?}) → [{event, item, story}]`
1. Кэш 120 с, если не `force`.
2. `list_events()` заголовки — **без** N×GET деталей (быстрый путь).
3. Имена шаблонов из `list_templates` / точечных GET.
4. Формат строк совместим с плейлистным списком (UI один рендерер).

##### `invalidate_events_cache()`
Сброс кэша после create/delete.

---

#### Шаблоны

##### `get_template` / `list_templates`
Сырые REST `GET /templates`, `GET /templates/{id}`.

##### `normalize_template(raw) → dict|None`
Приводит PascalCase/camelCase к единому виду:

```
id, name, contentId, templateTypeInt, defaultInState, closingState,
states, variables[{id,name,type,value,defaultValue,fieldId,resetMedia,…}], raw
```

Переменные берутся из `linkVars` / `LinkVars` / `variables` / `Variables`.

##### `get_normalized_template(id)` / `list_normalized_templates()`
Fetch + normalize; список сортируется по имени (casefold).

##### `_flatten_templates(raw)`
Разворачивает дерево групп шаблонов в плоский список.

---

#### Медиа

##### `list_media_assets({folderId?, deep?}) → [{id,name,assetTypeInt,parentId}]`
1. `list_media_assets_via_rest_folder` (swagger `GET /assets/folder/{id}`, BFS).
2. Если пусто — эвристики `/media`, `/assets`, …
3. Если пусто — WS 24712.
4. Если всё пусто — `CarrotError` с диагностикой.

##### `upload_asset(file_bytes, filename, folder_id=None) → Asset`
Загрузка по **Carrot REST API Guide V.3 §6** (протокол **TUS 1.0.0**):

1. `POST /assets/upload` — пустое тело; заголовки  
   `Tus-Resumable: 1.0.0`, `Upload-Length`, `Upload-Metadata: filename <base64(name)>`.  
   Из `Location` берётся `fileId`.
2. `PATCH /assets/upload/{fileId}` — чанки `application/offset+octet-stream`  
   с `Upload-Offset` (докачка после разрыва через `HEAD`).
3. `POST /assets/register/{fileId}` — тело JSON-строка GUID папки  
   (по умолчанию корневая `5535E4A7-…`). Ответ — `Asset`.  
   Одноимённый ассет в папке **перезаписывается** (id сохраняется).

Значение медиа-переменной: `{AssetId};{AssetName}`.

##### `list_media_assets_via_rest_folder` → `{assets, foldersOk, lastErr, scanned}`
Очередь папок: preferred, Empty, MEDIA_ROOT.  
Парсинг через `_parse_media_folder_payload`.

##### `_parse_media_folder_payload(raw) → {assets, folderIds}`
Рекурсивный обход JSON: отличает Asset (есть AssetTypeInt / type=asset) от Folder.

##### `list_media_assets_via_websocket`
Обёртка над `ws.list_media_via_ws`.

---

#### Плейлист / эфир (для CLI-совместимости)

| Метод | REST |
|-------|------|
| `list_playlists` | `GET /playlists` |
| `get_playlist` | `GET /playlists/{id}` |
| `get_story` | `GET /stories/{id}` |
| `get_item` | `GET /items/{id}` |
| `load_item` | `POST /items/{id}/load` |
| `take_in_item` | `POST …/takeIn` |
| `take_out_item` | `POST …/takeOut` |
| `unload_item` | `POST …/unload` |

У каждого публичного метода есть camelCase-алиас (`listEvents` = `list_events`)  
для паритета с JS.

---

## 4. Flask `app.py`

### Глобальное состояние
- `_client` / `_client_key` — один экземпляр `CarrotClient` на набор кредов.  
  Смена login/password/URL в форме пересоздаёт клиент.

### `env(name, default)`
Чтение `os.environ` после `load_dotenv(.env)`.

### `ensure_client(creds?) → CarrotClient`
Собирает baseUrl/login/password/ws из body формы или `.env`.  
`senderId` по умолчанию `ticker-web` (как у Node web-server).

### `err_payload(err) → dict`
Единый JSON ошибок: `{ok:false, error, errorCode?, httpStatus?}`.

### `@app.errorhandler(Exception)`
Любое необработанное → JSON + HTTP 400/5xx.

### Статика
- `GET /` → `index.html`
- Flask `static_url_path=""` отдаёт `/app.js`, `/app.css` из `web/static/`.

### API-маршруты (контракт совместим с Node UI)

| Метод | Путь | Функция | Клиент |
|-------|------|---------|--------|
| GET | `/api/health` | `api_health` | — |
| POST | `/api/connect` | `api_connect` | `authenticate` |
| GET | `/api/playlists` | `api_playlists` | `list_playlists` |
| GET | `/api/playlists/<id>/events` | `api_playlist_events` | `list_playlist_events` |
| GET | `/api/events?force=1` | `api_events` | `list_all_events` |
| GET | `/api/media` | `api_media` | `list_media_assets` |
| POST | `/api/media/upload` | `api_media_upload` | `upload_asset` (multipart `file`, опц. `folderId`) |
| GET | `/api/templates` | `api_templates` | `list_normalized_templates` (урезанный DTO) |
| GET | `/api/templates/<id>` | `api_template_detail` | `get_normalized_template` |
| POST | `/api/events/create` | `api_events_create` | `create_events` |
| POST | `/api/events/delete` | `api_events_delete` | `delete_event` по списку ids |
| PATCH | `/api/events/<id>/variables` | `api_event_variables` | `edit_variables` |
| GET | `/api/events/<id>` | `api_event_get` | `get_event` |
| DELETE | `/api/events/<id>` | `api_event_delete` | `delete_event` |

### `main()`
Печатает подсказки по портам и запускает `app.run(threaded=True)` на `CARROT_WEB_HOST:PORT`.

---

## 5. Фронтенд `web/static`

Контракт с бэкендом — тот же, что у Node: пути `/api/*`, поля `ok` / `error`.

### `index.html`
Каркас: вкладки разделов, форма подключения, workspace  
(рейка источников + side-pane + таблица + редактор + секция создания), toast, dialog удаления.

### `app.css`
CSS-переменные темы, layout grid (рейка / сайдбар / таблица), таблица, редактор, create-cards.

### `app.js` — модули (логически)

#### Состояние `state`
connected, section, playlists, sideOpen, view (`all`|playlist), rows, selection,  
hiddenColumns, eventDetails, templates, mediaAssets, createForms, …

#### Persistence (localStorage)
- скрытые колонки
- свёрнут ли редактор пользователем
- открыт ли side-pane

#### Сеть
- `api(method, path, body)` — fetch JSON, бросает Error при `ok:false`.

#### Подключение
- boot: health → автоconnect при hasEnv, иначе форма;
- `connect()` → workspace, loadPlaylists, selectAllEvents.

#### События
- `selectAllEvents` / `selectPlaylist` / `reload`;
- recent (2 недели) vs all;
- render table, sort, filter, multi-select, delete batch;
- side-rail toggle ›/‹.

#### Редактор переменных
- `loadEventDetail` → `buildVarEditor`;
- Media: `fillMediaSelect` / `normalizeMediaValue` → значение **`id;имя`**;
- Save → PATCH variables (полный набор пар name/value).

#### Создание
- карточки форм, выбор шаблона → `GET /api/templates/:id`;
- **нет** авто-нумерации External ID;
- **нет** авто-подстановки имени события;
- Submit → `POST /api/events/create`.

#### Медиа-хелперы
- `parseMediaValue` / `encodeMediaValue` / `normalizeMediaValue` / `isMediaType`.

---

## 6. Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `CARROT_BASE_URL` | REST |
| `CARROT_LOGIN` / `CARROT_PASSWORD` | JWT |
| `CARROT_WS_URL` | override WS 24710 |
| `CARROT_WS_FILE_URL` | override WS 24712 |
| `CARROT_SENDER_ID` / `CARROT_RECEIVER_ID` | envelope |
| `CARROT_WEB_HOST` / `CARROT_WEB_PORT` | bind Flask (127.0.0.1:3456) |

---

## 7. Отличия от Node `rest-client`

| Было (Node) | Стало (Flask) |
|-------------|----------------|
| `web-server.js` + `carrot-client.js` | `app.py` + пакет `carrot_client` |
| async fetch/WS | sync `requests` + `websocket-client` |
| `node web-server.js` | `python app.py` / `web.cmd` |
| CLI ticker/stress в том же пакете | CLI остаётся в `rest-client/` (пока) |

Поведение Web UI API **намеренно совместимо** — один и тот же `app.js` может работать
с Node или Flask бэкендом.

---

## 8. Чего сознательно нет в Flask-порте

- Авто-нумерация External ID (`name_001`) — не нужна.
- Авто-подстановка имени события при выборе шаблона — не нужна.
- Node CLI (`ticker`, `stress`, `playout`) — по-прежнему в `carrot/rest-client/`.
