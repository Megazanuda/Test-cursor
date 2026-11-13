#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Flask-прокси к Carrot Broadcast REST/WS + раздача HTML UI.

Замена Node web-server.js. Браузер ходит только сюда (CORS/JWT),
а сервер использует carrot_client.CarrotClient.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
import webbrowser
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from carrot_client import (
    CarrotClient,
    CarrotError,
    is_media_type,
    read_excel_rows,
    resolve_media_in_drafts,
    rows_to_event_drafts,
)
import traffic_log

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "web"
ENV_PATH = ROOT / ".env"

# .env рядом с app.py или в cwd
load_dotenv(ENV_PATH)
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
# Последние успешные креды сессии (чтобы смена baseUrl в Настройках
# и последующие /api/* без тела не откатывались к .env).
_session: dict[str, Any] = {}


def env(name: str, default: Optional[str] = None) -> Optional[str]:
    return os.environ[name] if name in os.environ else default


def _pick_cred(creds: dict[str, Any], *keys: str) -> Optional[str]:
    for k in keys:
        v = creds.get(k)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return None


def _env_quote(value: str) -> str:
    """Записать значение в .env; кавычки — если есть пробелы/спецсимволы."""
    if value == "":
        return '""'
    if re.search(r'[\s#\'"\\]', value):
        esc = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{esc}"'
    return value


def update_env_file(
    updates: dict[str, str], path: Optional[Path] = None
) -> Path:
    """Создать/обновить ключи в .env, сохранив остальные строки и комментарии."""
    path = path or ENV_PATH
    keys = {str(k): "" if v is None else str(v) for k, v in updates.items()}
    lines: list[str] = []
    if path.exists():
        raw = path.read_text(encoding="utf-8")
        if raw.startswith("\ufeff"):
            raw = raw[1:]
        lines = raw.splitlines()

    seen: set[str] = set()
    out: list[str] = []
    key_re = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")
    for line in lines:
        m = key_re.match(line)
        if m and m.group(1) in keys:
            name = m.group(1)
            out.append(f"{name}={_env_quote(keys[name])}")
            seen.add(name)
        else:
            out.append(line)

    missing = [k for k in keys if k not in seen]
    if missing:
        if out and out[-1].strip() != "":
            out.append("")
        out.append("# Обновлено из Настроек UI")
        for name in missing:
            out.append(f"{name}={_env_quote(keys[name])}")

    text = "\n".join(out).rstrip() + "\n"
    path.write_text(text, encoding="utf-8")
    for name, value in keys.items():
        os.environ[name] = value
    return path


def persist_connection_to_env(
    *,
    base_url: Optional[str] = None,
    login: Optional[str] = None,
    password: Optional[str] = None,
) -> Path:
    """Записать креды подключения в .env и os.environ."""
    updates: dict[str, str] = {}
    if base_url is not None and str(base_url).strip() != "":
        updates["CARROT_BASE_URL"] = str(base_url).strip()
    if login is not None and str(login).strip() != "":
        updates["CARROT_LOGIN"] = str(login).strip()
    if password is not None and str(password) != "":
        updates["CARROT_PASSWORD"] = str(password)
    if not updates:
        return ENV_PATH
    path = update_env_file(updates)
    log.info("Сохранено в %s: %s", path, ", ".join(updates.keys()))
    return path



def _on_carrot_traffic(entry: dict[str, Any]) -> None:
    """Пишет Flask↔Carrot вызовы в DEV-лог."""
    traffic_log.add(
        channel=str(entry.get("channel") or "carrot"),
        method=str(entry.get("method") or ""),
        url=str(entry.get("url") or ""),
        status=entry.get("status"),
        duration_ms=entry.get("duration_ms"),
        request_headers=entry.get("request_headers"),
        request_body=entry.get("request_body"),
        response_headers=entry.get("response_headers"),
        response_body=entry.get("response_body"),
        error=entry.get("error"),
        note=entry.get("note"),
    )


def ensure_client(creds: Optional[dict[str, Any]] = None) -> CarrotClient:
    """Вернуть (или создать) singleton CarrotClient: body → session → env."""
    global _client, _client_key, _session
    creds = creds or {}

    base_url = (
        _pick_cred(creds, "baseUrl", "base_url")
        or _session.get("baseUrl")
        or env("CARROT_BASE_URL")
    )
    login = (
        _pick_cred(creds, "login")
        or _session.get("login")
        or env("CARROT_LOGIN")
    )
    password = (
        _pick_cred(creds, "password")
        or _session.get("password")
        or env("CARROT_PASSWORD")
    )
    if not base_url:
        raise ValueError("Нужен CARROT_BASE_URL или baseUrl в форме / Настройках")
    if not login or not password:
        raise ValueError("Нужны login/password (из .env или формы)")

    ws_url = (
        _pick_cred(creds, "wsUrl", "ws_url")
        or _session.get("wsUrl")
        or env("CARROT_WS_URL")
    )
    ws_file_url = (
        _pick_cred(creds, "wsFileUrl", "ws_file_url")
        or _session.get("wsFileUrl")
        or env("CARROT_WS_FILE_URL")
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
                "traffic_hook": _on_carrot_traffic,
            }
        )
        _client_key = key
    else:
        _client.traffic_hook = _on_carrot_traffic
    _session = {
        "baseUrl": base_url,
        "login": login,
        "password": password,
        "wsUrl": ws_url,
        "wsFileUrl": ws_file_url,
    }
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
# DEV: лог UI↔Flask и эндпоинты панели трафика
# ---------------------------------------------------------------------------

@app.before_request
def _dev_before_request():  # type: ignore[no-untyped-def]
    if not request.path.startswith("/api/"):
        return
    # не логируем сам опрос панели
    if request.path.startswith("/api/dev/"):
        return
    request._dev_t0 = time.time()  # type: ignore[attr-defined]
    request._dev_body = None  # type: ignore[attr-defined]
    try:
        if request.mimetype and "json" in request.mimetype:
            request._dev_body = request.get_json(silent=True)  # type: ignore[attr-defined]
        elif request.files:
            request._dev_body = {  # type: ignore[attr-defined]
                "form": {k: request.form.get(k) for k in request.form},
                "files": {
                    k: {
                        "filename": f.filename,
                        "content_type": f.mimetype,
                        "size": f.content_length,
                    }
                    for k, f in request.files.items()
                },
            }
    except Exception:
        request._dev_body = None  # type: ignore[attr-defined]


@app.after_request
def _dev_after_request(response):  # type: ignore[no-untyped-def]
    if not request.path.startswith("/api/") or request.path.startswith("/api/dev/"):
        return response
    t0 = getattr(request, "_dev_t0", None)
    duration = ((time.time() - t0) * 1000.0) if t0 else None
    resp_body: Any = None
    try:
        if response.is_json:
            resp_body = response.get_json(silent=True)
        else:
            raw = response.get_data(as_text=True) or ""
            resp_body = raw[:2000]
    except Exception:
        resp_body = None
    traffic_log.add(
        channel="ui",
        method=request.method,
        url=request.path
        + (("?" + request.query_string.decode("utf-8", "replace")) if request.query_string else ""),
        status=response.status_code,
        duration_ms=duration,
        request_headers={
            k: v
            for k, v in request.headers.items()
            if k.lower() in ("content-type", "accept", "content-length")
        },
        request_body=getattr(request, "_dev_body", None),
        response_headers={
            k: v
            for k, v in response.headers.items()
            if k.lower() in ("content-type", "content-length")
        },
        response_body=resp_body,
    )
    return response


@app.get("/api/dev/traffic")
def api_dev_traffic():
    after_id = request.args.get("after") or None
    channel = request.args.get("channel") or None
    try:
        limit = int(request.args.get("limit") or "120")
    except ValueError:
        limit = 120
    return jsonify(
        {
            "ok": True,
            "dev": True,
            "stats": traffic_log.stats(),
            "entries": traffic_log.list_entries(
                after_id=after_id, limit=limit, channel=channel
            ),
        }
    )


@app.post("/api/dev/traffic/clear")
def api_dev_traffic_clear():
    traffic_log.clear()
    return jsonify({"ok": True, "cleared": True, "stats": traffic_log.stats()})


# ---------------------------------------------------------------------------
# API (совместимо с rest-client/web-server.js)
# ---------------------------------------------------------------------------

@app.get("/api/health")
def api_health():
    base = _session.get("baseUrl") or env("CARROT_BASE_URL", "") or ""
    login = _session.get("login") or env("CARROT_LOGIN", "") or ""
    password = _session.get("password") or env("CARROT_PASSWORD", "") or ""
    return jsonify(
        {
            "ok": True,
            "hasEnv": bool(base and login and password),
            "defaults": {
                "baseUrl": base,
                "login": login,
                # Пароль отдаём только для локального UI, чтобы форма Настроек
                # показывала текущее значение из .env (хост обычно 127.0.0.1).
                "password": password,
                "hasPassword": bool(password),
            },
            "envPath": str(ENV_PATH),
            "connected": bool(_session.get("baseUrl") and _client is not None),
            "backend": "flask",
        }
    )


@app.post("/api/connect")
def api_connect():
    body = request.get_json(silent=True) or {}
    client = ensure_client(body)
    client.authenticate()
    # Писать в .env только по явному запросу (DEV UI: persistEnv=true).
    persist = body.get("persistEnv") or body.get("persist_env")
    if persist in (True, 1, "1", "true", "True", "yes"):
        persist_connection_to_env(
            base_url=_session.get("baseUrl"),
            login=_session.get("login"),
            password=_session.get("password"),
        )
    return jsonify(
        {
            "ok": True,
            "baseUrl": client.base_url,
            "login": _session.get("login") or "",
            "envPath": str(ENV_PATH),
            "envWritten": bool(
                persist in (True, 1, "1", "true", "True", "yes")
            ),
        }
    )


@app.post("/api/settings/connection")
def api_settings_connection():
    """Сменить Base URL / login / password, записать в .env и переподключиться."""
    body = request.get_json(silent=True) or {}
    patch: dict[str, Any] = {}
    base_url = _pick_cred(body, "baseUrl", "base_url")
    login = _pick_cred(body, "login")
    password = _pick_cred(body, "password")
    if base_url:
        patch["baseUrl"] = base_url
    if login:
        patch["login"] = login
    if password:
        patch["password"] = password
    if not patch:
        raise ValueError("Укажи baseUrl, login или password")
    if not (
        patch.get("baseUrl")
        or _session.get("baseUrl")
        or env("CARROT_BASE_URL")
    ):
        raise ValueError("Укажи baseUrl")
    if not (patch.get("login") or _session.get("login") or env("CARROT_LOGIN")):
        raise ValueError("Укажи login")
    if not (
        patch.get("password") or _session.get("password") or env("CARROT_PASSWORD")
    ):
        raise ValueError("Укажи password")
    client = ensure_client(patch)
    client.authenticate()
    persist_connection_to_env(
        base_url=_session.get("baseUrl"),
        login=_session.get("login"),
        password=_session.get("password"),
    )
    return jsonify(
        {
            "ok": True,
            "baseUrl": client.base_url,
            "login": _session.get("login") or "",
            "envPath": str(ENV_PATH),
        }
    )


@app.post("/api/settings/base-url")
def api_settings_base_url():
    """Совместимость: то же, что /api/settings/connection."""
    return api_settings_connection()


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
                    "hasMediaVariables": any(
                        is_media_type(v.get("type"))
                        for v in (t.get("variables") or [])
                    ),
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
    auto_name_raw = body.get("autoName") if isinstance(body, dict) else None
    if auto_name_raw is None and isinstance(body, dict):
        auto_name_raw = body.get("auto_name")
    auto_name = True
    if auto_name_raw is not None:
        auto_name = str(auto_name_raw).strip().lower() not in (
            "0",
            "false",
            "no",
            "off",
            "",
        )

    client = ensure_client()
    result = client.create_events(events, auto_name=auto_name)
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
      mediaFolder — опц. локальная папка сервера для Media-файлов из Excel
      mediaFiles — опц. файлы из выбранной в браузере папки
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

    # Файлы из выбранной в браузере папки: mediaFiles / mediaFiles[] / mediaFile
    media_files: dict[str, bytes] = {}
    for key in ("mediaFiles", "mediaFiles[]", "mediaFile"):
        for f in request.files.getlist(key):
            if not f or not f.filename:
                continue
            name = Path(f.filename).name
            raw_bytes = f.read()
            if name and raw_bytes:
                media_files[name] = raw_bytes

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

    auto_name_raw = (
        request.form.get("autoName")
        or request.form.get("auto_name")
        or request.args.get("autoName")
    )
    if auto_name_raw is None or str(auto_name_raw).strip() == "":
        auto_name = True
    else:
        auto_name = str(auto_name_raw).strip().lower() in (
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
    parsed = rows_to_event_drafts(
        rows, template, has_header=has_header, auto_name=auto_name
    )
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
            media_files=media_files or None,
            upload_file=_upload,
        )
        missing = media_report.get("missing") or []
        if missing:
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

    events = []
    for d in drafts:
        ev = {k: v for k, v in d.items() if not k.startswith("_")}
        events.append(ev)

    result = client.create_events(events, auto_name=auto_name)
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


def _open_chrome(url: str) -> None:
    """Открыть URL в Google Chrome; иначе — браузер по умолчанию."""
    candidates = [
        os.environ.get("CHROME_PATH", "").strip(),
        # Windows
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        # macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        # Linux / PATH
        "google-chrome-stable",
        "google-chrome",
        "chrome",
        "chromium-browser",
        "chromium",
    ]
    for cand in candidates:
        if not cand:
            continue
        exe = cand if os.path.isabs(cand) and os.path.isfile(cand) else shutil.which(cand)
        if not exe:
            continue
        try:
            subprocess.Popen(
                [exe, "--new-window", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except OSError:
            continue
    webbrowser.open(url)


def main() -> None:
    ws_hint = env("CARROT_WS_URL") or (
        f"(по умолчанию ws://{_host_port(24710)})" if env("CARROT_BASE_URL") else "(не задан)"
    )
    ws_file_hint = env("CARROT_WS_FILE_URL") or (
        f"(по умолчанию ws://{_host_port(24712)})" if env("CARROT_BASE_URL") else "(не задан)"
    )
    url = f"http://{HOST}:{PORT}"
    print(f"Carrot playlist browser (Flask): {url}")
    print(
        f"Конфиг: CARROT_BASE_URL={env('CARROT_BASE_URL') or '(не задан)'}, "
        f"login={env('CARROT_LOGIN') or '(не задан)'}"
    )
    print(f"Удаление/создание событий: REST + WebSocket {ws_hint}")
    print(f"Медиа: REST /assets/folder/{{id}}, fallback WS {ws_file_hint}")

    # CARROT_WEB_OPEN=0 — не открывать браузер
    if env("CARROT_WEB_OPEN", "1") not in ("0", "false", "False", "no", "NO"):
        threading.Timer(1.0, lambda: _open_chrome(url)).start()

    app.run(host=HOST, port=PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
