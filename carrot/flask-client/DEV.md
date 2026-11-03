# DEV-сборка: панель трафика

Ветка `cursor/flask-dev-traffic-panel-f83d`.

## Как пользоваться

```bat
cd carrot\flask-client
web.cmd
```

- Кнопка **DEV** справа внизу открывает панель.
- Или `http://127.0.0.1:3456/?dev=1`
- В панели: **UI** (браузер → Flask `/api/*`) и **Carrot** (Flask → REST Carrot).
- Клик по строке — полный JSON запроса/ответа (тела обрезаются).
- Для больших TUS-загрузок логируются create, первый/последний PATCH и summary, затем `register`.

Эндпоинты: `GET /api/dev/traffic`, `POST /api/dev/traffic/clear`.

---

## Расследование: HTTP 500 на `/assets/register/{fileId}`

**Симптом:** при больших файлах UI показывает ошибку вида:

```text
HTTP 500 … POST …/assets/register/{fileId}
{"errorCode":2,"description":"File not found in temporary storage."}
```

При этом файл **потом виден** в медиабиблиотеке.

**Ничего не чинили** — только гипотезы + панель, чтобы снять точный обмен.

### Что делает клиент сейчас (без изменений логики)

1. `POST /assets/upload` (TUS create) → `fileId` из `Location`
2. цикл `PATCH /assets/upload/{fileId}` чанками по 1 MiB
3. `POST /assets/register/{fileId}` с телом JSON-строкой GUID папки  
   (`"5535E4A7-…"` — корневая медиатека)

Ошибка приходит на шаге 3: Carrot отвечает HTTP 500 и `errorCode: 2`  
(`FileUploadingError` / «нет файла во временном хранилище»).

### Гипотезы (по убыванию правдоподобия)

1. **Гонка / незавершённый flush после последнего PATCH**  
   Клиент сразу зовёт `register`, а temp-файл на сервере ещё не «закрыт».  
   Для больших объёмов чаще. Файл потом всё же доезжает/подхватывается — отсюда «ошибка, но файл есть».

2. **Temp TTL / GC во время длинной загрузки**  
   Create был давно, PATCH шёл долго; к `register` temp уже убран или перенесён.  
   Если ассет всё же появляется — возможна серверная догонка или повторная загрузка того же имени.

3. **Несовпадение «полной» длины с `Upload-Length`**  
   Если `Upload-Offset` с сервера интерпретируется так, что цикл PATCH заканчивается раньше полной записи, `register` не находит готовый blob. Стоит сверить в панели: последний PATCH offset vs размер файла.

4. **Формат тела `register` / папка**  
   Сейчас тело — JSON-string GUID. Если Guide V.3 ждёт объект (`{ "folderId": "…" }` / иное) или `Guid.Empty`, сервер может отвечать странно. Нужна сверка с PDF V.3 (файл ещё не приложен в cloud).

5. **Повторный `register` того же `fileId`**  
   Первый вызов на сервере уже «забрал» temp в Asset, ответ клиенту потерялся/обошёл как 500; второй — «File not found in temporary storage», а ассет уже есть. В текущем коде HTTP 500 **не ретраится** в `_request` (ретраи только сетевые) — но возможен ручной повтор из UI.

6. **Таймаут Flask/прокси на длинном upload**  
   Менее похоже: у тебя есть **тело ответа Carrot** на `register`, значит HTTP дошёл. Но UI мог параллельно оборвать ожидание `/api/media/upload`.

### Что снять панелью при следующем большом файле

1. Открыть DEV → фильтр **Carrot**.
2. Загрузить большой файл.
3. Найти цепочку: `TUS create` → PATCH #0 → `TUS patch (last)` → `TUS patch summary` → `POST …/assets/register/…`.
4. Сохранить/прислать:
   - `Upload-Length` и `totalBytes`
   - `Upload-Offset` последнего PATCH
   - точное тело и статус `register`
   - был ли ещё один `register` с тем же `fileId`

### PDF Guide V.3

Путь `c:\Users\Megazanuda\Downloads\Telegram Desktop\Carrot-REST-API-Guide V.3 (2).pdf`  
из cloud VM **недоступен**. Нужно прикрепить PDF в чат — тогда сверим § про Assets / TUS / register.
