# -*- coding: utf-8 -*-
"""Кольцевой лог HTTP-трафика для DEV-панели."""

from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from typing import Any, Deque, Optional

_MAX = 300
_lock = threading.Lock()
_entries: Deque[dict[str, Any]] = deque(maxlen=_MAX)
_seq = 0


def _next_id() -> str:
    global _seq
    _seq += 1
    return f"{int(time.time() * 1000)}-{_seq}-{uuid.uuid4().hex[:6]}"


def _clip(value: Any, limit: int = 8000) -> Any:
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        return {
            "_type": "bytes",
            "size": len(value),
            "preview": bytes(value[:64]).hex(),
        }
    if isinstance(value, str):
        if len(value) > limit:
            return value[:limit] + f"… <+{len(value) - limit} chars>"
        return value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= 40:
                out["…"] = f"+{len(value) - 40} keys"
                break
            out[str(k)] = _clip(v, limit=2000)
        return out
    if isinstance(value, list):
        if len(value) > 30:
            return [_clip(x, limit=1000) for x in value[:30]] + [
                f"… +{len(value) - 30} items"
            ]
        return [_clip(x, limit=1000) for x in value]
    if isinstance(value, (int, float, bool)):
        return value
    return _clip(str(value), limit=limit)


def add(
    *,
    channel: str,
    method: str,
    url: str,
    status: Optional[int] = None,
    duration_ms: Optional[float] = None,
    request_headers: Optional[dict[str, Any]] = None,
    request_body: Any = None,
    response_headers: Optional[dict[str, Any]] = None,
    response_body: Any = None,
    error: Optional[str] = None,
    note: Optional[str] = None,
) -> dict[str, Any]:
    """Добавить запись трафика (UI↔Flask или Flask↔Carrot)."""
    # Не светим полный Bearer в панели
    safe_req_headers = None
    if request_headers:
        safe_req_headers = {}
        for k, v in request_headers.items():
            if str(k).lower() == "authorization" and v:
                s = str(v)
                safe_req_headers[k] = s[:18] + "…" if len(s) > 22 else s
            else:
                safe_req_headers[k] = v

    entry = {
        "id": _next_id(),
        "ts": time.time(),
        "channel": channel,  # ui | carrot
        "method": (method or "").upper(),
        "url": url,
        "status": status,
        "durationMs": round(duration_ms, 1) if duration_ms is not None else None,
        "requestHeaders": _clip(safe_req_headers),
        "requestBody": _clip(request_body),
        "responseHeaders": _clip(response_headers),
        "responseBody": _clip(response_body),
        "error": error,
        "note": note,
    }
    with _lock:
        _entries.appendleft(entry)
    return entry


def list_entries(
    *,
    after_id: Optional[str] = None,
    limit: int = 100,
    channel: Optional[str] = None,
) -> list[dict[str, Any]]:
    with _lock:
        items = list(_entries)
    if channel:
        items = [e for e in items if e.get("channel") == channel]
    if after_id:
        # вернуть только более новые, чем after_id (слева = новее)
        out: list[dict[str, Any]] = []
        for e in items:
            if e.get("id") == after_id:
                break
            out.append(e)
        items = out
    return items[: max(1, min(limit, _MAX))]


def clear() -> None:
    with _lock:
        _entries.clear()


def stats() -> dict[str, Any]:
    with _lock:
        n = len(_entries)
        carrot = sum(1 for e in _entries if e.get("channel") == "carrot")
        ui = sum(1 for e in _entries if e.get("channel") == "ui")
    return {"total": n, "carrot": carrot, "ui": ui, "capacity": _MAX}
