"""Синхронные WebSocket-хелперы Carrot (websocket-client)."""

from __future__ import annotations

import re
import threading
import uuid
from typing import Any, Callable, Optional

import websocket

from .errors import CarrotError
from .util import (
    MEDIA_EMPTY_FOLDER_ID,
    MEDIA_MAX_FOLDERS,
    MEDIA_ROOT_FOLDER_ID,
    decode_carrot_text,
    xml_escape,
    xml_field,
)


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
