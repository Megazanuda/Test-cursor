"""Вспомогательные функции клиента Carrot."""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

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
