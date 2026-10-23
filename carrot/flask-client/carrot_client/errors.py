"""Ошибки REST/WS-клиента Carrot Broadcast."""

from __future__ import annotations

from typing import Any, Optional

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
