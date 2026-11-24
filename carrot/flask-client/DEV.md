# DEV-сборка: панель трафика

Ветка `cursor/flask-dev-traffic-panel-f83d`.

## Как пользоваться

```bat
cd carrot\flask-client
web.cmd
```

- Кнопка **DEV** справа внизу открывает панель.
- Или `http://127.0.0.1:3456/?dev=1`
- Каналы: **UI** (браузер → Flask) и **Carrot** (Flask → REST).
- TUS: create, первый/последний PATCH, summary, затем `register`.

Эндпоинты: `GET /api/dev/traffic`, `POST /api/dev/traffic/clear`.

---

## Сверка с Carrot-REST-API-Guide V.3 (16.10.2026)

Источник: `Carrot-REST-API-Guide V.3 (2).pdf`.

### База и хвост

| Тема | Guide V.3 | Наш клиент |
|------|-----------|------------|
| Пример базы | `http://<host>:5000/api` (§3, §6) | Часто `:5001` без `/api` (как на старой живой установке) — в Guide прямо сказано, что бывает оба варианта |
| Query §4.1 | Обязательны `Time` + `SenderId`; `MessageId`/`ReceiverId` убраны, но полный хвост из 4 полей совместим | Шлём все 4 — **OK** для старых и новых |
| Ответ | `Message<T>` без `messageId`/`receiverId` | Читаем `data` — **OK** |

### Загрузка ассета (§6) — TUS 1.0.0

Документ:

1. `POST /assets/upload` — пустое тело; `Upload-Length`, `Upload-Metadata: filename <base64>` (обязателен); с 09.07.2026 **нет** `filetype`/`folderId` в metadata.
2. `PATCH /assets/upload/{fileId}` — `Upload-Offset` с 0, `Content-Type: application/offset+octet-stream`; **пока `offset ≠ Upload-Length`**; `HEAD` для докачки.
3. `POST /assets/register/{fileId}` + хвост §4.1; тело — **GUID папки JSON-строкой** (`"5535…"`); пусто → `Guid.Empty` = корень.
4. Ошибки register: **FileUploadingError (2)** (в т.ч. нет metadata filename), **NotFound (44)**.
5. Одноимённый ассет в папке **перезаписывается** (ревизия++, Id тот же).
6. Значение Media: `{AssetId};{AssetName}`.

Наш код по протоколу в целом совпадает (create → PATCH → register со строкой GUID).

### Симптом большого файла vs Guide

Пользователь:

```text
HTTP 500 POST …/assets/register/{fileId}
{"errorCode":2,"description":"File not found in temporary storage."}
```

По §4.3 / §9: при отказе с HTTP 500 код Carrot лежит в **корне** тела (`errorCode`), не только в `data` — это как раз наш случай.  
Код **2** = `FileUploadingError`. В тексте Guide рядом с (2) явно упоминается «нет метаданного filename»; description про **temporary storage** в PDF не расписан отдельно — значит temp blob после TUS к моменту register сервер не видит.

Гипотезы после сверки с V.3 (порядок):

1. **PATCH не довёл `Upload-Offset` до `Upload-Length`** (цикл оборвался / offset с сервера), register зовётся слишком рано → «нет файла во временном». На панели сверить last offset vs Upload-Length.
2. **Гонка/flush** после последнего PATCH на больших файлах.
3. **Temp TTL** на длинной загрузке.
4. **Перезапись одноимённого файла**: если UI/повтор уже успел зарегистрировать, повторный register даёт (2), а в библиотеке файл «как будто загрузился».
5. Мелочь: Guide в блоке TUS пишет «все запросы с … Tus-Resumable»; register у нас идёт через обычный `_request` **без** `Tus-Resumable` — маловероятная причина именно large-only, но стоит проверить на панели/эксперименте.

**Пока поведение upload не меняли** — только лог и эта заметка.

### Порт 5000 vs 5001

В Guide пример — **`:5000/api`**. `5001` — не норма из PDF, а порт конкретной установки. Рабочий Base URL нужно брать с живого swagger/`/auth/generate`.
