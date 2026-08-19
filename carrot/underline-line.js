/* =====================================================================
   Подчёркивание текста в Carrot — линией (solid), а не разметкой
   ---------------------------------------------------------------------
   ВЫВОД ПО ДОКУМЕНТАЦИИ И ТЕСТАМ:
     - тип RichText в Carrot поддерживает только <font color="…">
       (руководство «Работа со сторонним ПО»);
     - в объектной модели у текста есть только text.sourceText
       (scripting/reference-guide.md) — свойств подчёркивания нет;
     - <u>, text-decoration и combining-символ U+0332 движок НЕ рендерит.
   => Подчёркивание средствами текста невозможно. Рисуем линию слоем.

   Приём согласован с базой знаний Carrot (солид под размер текста):
   ширину солида задаём числом, т.к. sourceRectAtTime() не учитывает scale.

   Подчёркивает ВЕСЬ текстовый слой. Для отдельной ссылки вынеси её
   на отдельный текстовый слой.

   textLayer   — текстовый слой
   line        — слой-линия (solid)
   lineWidthPx — реальная ширина линии-солида в px при scale.x = 100
   yOffset     — сдвиг линии вниз от низа текста, px (необязательно)
   ===================================================================== */

function underlineLayer(textLayer, line, lineWidthPx, yOffset)
{
    yOffset = yOffset || 0;

    var rect = textLayer.sourceRectAtTime(false);
    var pos  = textLayer.transform.position.value;
    var anc  = textLayer.transform.anchorPoint.value;
    var sc   = textLayer.transform.scale.value;
    var sx = sc[0] / 100, sy = sc[1] / 100;

    // Габариты и положение текста в координатах композиции.
    var visW    = rect.width * sx;
    var leftX   = pos[0] + (rect.left - anc[0]) * sx;
    var centerX = leftX + visW / 2;
    var bottomY = pos[1] + (rect.top + rect.height - anc[1]) * sy;

    // Пустой текст -> прячем линию (scale.x = 0).
    if (visW <= 0)
    {
        var z = line.transform.scale.value;
        line.transform.scale.setValue([0, z[1], z[2] || 100]);
        return;
    }

    // Ставим линию по центру под текстом и растягиваем по ширине текста.
    line.transform.position.setValue([centerX, bottomY + yOffset, 0]);

    var lsc = line.transform.scale.value;
    var scaleX = visW / lineWidthPx * 100;
    if (lineWidthPx > 0 && isFinite(scaleX) && scaleX > 0)
        line.transform.scale.setValue([scaleX, lsc[1], lsc[2] || 100]);
}

/* ---------------------------------------------------------------------
   ВАРИАНТ БЕЗ СКРИПТА — выражения на слое-линии (как в базе знаний Carrot).
   Точку привязки (Anchor Point) линии-солида выставь по выравниванию текста.

   // Выражение на свойстве Scale линии-солида (тянет ширину по тексту):
   //   var t = thisComp.layer("URL");
   //   var solidW = 512;               // ширина линии-солида при создании
   //   var w = t.sourceRectAtTime().width;
   //   [ (w > 0 ? w / solidW * 100 : 0), value[1] ]

   // Позицию линии проще задать привязкой (parent) линии к текстовому слою
   // либо к нулю, чтобы линия ехала вместе с текстом; по Y — фикс. отступ.
   --------------------------------------------------------------------- */
