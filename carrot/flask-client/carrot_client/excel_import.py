# -*- coding: utf-8 -*-
"""Разбор Excel для массового создания ивентов Carrot."""

from __future__ import annotations

import io
from typing import Any, Optional

from openpyxl import load_workbook

HEADER_NAME_ALIASES = {
    "name",
    "имя",
    "название",
    "event",
    "event name",
    "имя ивента",
    "имя события",
}


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


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
            # обрезать хвостовые пустые
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

    Если has_header=None, первая строка пропускается при похожести на заголовок.
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
    }
