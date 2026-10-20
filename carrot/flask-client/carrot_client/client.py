"""CarrotClient — синхронный REST/WS-клиент Carrot Broadcast."""

from __future__ import annotations

import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote, urlencode

import requests

from .errors import ERROR_NAMES, CarrotError
from .util import (
    MEDIA_EMPTY_FOLDER_ID,
    MEDIA_MAX_FOLDERS,
    MEDIA_ROOT_FOLDER_ID,
    default_ws_url_from_base,
    normalize_base_url,
)
from . import ws as ws_mod


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
    if code == "ECONNREFUSED" or "Connection refused" in detail:
        hint = (
            " На этом адресе никто не слушает. В .env порт 8080 — заглушка, "
            "поставь реальный URL REST API Carrot (не порты 24710/24712)."
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
    ) -> Any:
        if auth:
            self._ensure_token()

        url = self.base_url + path + self._envelope_query()
        headers = {"Content-Type": "application/json"}
        if auth and self.token:
            headers["Authorization"] = "Bearer " + self.token

        timeout_s = self.timeout_ms / 1000.0
        last_err: Optional[CarrotError] = None

        for attempt in range(self.max_retries + 1):
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
                        method, path, body, auth=auth, _retried_auth=True
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
                if _FATAL_NET.match(wrapped.code or "") or attempt >= self.max_retries:
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
        return ws_mod.delete_event_via_ws(
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
        return ws_mod.create_events_via_ws(
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
        return ws_mod.list_media_via_ws(
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
