#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Flask-прокси к Carrot Broadcast REST/WS + раздача HTML UI.

Замена Node web-server.js. Браузер ходит только сюда (CORS/JWT),
а сервер использует carrot_client.CarrotClient.
"""

from __future__ import annotations

import logging
import os
import traceback
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from carrot_client import CarrotClient, CarrotError
from carrot_client.excel_import import (
    read_excel_rows,
    resolve_media_in_drafts,
    rows_to_event_drafts,
)

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "web" / "static"

# .env рядом с app.py или в cwd
load_dotenv(ROOT / ".env")
load_dotenv()

HOST = os.environ.get("CARROT_WEB_HOST", "127.0.0.1")
PORT = int(os.environ.get("CARROT_WEB_PORT", "3456"))

app = Flask(
    __name__,
    static_folder=str(STATIC_DIR),
    static_url_path="",
)
app.config["JSON_AS_ASCII"] = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("carrot-flask")

_client: Optional[CarrotClient] = None
_client_key: str = ""


def env(name: str, default: Optional[str] = None) -> Optional[str]:
    return os.environ[name] if name in os.environ else default


def ensure_client(creds: Optional[dict[str, Any]] = None) -> CarrotClient:
    """Вернуть (или создать) singleton CarrotClient по кредам/env."""
    global _client, _client_key
    creds = creds or {}
    base_url = creds.get("baseUrl") or creds.get("base_url") or env("CARROT_BASE_URL")
    login = creds.get("login") or env("CARROT_LOGIN")
    password = creds.get("password") or env("CARROT_PASSWORD")
    if not base_url:
        raise ValueError("Нужен CARROT_BASE_URL или baseUrl в форме")
    if not login or not password:
        raise ValueError("Нужны login/password (из .env или формы)")

    ws_url = creds.get("wsUrl") or creds.get("ws_url") or env("CARROT_WS_URL")
    ws_file_url = (
        creds.get("wsFileUrl") or creds.get("ws_file_url") or env("CARROT_WS_FILE_URL")
    )
    key = f"{base_url}\0{login}\0{password}\0{ws_url or ''}\0{ws_file_url or ''}"
    if _client is None or _client_key != key:
        _client = CarrotClient(
            {
                "baseUrl": base_url,
                "login": login,
                "password": password,
                "wsUrl": ws_url,
                "wsFileUrl": ws_file_url,
                "senderId": env("CARROT_SENDER_ID", "ticker-web"),
                "receiverId": env("CARROT_RECEIVER_ID", "carrot-server"),
            }
        )
        _client_key = key
    return _client


def err_payload(err: BaseException) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": False,
        "error": str(err) if err else "unknown",
    }
    if isinstance(err, CarrotError):
        payload["errorCode"] = err.error_code
        payload["httpStatus"] = err.http_status
    return payload


@app.errorhandler(Exception)
def on_error(err: Exception):  # type: ignore[no-untyped-def]
    log.error("API error: %s\n%s", err, traceback.format_exc())
    status = 500
    if isinstance(err, CarrotError) and err.http_status and 400 <= err.http_status < 600:
        status = err.http_status
    elif isinstance(err, ValueError):
        status = 400
    return jsonify(err_payload(err)), status


# ---------------------------------------------------------------------------
# Static UI
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


# ---------------------------------------------------------------------------
# API (совместимо с rest-client/web-server.js)
# ---------------------------------------------------------------------------

@app.get("/api/health")
def api_health():
    return jsonify(
        {
            "ok": True,
            "hasEnv": bool(
                env("CARROT_BASE_URL") and env("CARROT_LOGIN") and env("CARROT_PASSWORD")
            ),
            "defaults": {
                "baseUrl": env("CARROT_BASE_URL", "") or "",
                "login": env("CARROT_LOGIN", "") or "",
            },
            "backend": "flask",
        }
    )


@app.post("/api/connect")
def api_connect():
    body = request.get_json(silent=True) or {}
    client = ensure_client(body)
    client.authenticate()
    return jsonify(
        {
            "ok": True,
            "baseUrl": client.base_url,
            "login": body.get("login") or env("CARROT_LOGIN", "") or "",
        }
    )


@app.get("/api/playlists")
def api_playlists():
    client = ensure_client()
    return jsonify({"ok": True, "playlists": client.list_playlists() or []})


@app.get("/api/playlists/<playlist_id>/events")
def api_playlist_events(playlist_id: str):
    client = ensure_client()
    rows = client.list_playlist_events(playlist_id)
    return jsonify({"ok": True, "events": rows})


@app.get("/api/events")
def api_events():
    import time

    client = ensure_client()
    force = request.args.get("force") == "1"
    rows = client.list_all_events({"force": force})
    now_ms = time.time() * 1000
    cached = (
        not force
        and client._all_events_cache is not None
        and (now_ms - client._all_events_cache_at) < client._all_events_cache_ttl_ms
    )
    return jsonify({"ok": True, "events": rows, "cached": cached})


@app.get("/api/media")
def api_media():
    client = ensure_client()
    assets = client.list_media_assets({"deep": True}) or []
    log.info("[media] загружено активов: %s", len(assets))
    return jsonify({"ok": True, "media": assets})


@app.post("/api/media/upload")
def api_media_upload():
    """
    Загрузка файла в медиабиблиотеку Carrot (TUS 1.0.0 по REST Guide V.3).

    multipart/form-data:
      file — обязательный файл
      folderId — необязательный GUID папки (по умолчанию корневая медиабиблиотека)
    """
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "error": "Нужен файл в поле file"}), 400

    folder_id = (
        request.form.get("folderId")
        or request.form.get("folder_id")
        or request.args.get("folderId")
        or ""
    )
    raw = upload.read()
    if not raw:
        return jsonify({"ok": False, "error": "Пустой файл"}), 400

    client = ensure_client()
    asset = client.upload_asset(raw, upload.filename, folder_id or None)
    media_value = f"{asset['id']};{asset.get('name') or upload.filename}"
    log.info(
        "[media] загружен ассет %s (%s байт) → %s",
        asset.get("name"),
        len(raw),
        asset.get("id"),
    )
    return jsonify({"ok": True, "asset": asset, "mediaValue": media_value})


@app.get("/api/templates")
def api_templates():
    client = ensure_client()
    templates = client.list_normalized_templates()
    return jsonify(
        {
            "ok": True,
            "templates": [
                {
                    "id": t.get("id"),
                    "name": t.get("name"),
                    "contentId": t.get("contentId"),
                    "templateTypeInt": t.get("templateTypeInt"),
                    "defaultInState": t.get("defaultInState"),
                    "states": t.get("states"),
                    "variableCount": len(t.get("variables") or []),
                }
                for t in templates
            ],
        }
    )


@app.get("/api/templates/<template_id>")
def api_template_detail(template_id: str):
    client = ensure_client()
    template = client.get_normalized_template(template_id)
    return jsonify({"ok": True, "template": template})


@app.post("/api/events/create")
def api_events_create():
    body = request.get_json(silent=True) or {}
    events = body.get("events") if isinstance(body, dict) else None
    if events is None and isinstance(body, list):
        events = body
    if not events:
        return jsonify(
            {
                "ok": False,
                "error": "Нужен массив events: [{ name, templateId, variables? }, ...]",
            }
        ), 400
    client = ensure_client()
    result = client.create_events(events)
    return jsonify({"ok": True, "created": result.get("created") or []})


@app.post("/api/settings/check-media-folder")
def api_check_media_folder():
    """Проверить, что локальная папка медиа существует и доступна."""
    body = request.get_json(silent=True) or {}
    folder = (
        (body.get("path") if isinstance(body, dict) else None)
        or request.args.get("path")
        or ""
    )
    folder = str(folder).strip()
    if not folder:
        return jsonify({"ok": False, "error": "Нужен path"}), 400
    from pathlib import Path

    root = Path(folder).expanduser()
    if not root.exists():
        return jsonify({"ok": False, "error": f"Путь не существует: {folder}"}), 400
    if not root.is_dir():
        return jsonify({"ok": False, "error": f"Это не папка: {folder}"}), 400
    sample = sorted(
        p.name for p in root.iterdir() if p.is_file()
    )[:8]
    return jsonify(
        {
            "ok": True,
            "path": str(root.resolve()),
            "fileCountHint": len(sample),
            "sample": sample,
        }
    )


@app.post("/api/events/import-excel")
def api_events_import_excel():
    """
    Создать ивенты из Excel по выбранному шаблону.

    multipart/form-data:
      file — .xlsx/.xlsm
      templateId — GUID шаблона
      mediaFolder — опц. локальная папка для Media-файлов из Excel
      hasHeader — optional 0/1 (авто: если 1-я ячейка похожа на «имя»/name)

    Столбцы: 1 = имя, последний = External id, между ними = переменные
    шаблона в порядке template.variables. Для Media — имя файла.
    """
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"ok": False, "error": "Нужен Excel-файл в поле file"}), 400

    template_id = (
        request.form.get("templateId")
        or request.form.get("template_id")
        or request.args.get("templateId")
        or ""
    ).strip()
    if not template_id:
        return jsonify({"ok": False, "error": "Нужен templateId"}), 400

    media_folder = (
        request.form.get("mediaFolder")
        or request.form.get("media_folder")
        or ""
    ).strip() or None

    has_header_raw = (
        request.form.get("hasHeader")
        or request.form.get("has_header")
        or request.args.get("hasHeader")
    )
    has_header: Optional[bool]
    if has_header_raw is None or str(has_header_raw).strip() == "":
        has_header = None
    else:
        has_header = str(has_header_raw).strip().lower() in (
            "1",
            "true",
            "yes",
            "y",
            "on",
        )

    raw = upload.read()
    try:
        rows = read_excel_rows(raw)
    except ValueError as err:
        return jsonify({"ok": False, "error": str(err)}), 400

    client = ensure_client()
    template = client.get_normalized_template(template_id)
    parsed = rows_to_event_drafts(rows, template, has_header=has_header)
    drafts = parsed["drafts"]
    if not drafts:
        return jsonify(
            {
                "ok": False,
                "error": "Нет строк для создания",
                "skipped": parsed["skipped"],
                "headerSkipped": parsed["headerSkipped"],
                "variableNames": parsed["variableNames"],
            }
        ), 400

    media_report: dict[str, Any] = {
        "resolved": 0,
        "uploaded": 0,
        "reused": 0,
        "warnings": [],
    }
    if parsed.get("mediaVarIndexes"):
        try:
            assets = client.list_media_assets({"deep": True}) or []
        except Exception as err:  # noqa: BLE001
            log.warning("[excel] список медиа недоступен: %s", err)
            assets = []

        def _upload(file_bytes: bytes, filename: str) -> dict[str, Any]:
            return client.upload_asset(file_bytes, filename)

        media_report = resolve_media_in_drafts(
            drafts,
            assets=assets,
            media_folder=media_folder,
            upload_file=_upload,
        )
        missing = media_report.get("missing") or []
        if missing:
            # Без найденных медиа импорт не выполняем — ивенты не создаём.
            names = sorted(
                {
                    str(m.get("file") or "").strip()
                    for m in missing
                    if str(m.get("file") or "").strip()
                }
            )
            preview = ", ".join(names[:5])
            more = f" и ещё {len(names) - 5}" if len(names) > 5 else ""
            log.warning(
                "[excel] импорт отменён: не найдено медиа=%s (%s%s)",
                len(missing),
                preview,
                more,
            )
            return jsonify(
                {
                    "ok": False,
                    "error": (
                        "Импорт отменён: не найдены медиафайлы"
                        + (f" ({preview}{more})" if preview else "")
                        + ". Проверь имена в Excel, медиа в Carrot "
                        "или папку в Настройках."
                    ),
                    "created": [],
                    "skipped": parsed["skipped"],
                    "headerSkipped": parsed["headerSkipped"],
                    "variableNames": parsed["variableNames"],
                    "templateId": template_id,
                    "templateName": template.get("name") or "",
                    "media": media_report,
                }
            ), 400

    # служебное поле _excelRow не уходит в Carrot
    events = []
    for d in drafts:
        ev = {k: v for k, v in d.items() if not k.startswith("_")}
        events.append(ev)

    result = client.create_events(events)
    created = result.get("created") or []
    log.info(
        "[excel] шаблон %s: строк=%s создано=%s media upload=%s reuse=%s",
        template.get("name") or template_id,
        len(drafts),
        len(created),
        media_report.get("uploaded"),
        media_report.get("reused"),
    )
    return jsonify(
        {
            "ok": True,
            "created": created,
            "skipped": parsed["skipped"],
            "headerSkipped": parsed["headerSkipped"],
            "variableNames": parsed["variableNames"],
            "templateId": template_id,
            "templateName": template.get("name") or "",
            "media": media_report,
        }
    )


@app.post("/api/events/delete")
def api_events_delete():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") if isinstance(body, dict) else None
    if not ids:
        return jsonify({"ok": False, "error": "Нужен массив ids"}), 400
    client = ensure_client()
    deleted: list[str] = []
    failed: list[dict[str, str]] = []
    for event_id in ids:
        try:
            client.delete_event(event_id)
            deleted.append(event_id)
        except Exception as err:  # noqa: BLE001
            failed.append({"id": event_id, "error": str(err)})
    return jsonify({"ok": True, "deleted": deleted, "failed": failed})


@app.patch("/api/events/<event_id>/variables")
def api_event_variables(event_id: str):
    body = request.get_json(silent=True)
    if isinstance(body, list):
        vars_list = body
    elif isinstance(body, dict) and isinstance(body.get("variables"), list):
        vars_list = body["variables"]
    else:
        return jsonify(
            {
                "ok": False,
                "error": "Нужен массив [{name, value}, ...] или { variables: [...] }",
            }
        ), 400
    client = ensure_client()
    client.edit_variables(event_id, vars_list)
    return jsonify({"ok": True, "eventId": event_id})


@app.get("/api/events/<event_id>")
def api_event_get(event_id: str):
    client = ensure_client()
    event = client.get_event(event_id)
    return jsonify({"ok": True, "event": event})


@app.delete("/api/events/<event_id>")
def api_event_delete(event_id: str):
    client = ensure_client()
    client.delete_event(event_id)
    return jsonify({"ok": True, "deleted": event_id})


def _host_port(port: int) -> str:
    base = env("CARROT_BASE_URL") or ""
    try:
        from urllib.parse import urlparse

        host = urlparse(base).hostname or "хост"
        return f"{host}:{port}"
    except Exception:
        return f"хост:{port}"


def main() -> None:
    ws_hint = env("CARROT_WS_URL") or (
        f"(по умолчанию ws://{_host_port(24710)})" if env("CARROT_BASE_URL") else "(не задан)"
    )
    ws_file_hint = env("CARROT_WS_FILE_URL") or (
        f"(по умолчанию ws://{_host_port(24712)})" if env("CARROT_BASE_URL") else "(не задан)"
    )
    print(f"Carrot playlist browser (Flask): http://{HOST}:{PORT}")
    print(
        f"Конфиг: CARROT_BASE_URL={env('CARROT_BASE_URL') or '(не задан)'}, "
        f"login={env('CARROT_LOGIN') or '(не задан)'}"
    )
    print(f"Удаление/создание событий: REST + WebSocket {ws_hint}")
    print(f"Медиа: REST /assets/folder/{{id}}, fallback WS {ws_file_hint}")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
