# -*- coding: utf-8 -*-
"""Синхронный REST/WS-клиент Carrot Broadcast + Excel-импорт (один модуль)."""

from __future__ import annotations

import base64
import io
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional, Union
from urllib.parse import quote, urlencode, urlparse

import requests
import websocket
from openpyxl import load_workbook


# ===== errors =====
ERROR_NAMES: dict[int, str] = {
    0: "Success",
    1: "CommonError",
    2: "FileUploadingError",
    31: "NoEngines",
    32: "NoContent",
    41: "InUse",
    42: "AlreadyExists",
    43: "NameError",
    44: "NotFound",
    45: "InvalidState",
    46: "InvalidValue",
    99: "Unknown",
}


class CarrotError(Exception):
    """Доменная или транспортная ошибка Carrot API."""

    def __init__(
        self,
        message: str,
        *,
        http_status: Optional[int] = None,
        error_code: Optional[int] = None,
        description: Optional[str] = None,
        url: Optional[str] = None,
        code: Optional[str] = None,
        **_: Any,
    ) -> None:
        super().__init__(message)
        self.http_status = http_status
        self.error_code = error_code
        self.description = description
        self.url = url
        self.code = code

# ===== util =====
# Корневая папка медиабиблиотеки Carrot (типичный GUID инсталляции).
MEDIA_ROOT_FOLDER_ID = "5535E4A7-94EE-45AD-A27B-9AFC737597B2"
MEDIA_EMPTY_FOLDER_ID = "00000000-0000-0000-0000-000000000000"
MEDIA_MAX_FOLDERS = 250

_XML_ESCAPE = (
    ("&", "&amp;"),
    ("<", "&lt;"),
    (">", "&gt;"),
    ('"', "&quot;"),
    ("'", "&apos;"),
)

_CARROT_HEX = re.compile(r"_x([0-9A-Fa-f]{4})_")


def normalize_base_url(url: str) -> str:
    """Убрать хвостовые слэши; localhost → 127.0.0.1 (IPv4)."""
    s = re.sub(r"/+$", "", str(url))
    return re.sub(r"^(https?://)localhost\b", r"\g<1>127.0.0.1", s, flags=re.I)


def decode_carrot_text(s: Optional[str]) -> str:
    """Декодировать _x0020_-последовательности Carrot в обычный текст."""
    return _CARROT_HEX.sub(
        lambda m: chr(int(m.group(1), 16)),
        "" if s is None else str(s),
    )


def xml_escape(s: object) -> str:
    """Экранировать спецсимволы XML."""
    out = str(s)
    for src, dst in _XML_ESCAPE:
        out = out.replace(src, dst)
    return out


def xml_field(block: str, name: str) -> Optional[str]:
    """Извлечь значение XML-поля по имени тега или атрибута."""
    tag = re.escape(str(name))
    el = re.search(rf"<{tag}[^>]*>([^<]*)</{tag}>", block, re.I)
    if el:
        return el.group(1)
    attr = re.search(rf'\b{tag}\s*=\s*"([^"]*)"', block, re.I)
    return attr.group(1) if attr else None


def default_ws_url_from_base(base_url: str, port: int = 24710) -> Optional[str]:
    """Построить ws(s)://host:port из REST baseUrl."""
    try:
        u = urlparse(base_url)
        if not u.hostname:
            return None
        proto = "wss:" if u.scheme == "https" else "ws:"
        return f"{proto}//{u.hostname}:{port}"
    except Exception:
        return None

# ===== ws =====

def _bool_attr(v: Any) -> str:
    if v is True or v == "true" or v == "True":
        return "true"
    if v is False or v == "false" or v == "False":
        return "false"
    return "true" if v else "false"


def variable_to_xml(v: dict[str, Any]) -> str:
    """Сериализовать переменную события в XML-атрибуты Variable."""
    return (
        "<Variable"
        f' Id="{xml_escape(v.get("id") or "")}"'
        f' Name="{xml_escape(v.get("name") or "")}"'
        f' Type="{xml_escape(v.get("type") or "Text")}"'
        f' Value="{xml_escape("" if v.get("value") is None else v["value"])}"'
        f' FieldId="{xml_escape(v.get("fieldId") or "")}"'
        f' ResetMedia="{_bool_attr(True if v.get("resetMedia") is None else v["resetMedia"])}"'
        f' UseTimecode="{_bool_attr(False if v.get("useTimecode") is None else v["useTimecode"])}"'
        f' Loop="{_bool_attr(False if v.get("loop") is None else v["loop"])}"'
        f' Locked="{_bool_attr(False if v.get("locked") is None else v["locked"])}"'
        f' DefaultValue="{xml_escape("" if v.get("defaultValue") is None else v["defaultValue"])}"'
        f' MinValue="{xml_escape("" if v.get("minValue") is None else v["minValue"])}"'
        f' MaxValue="{xml_escape("" if v.get("maxValue") is None else v["maxValue"])}"'
        f' UseDataVars="{_bool_attr(False if v.get("useDataVars") is None else v["useDataVars"])}"'
        " />"
    )


def event_create_to_xml(event: dict[str, Any], message_id: int) -> str:
    """Собрать команду CreateEventInDB (AppName ticker-web / Playlists)."""
    vars_xml = "".join(variable_to_xml(v) for v in (event.get("variables") or []))
    ext = event.get("externalId")
    if ext is not None and str(ext).strip() != "":
        external_id = str(ext).strip()
    else:
        external_id = event["id"]
    tti = event.get("templateTypeInt")
    if tti is None:
        tti = 1
    return (
        f'<Command CmdGroup="Playlists" CmdName="CreateEventInDB" MessageId="{message_id}">'
        "<Event>"
        f"<Id>{xml_escape(event['id'])}</Id>"
        f"<Name>{xml_escape(event.get('name') or '')}</Name>"
        "<Created>01.01.0001 0:00:00</Created>"
        "<Changed>01.01.0001 0:00:00</Changed>"
        f"<ExternalId>{xml_escape(external_id)}</ExternalId>"
        f"<TemplateId>{xml_escape(event['templateId'])}</TemplateId>"
        f"<ContentId>{xml_escape(event.get('contentId') or '')}</ContentId>"
        f"<TemplateTypeInt>{xml_escape(tti)}</TemplateTypeInt>"
        f"<State>{xml_escape(event.get('state') or 'IN')}</State>"
        f"<Comment>{xml_escape(event.get('comment') or '')}</Comment>"
        f"<Variables>{vars_xml}</Variables>"
        "</Event></Command>"
    )


class _WsSession:
    """Минимальная обёртка синхронного WebSocket с ожиданием результата."""

    def __init__(self, ws_url: str, timeout_ms: int) -> None:
        self.ws_url = ws_url
        self.timeout_s = timeout_ms / 1000.0
        self.session_id = str(uuid.uuid4())
        self.msg_id = 1
        self.stage = "wait-client-id"
        self._result: Any = None
        self._error: Optional[BaseException] = None
        self._done = threading.Event()
        self._ws: Optional[websocket.WebSocketApp] = None

    def next_id(self) -> int:
        mid = self.msg_id
        self.msg_id += 1
        return mid

    def send(self, xml: str) -> None:
        assert self._ws is not None
        self._ws.send(xml)

    def finish_ok(self, value: Any) -> None:
        if self._done.is_set():
            return
        self._result = value
        self._done.set()
        try:
            if self._ws:
                self._ws.close()
        except Exception:
            pass

    def finish_err(self, err: BaseException) -> None:
        if self._done.is_set():
            return
        self._error = err
        self._done.set()
        try:
            if self._ws:
                self._ws.close()
        except Exception:
            pass

    def handle_heartbeat(self, text: str) -> bool:
        if re.search(r'CmdGroup="HeartBeat"', text) and not re.search(r"MessageId=", text):
            self.send(
                '<Command CmdGroup="HeartBeat" MessageId="-1">'
                f"<SessionId>{self.session_id}</SessionId></Command>"
            )
            return True
        return False

    def send_handshake_login(self, login: str, password: str) -> None:
        self.stage = "login"
        self.send(
            f'<Command CmdGroup="HandShake" MessageId="{self.next_id()}">'
            f"<AppName>ticker-web</AppName>"
            f"<SessionID>{self.session_id}</SessionID></Command>"
        )
        self.send(
            f'<Command CmdGroup="Users" CmdName="LoginUnsecure" MessageId="{self.next_id()}">'
            f"<UserName>{xml_escape(login)}</UserName>"
            f"<PassWord>{xml_escape(password)}</PassWord></Command>"
        )

    def run(self, on_message: Callable[[str], None], error_hint: str) -> Any:
        def _on_message(_ws: Any, message: Any) -> None:
            text = str(message or "")
            if self.handle_heartbeat(text):
                return
            try:
                on_message(text)
            except BaseException as exc:
                self.finish_err(exc)

        def _on_error(_ws: Any, _err: Any) -> None:
            self.finish_err(
                CarrotError(
                    f"Ошибка WebSocket-соединения [{self.ws_url}]. {error_hint}",
                    url=self.ws_url,
                )
            )

        def _on_close(_ws: Any, *_args: Any) -> None:
            if not self._done.is_set():
                self.finish_err(
                    CarrotError(
                        f"WebSocket закрыт до завершения (stage={self.stage}, url={self.ws_url})"
                    )
                )

        def _on_open(_ws: Any) -> None:
            pass

        self._ws = websocket.WebSocketApp(
            self.ws_url,
            on_message=_on_message,
            on_error=_on_error,
            on_close=_on_close,
            on_open=_on_open,
        )

        def _run() -> None:
            try:
                self._ws.run_forever()
            except Exception as exc:
                self.finish_err(
                    CarrotError(f"Не удалось открыть WebSocket: {exc}", url=self.ws_url)
                )

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        if not self._done.wait(timeout=self.timeout_s):
            self.finish_err(
                CarrotError(
                    f"Таймаут WebSocket (stage={self.stage}, url={self.ws_url})"
                )
            )
            try:
                if self._ws:
                    self._ws.close()
            except Exception:
                pass
        t.join(timeout=2.0)
        if self._error is not None:
            raise self._error
        return self._result


def delete_event_via_ws(
    ws_url: str,
    login: str,
    password: str,
    event_id: str,
    timeout_ms: int = 15000,
) -> dict[str, Any]:
    """Удалить событие через WS RemoveEventFromDB (порт 24710)."""
    if not ws_url:
        raise CarrotError(
            "Не задан WebSocket URL (CARROT_WS_URL или хост из CARROT_BASE_URL)"
        )
    if not login or not password:
        raise ValueError("login/password обязательны для WS-удаления")

    sess = _WsSession(ws_url, max(timeout_ms, 15000))

    def on_message(text: str) -> None:
        if sess.stage == "wait-client-id" and re.search(r'CmdGroup="ClientID"', text):
            sess.send_handshake_login(login, password)
            return

        if sess.stage == "login":
            if re.search(r'CmdName="LoginError"', text):
                m = re.search(r"<Message>([\s\S]*?)</Message>", text)
                raise CarrotError(
                    "WS LoginError: " + (m.group(1) if m else "неверный логин/пароль")
                )
            if re.search(r'CmdName="LoginOk"', text):
                sess.stage = "remove"
                sess.send(
                    f'<Command CmdGroup="Playlists" CmdName="RemoveEventFromDB" '
                    f'MessageId="{sess.next_id()}">'
                    f"<EventId>{xml_escape(event_id)}</EventId></Command>"
                )
                return

        if sess.stage == "remove":
            if re.search(r'CmdName="EventRemovedFromDB"', text):
                sess.finish_ok({"deleted": event_id, "via": "websocket"})
                return
            if re.search(r'CmdName="[^"]*Error[^"]*"', text) or re.search(
                r'CmdGroup="Error"', text
            ):
                m = re.search(r"<Message>([\s\S]*?)</Message>", text) or re.search(
                    r"<Description>([\s\S]*?)</Description>", text
                )
                raise CarrotError(
                    "WS ошибка удаления: " + (m.group(1) if m else text[:220])
                )

    return sess.run(
        on_message,
        "Порт 24710 должен быть доступен с этой машины.",
    )


def create_events_via_ws(
    ws_url: str,
    login: str,
    password: str,
    events: list[dict[str, Any]],
    timeout_ms: int = 20000,
) -> list[dict[str, Any]]:
    """Создать события через WS CreateEventInDB (порт 24710)."""
    if not events:
        return []
    if not ws_url:
        raise CarrotError(
            "Не задан WebSocket URL (CARROT_WS_URL или хост из CARROT_BASE_URL)"
        )
    if not login or not password:
        raise ValueError("login/password обязательны для WS-создания")

    timeout = max(timeout_ms, 20000)
    sess = _WsSession(ws_url, timeout)
    created: list[dict[str, Any]] = []
    index = {"i": 0}

    def send_next() -> None:
        if index["i"] >= len(events):
            sess.finish_ok(created)
            return
        sess.stage = "create"
        ev = events[index["i"]]
        sess.send(event_create_to_xml(ev, sess.next_id()))

    def on_message(text: str) -> None:
        if sess.stage == "wait-client-id" and re.search(r'CmdGroup="ClientID"', text):
            sess.send_handshake_login(login, password)
            return

        if sess.stage == "login":
            if re.search(r'CmdName="LoginError"', text):
                m = re.search(r"<Message>([\s\S]*?)</Message>", text)
                raise CarrotError(
                    "WS LoginError: " + (m.group(1) if m else "неверный логин/пароль")
                )
            if re.search(r'CmdName="LoginOk"', text):
                send_next()
                return

        if sess.stage == "create":
            if re.search(r'CmdName="EventAdded"', text):
                cur = events[index["i"]]
                created.append(
                    {"id": cur["id"], "name": cur.get("name"), "via": "websocket"}
                )
                index["i"] += 1
                send_next()
                return
            if (
                re.search(r'CmdName="[^"]*Error[^"]*"', text)
                or re.search(r'CmdGroup="Error"', text)
                or re.search(r"already_x0020_exists|already exists", text, re.I)
            ):
                m = (
                    re.search(r"<Message>([\s\S]*?)</Message>", text)
                    or re.search(r"<Description>([\s\S]*?)</Description>", text)
                    or re.search(r'CmdName="([^"]+)"', text)
                )
                cur = events[index["i"]] if index["i"] < len(events) else {}
                raw_msg = m.group(1) if m else text[:260]
                msg = decode_carrot_text(raw_msg)
                already = bool(re.search(r"already exists", msg, re.I))
                raise CarrotError(
                    f"Не удалось создать «{cur.get('name') or cur.get('id') or '?'}»: "
                    f"{msg}"
                    + (" — сервер отклонил как уже существующее" if already else ""),
                    error_code=42 if already else None,
                )

    return sess.run(
        on_message,
        "Порт 24710 должен быть доступен с этой машины.",
    )


def list_media_via_ws(
    ws_url: str,
    login: str,
    password: str,
    *,
    folder_id: Optional[str] = None,
    deep: bool = True,
    timeout_ms: int = 45000,
) -> list[dict[str, Any]]:
    """
    Список медиа через WS MediaAssetLibrary/GetAssetFolder (порт 24712).

    Только HandShake — без LoginUnsecure (на 24712 даёт Unknown Command Group).
    login/password проверяются как в JS, но в XML не отправляются.
    """
    if not ws_url:
        raise CarrotError(
            "Не задан WebSocket URL для медиа (CARROT_WS_FILE_URL, порт 24712)"
        )
    if not login or not password:
        raise ValueError("login/password обязательны для WS-медиа")

    preferred_root = folder_id or MEDIA_ROOT_FOLDER_ID
    seed_roots: list[str] = []
    for fid in (preferred_root, MEDIA_EMPTY_FOLDER_ID, MEDIA_ROOT_FOLDER_ID):
        if fid and fid not in seed_roots:
            seed_roots.append(fid)

    sess = _WsSession(ws_url, max(timeout_ms, 45000))
    assets: list[dict[str, Any]] = []
    seen: dict[str, bool] = {}
    pending_folders = list(seed_roots)
    fetched_folders: dict[str, bool] = {}
    folders_queued = len(seed_roots)

    def finish_ok() -> None:
        assets.sort(key=lambda a: str(a.get("name") or "").casefold())
        sess.finish_ok(assets)

    def queue_folder(fid: Optional[str]) -> None:
        nonlocal folders_queued
        if (
            not fid
            or not deep
            or fetched_folders.get(fid)
            or fid in pending_folders
        ):
            return
        if folders_queued >= MEDIA_MAX_FOLDERS:
            return
        folders_queued += 1
        pending_folders.append(fid)

    def request_next_folder() -> None:
        while pending_folders:
            fid = pending_folders.pop(0)
            if not fid or fetched_folders.get(fid):
                continue
            fetched_folders[fid] = True
            sess.stage = "media"
            sess.send(
                f'<Command CmdGroup="MediaAssetLibrary" CmdName="GetAssetFolder" '
                f'MessageId="{sess.next_id()}">'
                f"<FolderID>{xml_escape(fid)}</FolderID></Command>"
            )
            return
        finish_ok()

    def parse_folder_xml(text: str) -> None:
        folder_re = re.compile(
            r"<Folder(\s[^>]*)?/>|<Folder(\s[^>]*)?>([\s\S]*?)</Folder>", re.I
        )
        asset_re = re.compile(
            r"<Asset(\s[^>]*)?/>|<Asset(\s[^>]*)?>([\s\S]*?)</Asset>", re.I
        )
        for m in folder_re.finditer(text):
            block = (m.group(1) or "") + (m.group(2) or "") + (m.group(3) or "")
            fid = (
                xml_field(block, "ID")
                or xml_field(block, "FolderID")
                or xml_field(block, "FolderId")
            )
            if fid:
                queue_folder(fid)
        for m in asset_re.finditer(text):
            block = (m.group(1) or "") + (m.group(2) or "") + (m.group(3) or "")
            aid = (
                xml_field(block, "ID")
                or xml_field(block, "AssetId")
                or xml_field(block, "AssetID")
            )
            if not aid or seen.get(aid):
                continue
            name = xml_field(block, "Name")
            type_raw = xml_field(block, "AssetTypeInt")
            parent_id = (
                xml_field(block, "ParentID") or xml_field(block, "ParentId") or ""
            )
            seen[aid] = True
            assets.append(
                {
                    "id": aid,
                    "name": decode_carrot_text(
                        name if name is not None and name != "" else aid
                    ),
                    "assetTypeInt": (
                        int(type_raw) if type_raw is not None and type_raw != "" else None
                    ),
                    "parentId": parent_id or "",
                }
            )

    def on_message(text: str) -> None:
        if sess.stage == "wait-client-id" and re.search(r'CmdGroup="ClientID"', text):
            # Файловый канал (24712): HandShake без LoginUnsecure.
            sess.stage = "handshake"
            sess.send(
                f'<Command CmdGroup="HandShake" MessageId="{sess.next_id()}">'
                f"<AppName>ticker-web</AppName>"
                f"<SessionID>{sess.session_id}</SessionID></Command>"
            )
            return

        if sess.stage == "handshake":
            if re.search(r"Unknown Command Group", text, re.I):
                raise CarrotError(
                    f"WS ошибка медиа: Unknown Command Group на {ws_url}. "
                    "Нужен порт 24712 (CARROT_WS_FILE_URL), не 24710."
                )
            sess.stage = "media"
            if re.search(r'CmdGroup="MediaAssetLibrary"', text) or re.search(
                r"FolderStructure|<Asset[\s>]|<Folder[\s>]", text, re.I
            ):
                parse_folder_xml(text)
            request_next_folder()
            return

        if sess.stage == "media":
            if re.search(r"Unknown Command Group", text, re.I):
                raise CarrotError(
                    f"WS ошибка медиа: Unknown Command Group на {ws_url}. "
                    "Нужен порт 24712 (CARROT_WS_FILE_URL), не 24710."
                )
            if re.search(r'CmdGroup="HandShake"', text, re.I) and not re.search(
                r"MediaAssetLibrary|FolderStructure|<Asset[\s>]", text, re.I
            ):
                return
            if re.search(r'CmdGroup="MediaAssetLibrary"', text) or re.search(
                r"FolderStructure|<Asset[\s>/]|</Asset>|<Folder[\s>/]", text, re.I
            ):
                parse_folder_xml(text)
                request_next_folder()
                return
            if re.search(r'CmdName="[^"]*Error[^"]*"', text) or re.search(
                r'CmdGroup="Error"', text
            ):
                soft = bool(
                    re.search(r"not\s*found|не\s*найд|invalid|неверн", text, re.I)
                )
                if soft:
                    request_next_folder()
                    return
                m = re.search(r"<Message>([\s\S]*?)</Message>", text) or re.search(
                    r"<Description>([\s\S]*?)</Description>", text
                )
                raise CarrotError(
                    "WS ошибка медиа: "
                    + decode_carrot_text(m.group(1) if m else text[:220])
                )

    return sess.run(
        on_message,
        "Нужен порт 24712 (обмен файлами).",
    )


def run_playlist_session(
    ws_url: str,
    login: str,
    password: str,
    after_login_callback: Callable[
        [Callable[[str], None], Callable[[str], None]], None
    ],
    *,
    timeout_ms: int = 15000,
) -> Any:
    """
    Сессия 24710: ClientID → HandShake → LoginUnsecure → callback.

    after_login_callback(send, on_response_register) вызывается после LoginOk.
    on_response_register(handler) подписывает обработчик последующих WS-сообщений.
    Для завершения вызвать send._session.finish_ok / finish_err нельзя —
    используйте замыкание: callback получает send и должен вернуть результат
    через исключения/возврат не подходит; передайте finish через атрибуты.

    Практичнее вызывать delete_event_via_ws / create_events_via_ws напрямую.
    """
    if not ws_url:
        raise CarrotError("Не задан WebSocket URL")
    if not login or not password:
        raise ValueError("login/password обязательны")

    sess = _WsSession(ws_url, timeout_ms)
    started = False
    handlers: list[Callable[[str], None]] = []

    def register(handler: Callable[[str], None]) -> None:
        handlers.append(handler)

    def on_message(text: str) -> None:
        nonlocal started
        if sess.stage == "wait-client-id" and re.search(r'CmdGroup="ClientID"', text):
            sess.send_handshake_login(login, password)
            return
        if sess.stage == "login":
            if re.search(r'CmdName="LoginError"', text):
                m = re.search(r"<Message>([\s\S]*?)</Message>", text)
                raise CarrotError(
                    "WS LoginError: " + (m.group(1) if m else "неверный логин/пароль")
                )
            if re.search(r'CmdName="LoginOk"', text):
                sess.stage = "callback"
                if not started:
                    started = True
                    # Дать callback доступ к завершению сессии.
                    setattr(sess.send, "finish_ok", sess.finish_ok)
                    setattr(sess.send, "finish_err", sess.finish_err)
                    after_login_callback(sess.send, register)
                return
        if sess.stage == "callback":
            for h in list(handlers):
                h(text)

    return sess.run(on_message, "Порт 24710 должен быть доступен с этой машины.")

# ===== client =====

_FATAL_NET = re.compile(
    r"^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|"
    r"ERR_INVALID_URL|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|"
    r"CERT_UNTRUSTED)$"
)


def _wrap_net_error(err: BaseException, url: str) -> CarrotError:
    code = getattr(err, "errno", None) or getattr(err, "strerror", "") or ""
    if isinstance(code, int):
        code = str(code)
    detail = str(err)
    if isinstance(err, requests.exceptions.ConnectionError):
        code = code or "ECONNREFUSED"
    elif isinstance(err, requests.exceptions.Timeout):
        code = code or "ETIMEDOUT"
    elif isinstance(err, requests.exceptions.SSLError):
        code = code or "CERT_UNTRUSTED"

    hint = ""
    refused = (
        code == "ECONNREFUSED"
        or "Connection refused" in detail
        or "10061" in detail  # WinError: target machine actively refused
        or "actively refused" in detail.lower()
    )
    if refused:
        port = ""
        try:
            from urllib.parse import urlparse

            port = str(urlparse(url).port or "")
        except Exception:
            port = ""
        if port in ("24710", "24712"):
            hint = (
                f" Порт {port} — это WebSocket Carrot, не REST. "
                "В Base URL нужен REST (часто :5001), не 24710/24712."
            )
        elif port in ("8088", "8080"):
            hint = (
                f" Порт {port} обычно не REST API Carrot "
                "(8088 — веб-плейлист). Укажи URL REST, часто :5001."
            )
        else:
            where = f" (порт {port})" if port else ""
            hint = (
                f" На этом адресе{where} никто не принимает TCP-соединения. "
                "Проверь, что Carrot Server запущен и REST слушает этот host:port "
                "(swagger /auth/generate). Не путай с WS 24710/24712 и с 8088."
            )
        code = code or "ECONNREFUSED"
    elif code in ("ENOTFOUND", "EAI_AGAIN") or "Name or service not known" in detail:
        hint = " Имя хоста не резолвится. Проверь CARROT_BASE_URL."
    elif "timed out" in detail.lower() or code == "ETIMEDOUT":
        hint = (
            " Таймаут. Сервер недоступен с этой машины (файрвол, VPN, неверный IP)."
        )
    elif re.search(r"CERT|UNABLE_TO_VERIFY|SSL", code + detail, re.I):
        hint = " HTTPS с самоподписанным сертификатом. Добавь в .env CARROT_INSECURE_TLS=1"
    return CarrotError(
        f"Сеть: {(code + ' — ') if code else ''}{detail} [{url}]{hint}",
        url=url,
        code=str(code) if code else "",
    )


class CarrotClient:
    """Минимальный REST-клиент Carrot Broadcast с WS-fallback для create/delete/media."""

    def __init__(self, opts: Optional[dict[str, Any]] = None, **kwargs: Any) -> None:
        opts = dict(opts or {})
        opts.update(kwargs)
        if not opts.get("baseUrl") and not opts.get("base_url"):
            raise ValueError("baseUrl обязателен (напр. http://host:port/api)")

        base = opts.get("baseUrl") or opts.get("base_url")
        self.base_url = normalize_base_url(base)
        self.timeout_ms = (
            opts["timeoutMs"]
            if opts.get("timeoutMs") is not None
            else opts.get("timeout_ms", 10000)
        )
        self.login = opts.get("login")
        self.password = opts.get("password")
        self.notifications_enabled = bool(
            opts.get("notificationsEnabled", opts.get("notifications_enabled", False))
        )
        self.sender_id = opts.get("senderId") or opts.get("sender_id") or "ticker-client"
        self.receiver_id = (
            opts.get("receiverId") or opts.get("receiver_id") or "carrot-server"
        )
        self.ws_url = (
            opts.get("wsUrl")
            or opts.get("ws_url")
            or default_ws_url_from_base(self.base_url, 24710)
        )
        self.ws_file_url = (
            opts.get("wsFileUrl")
            or opts.get("ws_file_url")
            or default_ws_url_from_base(self.base_url, 24712)
        )

        self.token: Optional[str] = None
        self.token_acquired_at = 0.0
        self.token_ttl_ms = 55 * 60 * 1000
        self.max_retries = (
            opts["maxRetries"]
            if opts.get("maxRetries") is not None
            else opts.get("max_retries", 3)
        )

        self._message_id = 0
        self._all_events_cache: Optional[list[dict[str, Any]]] = None
        self._all_events_cache_at = 0.0
        self._all_events_cache_ttl_ms = (
            opts["allEventsCacheTtlMs"]
            if opts.get("allEventsCacheTtlMs") is not None
            else opts.get("all_events_cache_ttl_ms", 120000)
        )
        self._template_name_cache: dict[str, str] = {}
        self._session = requests.Session()

    # --- совместимость camelCase-свойств (как в JS) ---
    @property
    def baseUrl(self) -> str:  # noqa: N802
        return self.base_url

    @baseUrl.setter
    def baseUrl(self, v: str) -> None:  # noqa: N802
        self.base_url = v

    @property
    def wsUrl(self) -> Optional[str]:  # noqa: N802
        return self.ws_url

    @property
    def wsFileUrl(self) -> Optional[str]:  # noqa: N802
        return self.ws_file_url

    def invalidate_events_cache(self) -> None:
        """Сбросить кэш списка всех событий."""
        self._all_events_cache = None
        self._all_events_cache_at = 0.0

    # alias
    invalidateEventsCache = invalidate_events_cache

    def _next_message_id(self) -> int:
        self._message_id += 1
        return self._message_id

    def _envelope_query(self) -> str:
        # Как Date.toISOString() в JS.
        now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        )
        params = {
            "MessageId": str(self._next_message_id()),
            "Time": now,
            "SenderId": self.sender_id,
            "ReceiverId": self.receiver_id,
        }
        return "?" + urlencode(params)

    def _ensure_token(self) -> None:
        fresh = (
            self.token
            and (time.time() * 1000 - self.token_acquired_at) < self.token_ttl_ms
        )
        if not fresh:
            self.authenticate()

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        auth: bool = True,
        _retried_auth: bool = False,
        timeout_ms: Optional[int] = None,
        max_retries: Optional[int] = None,
    ) -> Any:
        if auth:
            self._ensure_token()

        url = self.base_url + path + self._envelope_query()
        headers = {"Content-Type": "application/json"}
        if auth and self.token:
            headers["Authorization"] = "Bearer " + self.token

        effective_timeout = (
            self.timeout_ms if timeout_ms is None else int(timeout_ms)
        )
        effective_retries = (
            self.max_retries if max_retries is None else int(max_retries)
        )
        timeout_s = max(effective_timeout, 1) / 1000.0
        last_err: Optional[CarrotError] = None

        for attempt in range(effective_retries + 1):
            try:
                kwargs: dict[str, Any] = {
                    "method": method,
                    "url": url,
                    "headers": headers,
                    "timeout": timeout_s,
                }
                if body is not None:
                    kwargs["json"] = body
                res = self._session.request(**kwargs)

                if res.status_code == 401 and auth and not _retried_auth:
                    self.token = None
                    self._ensure_token()
                    return self._request(
                        method,
                        path,
                        body,
                        auth=auth,
                        _retried_auth=True,
                        timeout_ms=timeout_ms,
                        max_retries=max_retries,
                    )

                text = res.text or ""
                json_data: Any = None
                if text:
                    try:
                        json_data = res.json()
                    except ValueError:
                        ctype = res.headers.get("content-type") or "(нет)"
                        preview = re.sub(r"\s+", " ", text)[:220]
                        looks_html = bool(
                            re.search(r"<html|<!doctype html|<head|<body", text, re.I)
                        )
                        raise CarrotError(
                            f"Ответ не JSON (HTTP {res.status_code}, Content-Type: {ctype}). "
                            + (
                                "Это HTML — веб-интерфейс Carrot, не REST. Порт веб-плейлиста "
                                "(часто 8088) сюда не подходит; нужен отдельный URL REST API "
                                "из документации (/api + JWT). "
                                if looks_html
                                else ""
                            )
                            + f"URL: {url} | начало ответа: {preview}",
                            http_status=res.status_code,
                            url=url,
                        )

                if not res.ok:
                    preview = re.sub(r"\s+", " ", text)[:220] if text else ""
                    hint = ""
                    if res.status_code == 404:
                        hint = (
                            " Путь не найден. В .env нужен http://хост:порт/api — "
                            "без /auth/generate на конце и без второго /api."
                        )
                    raise CarrotError(
                        f"HTTP {res.status_code} {res.reason} [{method} {url}]{hint}"
                        + (f" | ответ: {preview}" if preview else ""),
                        http_status=res.status_code,
                        url=url,
                    )

                data = json_data.get("data") if isinstance(json_data, dict) else None

                if (
                    isinstance(data, dict)
                    and isinstance(data.get("errorCode"), int)
                    and data["errorCode"] != 0
                ):
                    raise CarrotError(
                        f"Carrot {ERROR_NAMES.get(data['errorCode'], data['errorCode'])}: "
                        f"{data.get('description') or ''}",
                        error_code=data["errorCode"],
                        description=data.get("description"),
                    )

                return data
            except CarrotError:
                raise
            except Exception as err:
                wrapped = _wrap_net_error(err, url)
                last_err = wrapped
                if _FATAL_NET.match(wrapped.code or "") or attempt >= effective_retries:
                    raise wrapped from err
                # Таймаут чтения: для неидемпотентных POST повтор опасен —
                # не ретраим ETIMEDOUT (сервер мог уже выполнить операцию).
                if (wrapped.code or "") == "ETIMEDOUT":
                    raise wrapped from err
                time.sleep(1.0 * (2**attempt))

        assert last_err is not None
        raise last_err

    def authenticate(self) -> str:
        """Получить JWT (POST /auth/generate); при 404 переключить суффикс /api."""
        if not self.login or not self.password:
            raise ValueError("login/password обязательны")
        try:
            return self._authenticate_once()
        except CarrotError as err:
            if err.http_status == 404 and re.search(r"/api$", self.base_url, re.I):
                self.base_url = re.sub(r"/api$", "", self.base_url, flags=re.I)
                return self._authenticate_once()
            if err.http_status == 404 and not re.search(r"/api$", self.base_url, re.I):
                self.base_url = self.base_url + "/api"
                return self._authenticate_once()
            raise

    def _authenticate_once(self) -> str:
        data = self._request(
            "POST",
            "/auth/generate",
            {
                "login": self.login,
                "password": self.password,
                "notificationsEnabled": self.notifications_enabled,
            },
            auth=False,
        )
        if not data or not data.get("token"):
            raise CarrotError("Сервер не вернул токен")
        self.token = data["token"]
        self.token_acquired_at = time.time() * 1000
        return self.token

    def refresh(self) -> Optional[str]:
        """Обновить JWT (PUT /auth/refresh)."""
        data = self._request("PUT", "/auth/refresh")
        if data and data.get("token"):
            self.token = data["token"]
            self.token_acquired_at = time.time() * 1000
        return self.token

    # ---------------- События ----------------

    def list_events(self) -> Any:
        """Список заголовков событий: [{id, name, changed, externalId}]."""
        return self._request("GET", "/events")

    listEvents = list_events

    def get_event(self, event_id: str) -> Any:
        """Полная структура события (с variables)."""
        return self._request("GET", "/events/" + quote(str(event_id), safe=""))

    getEvent = get_event

    def edit_variables(self, event_id: str, vars_list: list[dict[str, Any]]) -> Any:
        """Изменить переменные события: vars = [{name, value}, ...]."""
        return self._request(
            "PATCH",
            "/events/" + quote(str(event_id), safe="") + "/editVariables",
            vars_list,
        )

    editVariables = edit_variables

    def _try_once(
        self, method: str, path: str, body: Any = None
    ) -> dict[str, Any]:
        prev = self.max_retries
        self.max_retries = 0
        try:
            return {"ok": True, "data": self._request(method, path, body)}
        except Exception as err:
            return {
                "ok": False,
                "error": err,
                "httpStatus": err.http_status if isinstance(err, CarrotError) else None,
                "message": str(err),
            }
        finally:
            self.max_retries = prev

    def delete_event(self, event_id: str) -> Any:
        """
        Удалить событие.

        REST часто отдаёт 405 — перебор путей, затем WS RemoveEventFromDB (24710).
        """
        enc = quote(str(event_id), safe="")
        rest_attempts = [
            {"method": "POST", "path": f"/events/{enc}/removeFromDB", "body": {}},
            {"method": "POST", "path": f"/events/{enc}/RemoveFromDB", "body": {}},
            {
                "method": "POST",
                "path": "/events/removeFromDB",
                "body": {"eventId": event_id},
            },
            {
                "method": "POST",
                "path": "/events/removeFromDB",
                "body": {"id": event_id},
            },
            {
                "method": "POST",
                "path": "/events/RemoveEventFromDB",
                "body": {"eventId": event_id},
            },
            {
                "method": "POST",
                "path": "/events/RemoveEventFromDB",
                "body": {"EventId": event_id},
            },
            {"method": "POST", "path": f"/events/{enc}/delete", "body": {}},
            {"method": "DELETE", "path": f"/events/{enc}/fromDB", "body": None},
            {"method": "DELETE", "path": f"/events/{enc}", "body": None},
        ]

        tried: list[str] = []
        for a in rest_attempts:
            r = self._try_once(a["method"], a["path"], a["body"])
            tried.append(
                f"{a['method']} {a['path']} → "
                + ("OK" if r["ok"] else f"HTTP {r.get('httpStatus') or '?'}")
            )
            if r["ok"]:
                self.invalidate_events_cache()
                return r["data"]
            err = r.get("error")
            if isinstance(err, CarrotError) and err.error_code:
                raise err
            if r.get("httpStatus") and r["httpStatus"] not in (404, 405):
                raise err  # type: ignore[misc]

        try:
            ws_result = self.delete_event_via_websocket(event_id)
            self.invalidate_events_cache()
            return ws_result
        except Exception as ws_err:
            raise CarrotError(
                "Не удалось удалить событие через REST и WebSocket. "
                f"REST: {'; '.join(tried)}. "
                f"WebSocket ({self.ws_url or 'нет URL'}): {ws_err}. "
                "Проверь, что порт 24710 доступен с этой машины (CARROT_WS_URL).",
                http_status=405,
            ) from ws_err

    deleteEvent = delete_event

    def delete_event_via_websocket(self, event_id: str) -> dict[str, Any]:
        """Удаление через WS API: Playlists / RemoveEventFromDB."""
        return delete_event_via_ws(
            self.ws_url or "",
            self.login or "",
            self.password or "",
            event_id,
            timeout_ms=max(self.timeout_ms, 15000),
        )

    deleteEventViaWebSocket = delete_event_via_websocket

    def find_event_id_by_name(self, name: str) -> Optional[str]:
        """Найти id события по точному имени (или None)."""
        lst = self.list_events() or []
        for h in lst:
            if h.get("name") == name:
                return h.get("id")
        return None

    findEventIdByName = find_event_id_by_name

    def get_template(self, template_id: str) -> Any:
        """Получить шаблон по id."""
        return self._request("GET", "/templates/" + quote(str(template_id), safe=""))

    getTemplate = get_template

    def list_templates(self) -> Any:
        """Список шаблонов."""
        return self._request("GET", "/templates")

    listTemplates = list_templates

    def normalize_template(self, raw: Any) -> Optional[dict[str, Any]]:
        """Нормализовать шаблон из REST (camelCase / PascalCase / обёртки)."""
        if not raw:
            return None
        t = (
            raw["template"]
            if isinstance(raw, dict)
            and raw.get("template")
            and not raw.get("id")
            and not raw.get("Id")
            else raw
        )
        if not isinstance(t, dict):
            return None
        tid = t.get("id") or t.get("Id") or ""
        name = t.get("name") or t.get("Name") or ""
        content_id = t.get("contentId") or t.get("ContentId") or ""
        if t.get("templateTypeInt") is not None:
            template_type_int = t["templateTypeInt"]
        elif t.get("TemplateTypeInt") is not None:
            template_type_int = t["TemplateTypeInt"]
        else:
            template_type_int = 1
        default_in_state = t.get("defaultInState") or t.get("DefaultInState") or ""
        closing_state = t.get("closingState") or t.get("ClosingState") or ""
        state_infos = t.get("stateInfos") or t.get("StateInfos") or []
        states: list[str] = []
        for s in state_infos if isinstance(state_infos, list) else []:
            st = (s.get("state") or s.get("State")) if isinstance(s, dict) else ""
            if st and st not in states:
                states.append(st)
        if default_in_state and default_in_state not in states:
            states.insert(0, default_in_state)
        if not states:
            states.append("IN")

        link_vars = (
            t.get("linkVars")
            or t.get("LinkVars")
            or t.get("variables")
            or t.get("Variables")
            or []
        )
        variables: list[dict[str, Any]] = []
        for v in link_vars if isinstance(link_vars, list) else []:
            if not v:
                continue
            if v.get("value") is not None:
                value = v["value"]
            elif v.get("Value") is not None:
                value = v["Value"]
            elif v.get("defaultValue") is not None:
                value = v["defaultValue"]
            elif v.get("DefaultValue") is not None:
                value = v["DefaultValue"]
            else:
                value = ""
            default_value = (
                v["defaultValue"]
                if v.get("defaultValue") is not None
                else (v["DefaultValue"] if v.get("DefaultValue") is not None else "")
            )
            nv = {
                "id": v.get("id") or v.get("Id") or "",
                "name": v.get("name") or v.get("Name") or "",
                "type": v.get("type") or v.get("Type") or "Text",
                "value": value,
                "fieldId": v.get("fieldId") or v.get("FieldId") or "",
                "defaultValue": default_value,
                "resetMedia": (
                    v["resetMedia"]
                    if v.get("resetMedia") is not None
                    else (v["ResetMedia"] if v.get("ResetMedia") is not None else True)
                ),
                "useTimecode": (
                    v["useTimecode"]
                    if v.get("useTimecode") is not None
                    else (
                        v["UseTimecode"] if v.get("UseTimecode") is not None else False
                    )
                ),
                "loop": (
                    v["loop"]
                    if v.get("loop") is not None
                    else (v["Loop"] if v.get("Loop") is not None else False)
                ),
                "locked": (
                    v["locked"]
                    if v.get("locked") is not None
                    else (v["Locked"] if v.get("Locked") is not None else False)
                ),
                "minValue": (
                    v["minValue"]
                    if v.get("minValue") is not None
                    else (v["MinValue"] if v.get("MinValue") is not None else "")
                ),
                "maxValue": (
                    v["maxValue"]
                    if v.get("maxValue") is not None
                    else (v["MaxValue"] if v.get("MaxValue") is not None else "")
                ),
                "useDataVars": (
                    v["useDataVars"]
                    if v.get("useDataVars") is not None
                    else (
                        v["UseDataVars"] if v.get("UseDataVars") is not None else False
                    )
                ),
            }
            if nv["name"]:
                variables.append(nv)

        return {
            "id": tid,
            "name": name,
            "contentId": content_id,
            "templateTypeInt": template_type_int,
            "defaultInState": default_in_state or states[0],
            "closingState": closing_state,
            "states": states,
            "variables": variables,
            "raw": t,
        }

    normalizeTemplate = normalize_template

    def get_normalized_template(self, template_id: str) -> dict[str, Any]:
        """Получить и нормализовать шаблон; кэширует имя."""
        raw = self.get_template(template_id)
        tpl = self.normalize_template(raw)
        if not tpl or not tpl.get("id"):
            raise CarrotError(f"Шаблон не найден или пустой ответ: {template_id}")
        if tpl.get("name"):
            self._template_name_cache[tpl["id"]] = tpl["name"]
        return tpl

    getNormalizedTemplate = get_normalized_template

    def list_normalized_templates(self) -> list[dict[str, Any]]:
        """Список нормализованных шаблонов (сортировка по имени)."""
        raw = self.list_templates()
        flat = self._flatten_templates(raw)
        out: list[dict[str, Any]] = []
        for t in flat:
            n = self.normalize_template(t)
            if n and n.get("id") and n.get("name"):
                self._template_name_cache[n["id"]] = n["name"]
            if n and n.get("id"):
                out.append(n)
        out.sort(key=lambda a: str(a.get("name") or "").casefold())
        return out

    listNormalizedTemplates = list_normalized_templates

    def create_events(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Создать одно или несколько событий (REST POST /events, затем WS CreateEventInDB).

        entries: [{ name, templateId, contentId?, templateTypeInt?, state?, comment?, variables? }]
        Пустой ExternalId подменяется на Id. Проверок уникальности имени/ExternalId нет.
        """
        lst = list(entries) if isinstance(entries, list) else []
        if not lst:
            raise ValueError("Нужен непустой массив событий")

        prepared: list[dict[str, Any]] = []
        for i, e in enumerate(lst):
            e = e or {}
            if not e.get("templateId"):
                raise ValueError(f"Событие #{i + 1}: нужен templateId")
            if not e.get("name") or not str(e["name"]).strip():
                raise ValueError(f"Событие #{i + 1}: нужно имя")

            content_id = e.get("contentId") or ""
            template_type_int = e.get("templateTypeInt")
            variables = list(e["variables"]) if isinstance(e.get("variables"), list) else []
            state = e.get("state") or "IN"

            if not content_id or template_type_int is None or not variables:
                tpl = self.get_normalized_template(e["templateId"])
                if not content_id:
                    content_id = tpl["contentId"]
                if template_type_int is None:
                    template_type_int = tpl["templateTypeInt"]
                if not e.get("state"):
                    state = tpl.get("defaultInState") or state
                if not variables:
                    variables = []
                    for v in tpl["variables"]:
                        nv = dict(v)
                        nv["value"] = (
                            v["value"]
                            if v.get("value") is not None and v["value"] != ""
                            else (v.get("defaultValue") or "")
                        )
                        variables.append(nv)
                else:
                    by_name = {v["name"]: v for v in tpl["variables"]}
                    merged = []
                    for v in variables:
                        meta = by_name.get(v.get("name"), {})
                        nv = {**meta, **v}
                        nv["value"] = (
                            (meta.get("defaultValue") or "")
                            if v.get("value") is None
                            else v["value"]
                        )
                        merged.append(nv)
                    variables = merged

            if not content_id:
                raise ValueError(
                    f"Событие «{str(e['name']).strip()}»: "
                    "у шаблона нет ContentId — создание невозможно"
                )

            eid = e.get("id") or str(uuid.uuid4())
            ext = e.get("externalId")
            if ext is not None and str(ext).strip() != "":
                external_id = str(ext).strip()
            else:
                external_id = eid

            prepared.append(
                {
                    "id": eid,
                    "name": str(e["name"]).strip(),
                    "externalId": external_id,
                    "templateId": e["templateId"],
                    "contentId": content_id,
                    "templateTypeInt": (
                        template_type_int if template_type_int is not None else 1
                    ),
                    "state": state or "IN",
                    "comment": e.get("comment") or "",
                    "variables": variables,
                }
            )

        created: list[dict[str, Any]] = []
        need_ws: list[dict[str, Any]] = []
        for ev in prepared:
            rest_body = {
                "id": ev["id"],
                "name": ev["name"],
                "externalId": ev["externalId"],
                "templateId": ev["templateId"],
                "contentId": ev["contentId"],
                "templateTypeInt": ev["templateTypeInt"],
                "state": ev["state"],
                "comment": ev["comment"],
                "variables": [
                    {
                        "id": v.get("id"),
                        "name": v.get("name"),
                        "type": v.get("type"),
                        "value": "" if v.get("value") is None else str(v["value"]),
                        "fieldId": v.get("fieldId"),
                        "defaultValue": v.get("defaultValue"),
                        "resetMedia": v.get("resetMedia"),
                        "useTimecode": v.get("useTimecode"),
                        "loop": v.get("loop"),
                        "locked": v.get("locked"),
                        "minValue": v.get("minValue"),
                        "maxValue": v.get("maxValue"),
                        "useDataVars": v.get("useDataVars"),
                    }
                    for v in ev["variables"]
                ],
            }
            r = self._try_once("POST", "/events", rest_body)
            if r["ok"]:
                created.append({"id": ev["id"], "name": ev["name"], "via": "rest"})
                continue
            err = r.get("error")
            if isinstance(err, CarrotError) and err.error_code:
                raise err
            if r.get("httpStatus") and r["httpStatus"] not in (404, 405):
                raise err or CarrotError(f"HTTP {r['httpStatus']}")
            need_ws.append(ev)

        if need_ws:
            ws_created = self.create_events_via_websocket(need_ws)
            created.extend(ws_created)

        self.invalidate_events_cache()
        return {"created": created}

    createEvents = create_events

    def create_events_via_websocket(
        self, events: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Создание через WS API: Playlists / CreateEventInDB."""
        return create_events_via_ws(
            self.ws_url or "",
            self.login or "",
            self.password or "",
            events,
            timeout_ms=max(self.timeout_ms * max(len(events), 1), 20000),
        )

    createEventsViaWebSocket = create_events_via_websocket

    # ---------------- Медиа ----------------

    def list_media_assets(self, opts: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        """Список медиа: REST GET /assets/folder/{id} (BFS), затем WS 24712."""
        opts = opts or {}
        deep = opts.get("deep", True) is not False
        preferred_root = opts.get("folderId") or MEDIA_ROOT_FOLDER_ID

        via_rest = self.list_media_assets_via_rest_folder(
            {"folderId": preferred_root, "deep": deep}
        )
        if via_rest["assets"]:
            print(
                f"[media] REST /assets/folder: {len(via_rest['assets'])} "
                f"активов, папок={via_rest['foldersOk']}"
            )
            return via_rest["assets"]

        rest_paths = ["/media", "/assets", "/mediaAssets", "/media/assets"]
        for path in rest_paths:
            r = self._try_once("GET", path)
            if r["ok"]:
                flat = self._flatten_media(r["data"])
                if flat:
                    print(f"[media] REST {path}: {len(flat)}")
                    return flat

        try:
            via_ws = self.list_media_assets_via_websocket(
                {"folderId": preferred_root, "deep": deep}
            )
            if via_ws:
                print(f"[media] WS 24712: {len(via_ws)} активов")
                return via_ws
        except Exception as err:
            hint = via_rest.get("lastErr") or str(err) or "пустой ответ"
            raise CarrotError(
                "Медиа не загрузились. REST /assets/folder пуст"
                + ("" if via_rest.get("foldersOk") else " (папки не открылись)")
                + f"; WS: {hint}",
                code=getattr(err, "code", None),
                url=getattr(err, "url", None),
            ) from err

        raise CarrotError(
            "Медиа не найдены: REST /assets/folder/{id} вернул 0 активов"
            + (
                f" (папок просмотрено: {via_rest['foldersOk']})"
                if via_rest.get("foldersOk")
                else " (не удалось открыть ни одну папку"
                + (f": {via_rest['lastErr']}" if via_rest.get("lastErr") else "")
                + ")"
            )
            + ". Проверь GUID корня и доступ к REST/WS 24712."
        )

    listMediaAssets = list_media_assets

    def upload_asset(
        self,
        file_bytes: Union[bytes, bytearray],
        filename: str,
        folder_id: Optional[str] = None,
        *,
        chunk_size: int = 1024 * 1024,
    ) -> dict[str, Any]:
        """
        Загрузить файл в медиабиблиотеку Carrot (REST API Guide V.3, §6 «Ассеты»).

        Протокол TUS 1.0.0, три шага:
          1) POST /assets/upload — создать сессию (Upload-Length, Upload-Metadata)
          2) PATCH /assets/upload/{fileId} — чанки сырых байт
          3) POST /assets/register/{fileId} — зарегистрировать как Asset в папке

        Возвращает нормализованный ассет {id, name, assetTypeInt/type, …}.
        Значение медиа-переменной события: ``{id};{name}``.
        """
        data = bytes(file_bytes or b"")
        name = (filename or "").strip()
        if not name:
            raise ValueError("Нужно имя файла (filename)")
        if not data:
            raise ValueError("Пустой файл")

        self._ensure_token()
        timeout_s = max(self.timeout_ms / 1000.0, 60.0)

        # --- 1. create upload ---
        meta = "filename " + base64.b64encode(name.encode("utf-8")).decode("ascii")
        create_headers = {
            "Authorization": "Bearer " + (self.token or ""),
            "Tus-Resumable": "1.0.0",
            "Upload-Length": str(len(data)),
            "Upload-Metadata": meta,
        }
        create_url = self.base_url + "/assets/upload" + self._envelope_query()
        try:
            res = self._session.post(
                create_url, headers=create_headers, data=b"", timeout=timeout_s
            )
        except Exception as err:
            raise _wrap_net_error(err, create_url) from err

        if res.status_code == 401:
            self.token = None
            self._ensure_token()
            create_headers["Authorization"] = "Bearer " + (self.token or "")
            try:
                res = self._session.post(
                    create_url, headers=create_headers, data=b"", timeout=timeout_s
                )
            except Exception as err:
                raise _wrap_net_error(err, create_url) from err

        if res.status_code not in (200, 201):
            raise CarrotError(
                f"TUS create failed HTTP {res.status_code}: "
                f"{(res.text or '')[:220]}",
                http_status=res.status_code,
                url=create_url,
            )

        location = res.headers.get("Location") or res.headers.get("location") or ""
        file_id = location.rstrip("/").split("/")[-1] if location else ""
        if not file_id:
            # иногда fileId приходит в теле
            try:
                body = res.json()
                file_id = (
                    (body.get("data") or {}).get("fileId")
                    or body.get("fileId")
                    or ""
                )
            except Exception:
                file_id = ""
        if not file_id:
            raise CarrotError(
                "TUS create: нет fileId в Location",
                http_status=res.status_code,
                url=create_url,
            )
        if "?" in str(file_id):
            file_id = str(file_id).split("?", 1)[0]

        # --- 2. PATCH chunks ---
        offset = 0
        while offset < len(data):
            chunk = data[offset : offset + chunk_size]
            patch_headers = {
                "Authorization": "Bearer " + (self.token or ""),
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": str(offset),
                "Content-Type": "application/offset+octet-stream",
                "Content-Length": str(len(chunk)),
            }
            patch_url = (
                self.base_url
                + "/assets/upload/"
                + quote(str(file_id), safe="")
                + self._envelope_query()
            )
            try:
                pres = self._session.patch(
                    patch_url, headers=patch_headers, data=chunk, timeout=timeout_s
                )
            except Exception as err:
                raise _wrap_net_error(err, patch_url) from err

            if pres.status_code == 401:
                self.token = None
                self._ensure_token()
                patch_headers["Authorization"] = "Bearer " + (self.token or "")
                try:
                    pres = self._session.patch(
                        patch_url, headers=patch_headers, data=chunk, timeout=timeout_s
                    )
                except Exception as err:
                    raise _wrap_net_error(err, patch_url) from err

            if pres.status_code not in (200, 204):
                raise CarrotError(
                    f"TUS patch failed HTTP {pres.status_code} @offset={offset}: "
                    f"{(pres.text or '')[:220]}",
                    http_status=pres.status_code,
                    url=patch_url,
                )

            off_hdr = pres.headers.get("Upload-Offset") or pres.headers.get(
                "upload-offset"
            )
            if off_hdr is not None and str(off_hdr).strip() != "":
                try:
                    offset = int(off_hdr)
                    continue
                except ValueError:
                    pass
            offset += len(chunk)

        # --- 3. register as Asset ---
        # Тело — JSON-строка GUID папки; пусто → Guid.Empty (корень).
        folder = (folder_id or "").strip()
        # По умолчанию — исторический корень медиабиблиотеки (как в §6).
        if not folder:
            folder = MEDIA_ROOT_FOLDER_ID

        # Register на больших файлах может идти долго. Не ретраим: повтор
        # того же fileId после успеха на сервере даёт «File not found in temporary».
        # Таймаут: минимум 120 с + ~1 с на каждый МБ сверх 10 МБ.
        size_mb = max(0, len(data) - 10 * 1024 * 1024) / (1024 * 1024)
        register_timeout_ms = int(max(120_000, 120_000 + size_mb * 1000))
        try:
            asset_raw = self._request(
                "POST",
                "/assets/register/" + quote(str(file_id), safe=""),
                folder,  # requests json=str → "guid"
                timeout_ms=register_timeout_ms,
                max_retries=0,
            )
            return self._normalize_asset(asset_raw, fallback_name=name)
        except CarrotError as err:
            if self._register_may_have_succeeded(err):
                found = self._find_asset_by_name(name, folder)
                if found:
                    return self._normalize_asset(found, fallback_name=name)
            raise

    uploadAsset = upload_asset

    def _register_may_have_succeeded(self, err: CarrotError) -> bool:
        """Таймаут или «нет во temporary» — возможен уже успешный register на сервере."""
        if (err.code or "") == "ETIMEDOUT":
            return True
        msg = (str(err) or "").lower()
        if err.error_code == 2 and (
            "temporary storage" in msg or "file not found" in msg
        ):
            return True
        if "temporary storage" in msg:
            return True
        return False

    def _find_asset_by_name(
        self, filename: str, folder_id: str
    ) -> Optional[dict[str, Any]]:
        """Искать ассет по имени в папке (после неоднозначного register)."""
        want = (filename or "").strip().lower()
        if not want:
            return None
        try:
            via = self.list_media_assets_via_rest_folder(
                {"folderId": folder_id or MEDIA_ROOT_FOLDER_ID, "deep": False}
            )
        except Exception:
            return None
        for raw in via.get("assets") or []:
            if not isinstance(raw, dict):
                continue
            n = (
                raw.get("name")
                or raw.get("Name")
                or ""
            )
            if str(n).strip().lower() == want:
                return raw
        return None

    def _normalize_asset(
        self, raw: Any, fallback_name: str = ""
    ) -> dict[str, Any]:
        """Привести Asset из REST к {id, name, assetTypeInt, parentId}."""
        if not raw or not isinstance(raw, dict):
            raise CarrotError("Пустой ответ register ассета")
        aid = raw.get("id") or raw.get("ID") or raw.get("assetId") or raw.get("AssetId")
        name = raw.get("name") or raw.get("Name") or fallback_name or ""
        if not aid:
            raise CarrotError("Ответ register без id ассета")
        typ = raw.get("type")
        if typ is None:
            typ = raw.get("assetTypeInt")
            if typ is None:
                typ = raw.get("AssetTypeInt")
        return {
            "id": aid,
            "name": name,
            "assetTypeInt": typ,
            "type": typ,
            "parentId": raw.get("parentId")
            or raw.get("ParentID")
            or raw.get("ParentId")
            or "",
            "changed": raw.get("changed") or raw.get("Changed"),
        }

    def list_media_assets_via_rest_folder(
        self, opts: Optional[dict[str, Any]] = None
    ) -> dict[str, Any]:
        """Swagger: GET /assets/folder/{folderId} — обход дерева папок."""
        opts = opts or {}
        deep = opts.get("deep", True) is not False
        preferred_root = opts.get("folderId") or MEDIA_ROOT_FOLDER_ID
        pending: list[str] = []
        for fid in (preferred_root, MEDIA_EMPTY_FOLDER_ID, MEDIA_ROOT_FOLDER_ID):
            if fid and fid not in pending:
                pending.append(fid)
        fetched: dict[str, bool] = {}
        assets: list[dict[str, Any]] = []
        seen: dict[str, bool] = {}
        folders_ok = 0
        last_err: Optional[str] = None
        scanned = 0

        while pending and scanned < MEDIA_MAX_FOLDERS:
            fid = pending.pop(0)
            if not fid or fetched.get(fid):
                continue
            fetched[fid] = True
            scanned += 1
            r = self._try_once("GET", "/assets/folder/" + quote(str(fid), safe=""))
            if not r["ok"]:
                last_err = r.get("message") or f"HTTP {r.get('httpStatus') or '?'}"
                continue
            folders_ok += 1
            parsed = self._parse_media_folder_payload(r["data"])
            for a in parsed["assets"]:
                if not a.get("id") or seen.get(a["id"]):
                    continue
                seen[a["id"]] = True
                assets.append(a)
            if deep:
                for child in parsed["folderIds"]:
                    if (
                        child
                        and not fetched.get(child)
                        and child not in pending
                        and len(pending) + scanned < MEDIA_MAX_FOLDERS
                    ):
                        pending.append(child)

        assets.sort(key=lambda a: str(a.get("name") or "").casefold())
        return {
            "assets": assets,
            "foldersOk": folders_ok,
            "lastErr": last_err,
            "scanned": scanned,
        }

    listMediaAssetsViaRestFolder = list_media_assets_via_rest_folder

    def _parse_media_folder_payload(self, raw: Any) -> dict[str, Any]:
        assets: list[dict[str, Any]] = []
        folder_ids: list[str] = []
        seen_a: dict[str, bool] = {}
        seen_f: dict[str, bool] = {}

        def add_folder(fid: Any) -> None:
            if not fid or seen_f.get(fid):
                return
            seen_f[fid] = True
            folder_ids.append(fid)

        def add_asset(node: dict[str, Any]) -> None:
            aid = node.get("id") or node.get("ID") or node.get("assetId") or node.get("AssetId")
            if not aid or seen_a.get(aid):
                return
            name = node.get("name") or node.get("Name")
            seen_a[aid] = True
            assets.append(
                {
                    "id": aid,
                    "name": name if name is not None and str(name) != "" else aid,
                    "assetTypeInt": (
                        node["assetTypeInt"]
                        if node.get("assetTypeInt") is not None
                        else node.get("AssetTypeInt")
                    ),
                    "parentId": (
                        node.get("parentId")
                        or node.get("ParentID")
                        or node.get("ParentId")
                        or ""
                    ),
                }
            )

        def walk(node: Any, under: str) -> None:
            if not node:
                return
            if isinstance(node, list):
                for n in node:
                    walk(n, under)
                return
            if not isinstance(node, dict):
                return

            aid = node.get("id") or node.get("ID") or node.get("assetId") or node.get("AssetId")
            name = node.get("name") or node.get("Name")
            has_type = (
                node.get("assetTypeInt") is not None
                or node.get("AssetTypeInt") is not None
            )
            type_str = str(node.get("type") or node.get("kind") or "").lower()
            is_asset = bool(
                aid and (has_type or type_str == "asset" or under == "assets")
            )
            is_folder = bool(
                aid
                and not is_asset
                and (
                    type_str == "folder"
                    or under == "folders"
                    or (
                        name is not None
                        and (
                            node.get("parentId") is not None
                            or node.get("ParentID") is not None
                            or node.get("ParentId") is not None
                        )
                        and not has_type
                    )
                )
            )
            if is_asset:
                add_asset(node)
            elif is_folder:
                add_folder(aid)

            walk(node.get("assets") or node.get("Assets"), "assets")
            walk(node.get("items") or node.get("Items"), under)
            walk(node.get("folders") or node.get("Folders"), "folders")
            walk(node.get("folderStructure") or node.get("FolderStructure"), under)
            walk(node.get("children"), under)

        walk(raw, "")
        return {"assets": assets, "folderIds": folder_ids}

    def _flatten_media(self, raw: Any) -> list[dict[str, Any]]:
        assets = self._parse_media_folder_payload(raw)["assets"]
        assets.sort(key=lambda a: str(a.get("name") or "").casefold())
        return assets

    def list_media_assets_via_websocket(
        self, opts: Optional[dict[str, Any]] = None
    ) -> list[dict[str, Any]]:
        """Медиа по WS обмена файлами (порт 24712), HandShake без LoginUnsecure."""
        opts = opts or {}
        preferred_root = opts.get("folderId") or MEDIA_ROOT_FOLDER_ID
        deep = opts.get("deep", True) is not False
        ws_url = opts.get("wsUrl") or self.ws_file_url or self.ws_url
        return list_media_via_ws(
            ws_url or "",
            self.login or "",
            self.password or "",
            folder_id=preferred_root,
            deep=deep,
            timeout_ms=max(self.timeout_ms, 45000),
        )

    listMediaAssetsViaWebSocket = list_media_assets_via_websocket

    def _flatten_templates(self, raw: Any) -> list[Any]:
        if not raw:
            return []
        if isinstance(raw, list):
            out: list[Any] = []
            for t in raw:
                if not t:
                    continue
                if isinstance(t, dict) and t.get("id") and (
                    t.get("name") is not None or t.get("templateTypeInt") is not None
                ):
                    out.append(t)
                    continue
                if isinstance(t, dict) and isinstance(t.get("templates"), list):
                    out.extend(self._flatten_templates(t["templates"]))
                if isinstance(t, dict) and (
                    isinstance(t.get("templateGroups"), list)
                    or isinstance(t.get("groups"), list)
                ):
                    out.extend(
                        self._flatten_templates(t.get("templateGroups") or t.get("groups"))
                    )
            return out
        if isinstance(raw, dict) and (
            isinstance(raw.get("templates"), list) or isinstance(raw.get("items"), list)
        ):
            return self._flatten_templates(raw.get("templates") or raw.get("items"))
        return []

    def _unwrap_event(self, raw: Any) -> Any:
        if not raw:
            return raw
        if isinstance(raw, dict) and raw.get("event") and not raw.get("id"):
            event = dict(raw["event"])
            tpl = raw.get("template")
            if tpl and tpl.get("name") and not event.get("templateName"):
                event["templateName"] = tpl["name"]
            if tpl and tpl.get("id") and not event.get("templateId"):
                event["templateId"] = tpl["id"]
            return event
        if (
            isinstance(raw, dict)
            and raw.get("template")
            and raw["template"].get("name")
            and not raw.get("templateName")
        ):
            raw["templateName"] = raw["template"]["name"]
        return raw

    def _resolve_template_names(
        self,
        template_ids: list[str],
        seed_templates: Optional[list[Any]] = None,
    ) -> dict[str, str]:
        name_map: dict[str, str] = dict(self._template_name_cache)
        for t in seed_templates or []:
            if t and t.get("id"):
                name_map[t["id"]] = t.get("name") or ""
        missing: list[str] = []
        seen: dict[str, bool] = {}
        for tid in template_ids:
            if not tid or seen.get(tid):
                continue
            seen[tid] = True
            if tid in name_map:
                continue
            missing.append(tid)

        def fetch_one(tid: str) -> tuple[str, str]:
            try:
                t = self.get_template(tid)
                return tid, (t.get("name") if t and t.get("name") else "")
            except Exception:
                return tid, ""

        concurrency = 12
        for i in range(0, len(missing), concurrency):
            chunk = missing[i : i + concurrency]
            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                futs = [pool.submit(fetch_one, tid) for tid in chunk]
                for fut in as_completed(futs):
                    tid, name = fut.result()
                    name_map[tid] = name

        for k, v in name_map.items():
            self._template_name_cache[k] = v
        return name_map

    def list_playlist_events(self, playlist_id: str) -> list[dict[str, Any]]:
        """
        События, на которые ссылаются элементы сценария внутри плейлиста.

        Возвращает [{ event, item, story }] (уникальность по event.id).
        """
        pl = self.get_playlist(playlist_id)
        stories = []
        if pl:
            stories = pl.get("stories") or pl.get("scenarios") or []
        seed_templates = (pl.get("templates") if pl else None) or []
        seen: dict[str, bool] = {}
        out: list[dict[str, Any]] = []
        template_ids: list[str] = []

        for st in stories:
            items = st.get("items")
            if not items:
                full = self.get_story(st["id"])
                items = full.get("items") if full else []
            for item in items or []:
                event_id = item.get("eventId") if item else None
                if not event_id or seen.get(event_id):
                    continue
                seen[event_id] = True
                try:
                    event = self._unwrap_event(self.get_event(event_id))
                except Exception as err:
                    event = {
                        "id": event_id,
                        "name": item.get("eventName") or event_id,
                        "_fetchError": str(err),
                    }
                if event and event.get("templateId"):
                    template_ids.append(event["templateId"])
                out.append(
                    {
                        "event": event,
                        "item": item,
                        "story": {"id": st.get("id"), "name": st.get("name")},
                    }
                )

        top_events = (pl.get("events") if pl else None) or []
        for ev in top_events:
            if not ev or not ev.get("id") or seen.get(ev["id"]):
                continue
            seen[ev["id"]] = True
            if ev.get("templateId"):
                template_ids.append(ev["templateId"])
            out.append(
                {
                    "event": ev,
                    "item": {},
                    "story": {"id": "", "name": ""},
                }
            )

        name_by_id = self._resolve_template_names(template_ids, seed_templates)
        for row in out:
            ev = row.get("event")
            if not ev:
                continue
            if (
                not ev.get("templateName")
                and ev.get("templateId")
                and name_by_id.get(ev["templateId"])
            ):
                ev["templateName"] = name_by_id[ev["templateId"]]
        return out

    listPlaylistEvents = list_playlist_events

    def list_all_events(self, opts: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        """
        Все события из БД (GET /events), без привязки к плейлисту.

        Кэш 120 с (настраивается). Формат строк как у list_playlist_events.
        """
        opts = opts or {}
        force = bool(opts.get("force"))
        now = time.time() * 1000
        if (
            not force
            and self._all_events_cache is not None
            and (now - self._all_events_cache_at) < self._all_events_cache_ttl_ms
        ):
            return self._all_events_cache

        headers = self.list_events() or []

        try:
            seed_templates = self._flatten_templates(self.list_templates())
        except Exception:
            seed_templates = []

        out: list[dict[str, Any]] = []
        template_ids: list[str] = []
        need_detail: list[dict[str, Any]] = []

        for h in headers:
            h = h or {}
            event = {
                "id": h.get("id"),
                "name": h.get("name") or h.get("id"),
                "created": (
                    h["created"] if h.get("created") is not None else h.get("Created")
                ),
                "changed": (
                    h["changed"] if h.get("changed") is not None else h.get("Changed")
                ),
                "externalId": (
                    h["externalId"]
                    if h.get("externalId") is not None
                    else h.get("ExternalId")
                ),
                "templateId": h.get("templateId")
                or ((h.get("template") or {}).get("id") if h.get("template") else "")
                or "",
                "templateName": h.get("templateName")
                or ((h.get("template") or {}).get("name") if h.get("template") else "")
                or "",
            }
            if event["templateId"]:
                template_ids.append(event["templateId"])
            elif not event["templateName"]:
                need_detail.append(event)
            out.append({"event": event, "item": {}, "story": {"id": "", "name": ""}})

        if need_detail:

            def fetch_detail(event: dict[str, Any]) -> None:
                try:
                    full = self._unwrap_event(self.get_event(event["id"]))
                    if not full:
                        return
                    if full.get("name"):
                        event["name"] = full["name"]
                    if full.get("created") is not None:
                        event["created"] = full["created"]
                    if full.get("changed") is not None:
                        event["changed"] = full["changed"]
                    if full.get("externalId"):
                        event["externalId"] = full["externalId"]
                    if full.get("templateId"):
                        event["templateId"] = full["templateId"]
                    if full.get("templateName"):
                        event["templateName"] = full["templateName"]
                    if event.get("templateId"):
                        template_ids.append(event["templateId"])
                except Exception as err:
                    event["_fetchError"] = str(err)

            concurrency = 16
            for i in range(0, len(need_detail), concurrency):
                chunk = need_detail[i : i + concurrency]
                with ThreadPoolExecutor(max_workers=concurrency) as pool:
                    list(pool.map(fetch_detail, chunk))

        name_by_id = self._resolve_template_names(template_ids, seed_templates)
        for row in out:
            ev = row.get("event")
            if not ev:
                continue
            if (
                not ev.get("templateName")
                and ev.get("templateId")
                and name_by_id.get(ev["templateId"])
            ):
                ev["templateName"] = name_by_id[ev["templateId"]]

        self._all_events_cache = out
        self._all_events_cache_at = time.time() * 1000
        return out

    listAllEvents = list_all_events

    # ---------------- Плейлисты / истории ----------------

    def list_playlists(self) -> Any:
        """Список плейлистов."""
        return self._request("GET", "/playlists")

    listPlaylists = list_playlists

    def get_playlist(self, playlist_id: str) -> Any:
        """Получить плейлист по id."""
        return self._request("GET", "/playlists/" + quote(str(playlist_id), safe=""))

    getPlaylist = get_playlist

    def get_story(self, story_id: str) -> Any:
        """Получить историю/сценарий по id."""
        return self._request("GET", "/stories/" + quote(str(story_id), safe=""))

    getStory = get_story

    def get_item(self, item_id: str) -> Any:
        """Получить элемент сценария по id."""
        return self._request("GET", "/items/" + quote(str(item_id), safe=""))

    getItem = get_item

    def load_item(self, item_id: str) -> Any:
        """Прогрузить элемент (Unloaded → Loading → Ready)."""
        return self._request(
            "POST", "/items/" + quote(str(item_id), safe="") + "/load"
        )

    loadItem = load_item

    def take_in_item(self, item_id: str, body: Optional[dict[str, Any]] = None) -> Any:
        """Выдать в эфир. body: { timeStamp?, duration? }."""
        return self._request(
            "POST",
            "/items/" + quote(str(item_id), safe="") + "/takeIn",
            body or {},
        )

    takeInItem = take_in_item

    def take_out_item(self, item_id: str, body: Optional[dict[str, Any]] = None) -> Any:
        """Снять с эфира (Closing State). body: { timeStamp?}."""
        return self._request(
            "POST",
            "/items/" + quote(str(item_id), safe="") + "/takeOut",
            body or {},
        )

    takeOutItem = take_out_item

    def unload_item(self, item_id: str) -> Any:
        """Выгрузить элемент (освобождает память)."""
        return self._request(
            "POST", "/items/" + quote(str(item_id), safe="") + "/unload"
        )

    unloadItem = unload_item

# ===== excel_import =====
HEADER_NAME_ALIASES = {
    "name",
    "имя",
    "название",
    "event",
    "event name",
    "имя ивента",
    "имя события",
}

_GUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def is_media_type(type_name: Any) -> bool:
    return str(type_name or "").strip().lower() == "media"


def read_excel_rows(file_bytes: bytes) -> list[list[str]]:
    """
    Прочитать первый лист .xlsx/.xlsm как матрицу строк.

    Пустые строки в конце отбрасываются. Ячейки → строки.
    """
    if not file_bytes:
        raise ValueError("Пустой Excel-файл")

    try:
        wb = load_workbook(
            filename=io.BytesIO(file_bytes),
            read_only=True,
            data_only=True,
        )
    except Exception as err:  # noqa: BLE001
        raise ValueError(
            "Не удалось открыть Excel. Нужен .xlsx/.xlsm (не старый .xls)."
        ) from err

    try:
        ws = wb.active
        if ws is None:
            raise ValueError("В книге нет активного листа")
        rows: list[list[str]] = []
        for row in ws.iter_rows(values_only=True):
            cells = [_cell_str(c) for c in (row or ())]
            while cells and cells[-1] == "":
                cells.pop()
            if not any(cells):
                continue
            rows.append(cells)
    finally:
        wb.close()

    if not rows:
        raise ValueError("В Excel нет данных")
    return rows


def _looks_like_header(row: list[str]) -> bool:
    if not row:
        return False
    first = (row[0] or "").strip().lower()
    return first in HEADER_NAME_ALIASES


def rows_to_event_drafts(
    rows: list[list[str]],
    template: dict[str, Any],
    *,
    has_header: Optional[bool] = None,
) -> dict[str, Any]:
    """
    Преобразовать строки Excel в черновики ивентов.

    Колонки:
      1 — имя ивента
      2..N-1 — значения переменных шаблона (по порядку template.variables)
      N — External id

    Для Media-переменных в середине ожидается имя файла (не id;name).
    """
    if not rows:
        raise ValueError("Нет строк для импорта")

    skip_header = has_header
    if skip_header is None:
        skip_header = _looks_like_header(rows[0])

    data_rows = rows[1:] if skip_header else rows
    var_meta = list(template.get("variables") or [])
    template_id = template.get("id") or ""
    if not template_id:
        raise ValueError("У шаблона нет id")

    drafts: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for idx, row in enumerate(data_rows):
        excel_row = idx + (2 if skip_header else 1)
        if len(row) < 2:
            skipped.append(
                {
                    "row": excel_row,
                    "reason": "нужны минимум 2 столбца (имя и External id)",
                }
            )
            continue

        name = row[0]
        external_id = row[-1]
        mid = row[1:-1]

        if not name:
            skipped.append({"row": excel_row, "reason": "пустое имя"})
            continue

        variables: list[dict[str, Any]] = []
        for vi, meta in enumerate(var_meta):
            nv = dict(meta)
            if vi < len(mid) and mid[vi] != "":
                nv["value"] = mid[vi]
            else:
                nv["value"] = (
                    meta.get("value")
                    if meta.get("value") not in (None, "")
                    else (meta.get("defaultValue") or "")
                )
            variables.append(nv)

        drafts.append(
            {
                "name": name,
                "externalId": external_id,
                "templateId": template_id,
                "contentId": template.get("contentId") or "",
                "templateTypeInt": template.get("templateTypeInt"),
                "state": template.get("defaultInState") or "IN",
                "comment": "",
                "variables": variables,
                "_excelRow": excel_row,
            }
        )

    return {
        "drafts": drafts,
        "skipped": skipped,
        "headerSkipped": bool(skip_header),
        "variableCount": len(var_meta),
        "variableNames": [v.get("name") or "" for v in var_meta],
        "mediaVarIndexes": [
            i for i, v in enumerate(var_meta) if is_media_type(v.get("type"))
        ],
    }


def _norm_name(name: str) -> str:
    return os.path.basename(str(name or "").strip()).lower()


def _parse_media_value(raw: str) -> tuple[str, str]:
    s = str(raw or "").strip()
    if not s:
        return "", ""
    if ";" in s:
        aid, aname = s.split(";", 1)
        return aid.strip(), aname.strip()
    return s, ""


def index_assets_by_name(assets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Индекс ассетов по имени файла (lower) и stem без расширения."""
    index: dict[str, dict[str, Any]] = {}
    for asset in assets or []:
        name = str(asset.get("name") or "").strip()
        if not name:
            continue
        key = _norm_name(name)
        index.setdefault(key, asset)
        stem = Path(key).stem
        if stem and stem not in index:
            index[stem] = asset
    return index


def find_local_media_file(folder: str, filename: str) -> Optional[Path]:
    """
    Найти файл в папке по имени (с расширением или без).

    Только внутри folder (path traversal блокируется).
    """
    root = Path(folder).expanduser()
    if not root.is_dir():
        raise ValueError(f"Папка медиа не найдена: {folder}")

    root_resolved = root.resolve()
    wanted = os.path.basename(str(filename or "").strip())
    if not wanted or wanted in (".", ".."):
        return None

    candidate = (root / wanted).resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError as err:
        raise ValueError("Имя файла выходит за пределы папки медиа") from err

    if candidate.is_file():
        return candidate

    # без расширения — первое совпадение по stem
    stem = Path(wanted).stem.lower()
    if not stem:
        return None
    for path in sorted(root_resolved.iterdir()):
        if path.is_file() and path.stem.lower() == stem:
            return path
    return None


def resolve_media_in_drafts(
    drafts: list[dict[str, Any]],
    *,
    assets: list[dict[str, Any]],
    media_folder: Optional[str] = None,
    upload_file: Optional[Callable[[bytes, str], dict[str, Any]]] = None,
) -> dict[str, Any]:
    """
    Для Media-переменных: значение из Excel = имя файла.

    1) если уже «guid;name» — оставить
    2) если ассет с таким именем есть в Carrot — подставить id;name
    3) иначе искать в media_folder и upload_file(...)
    """
    index = index_assets_by_name(assets)
    resolved = 0
    uploaded = 0
    reused = 0
    missing: list[dict[str, Any]] = []
    folder = (media_folder or "").strip() or None

    for draft in drafts:
        excel_row = draft.get("_excelRow")
        for var in draft.get("variables") or []:
            if not is_media_type(var.get("type")):
                continue
            raw = "" if var.get("value") is None else str(var.get("value")).strip()
            if not raw:
                continue

            aid, aname = _parse_media_value(raw)
            if aid and _GUID_RE.match(aid):
                # уже готовое значение Carrot
                if aname:
                    var["value"] = f"{aid};{aname}"
                else:
                    var["value"] = aid
                resolved += 1
                continue

            filename = aname or aid or raw
            key = _norm_name(filename)
            hit = index.get(key) or index.get(Path(key).stem)
            if hit and hit.get("id"):
                var["value"] = f"{hit['id']};{hit.get('name') or filename}"
                resolved += 1
                reused += 1
                continue

            if not folder:
                missing.append(
                    {
                        "row": excel_row,
                        "variable": var.get("name"),
                        "file": filename,
                        "reason": "медиа нет в Carrot; укажи папку в Настройках",
                    }
                )
                continue

            if upload_file is None:
                missing.append(
                    {
                        "row": excel_row,
                        "variable": var.get("name"),
                        "file": filename,
                        "reason": "нет обработчика загрузки",
                    }
                )
                continue

            try:
                local = find_local_media_file(folder, filename)
            except ValueError as err:
                missing.append(
                    {
                        "row": excel_row,
                        "variable": var.get("name"),
                        "file": filename,
                        "reason": str(err),
                    }
                )
                continue

            if local is None:
                missing.append(
                    {
                        "row": excel_row,
                        "variable": var.get("name"),
                        "file": filename,
                        "reason": f"файл не найден в папке {folder}",
                    }
                )
                continue

            asset = upload_file(local.read_bytes(), local.name)
            index[_norm_name(asset.get("name") or local.name)] = asset
            stem = Path(_norm_name(asset.get("name") or local.name)).stem
            if stem:
                index.setdefault(stem, asset)
            var["value"] = f"{asset['id']};{asset.get('name') or local.name}"
            resolved += 1
            uploaded += 1

    return {
        "resolved": resolved,
        "uploaded": uploaded,
        "reused": reused,
        "missing": missing,
        # совместимость со старым UI
        "warnings": missing,
        "ok": not missing,
    }

__all__ = [
    "CarrotClient",
    "CarrotError",
    "ERROR_NAMES",
    "MEDIA_ROOT_FOLDER_ID",
    "decode_carrot_text",
    "read_excel_rows",
    "rows_to_event_drafts",
    "resolve_media_in_drafts",
]
