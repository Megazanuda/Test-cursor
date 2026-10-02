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

/* =====================================================================
   Подчёркивание ОТДЕЛЬНОГО СЛОВА внутри одной строки (без дробления текста)
   ---------------------------------------------------------------------
   Текст остаётся ОДНИМ слоем. Чтобы узнать положение слова внутри строки,
   временно подставляем в тот же слой «префикс» (всё до слова) и
   «префикс+слово», замеряем ширину через sourceRectAtTime в том же кадре
   (движок обновляет замер сразу), затем возвращаем исходный текст.
   По двум ширинам получаем левый край и ширину слова и ставим под него линию.

   Ограничения (из-за того, что sourceRectAtTime даёт габариты всего слоя):
     - надёжно работает для ОДНОСТРОЧНОГО текста с выравниванием ПО ЛЕВОМУ краю;
     - для многострочного / центрированного / правого выравнивания положение
       слова по X так точно не вычислить;
     - подчёркивается первое вхождение слова.

   textLayer   — текстовый слой (одна строка, выравнивание слева)
   line        — слой-линия (solid), точка привязки по центру
   lineWidthPx — ширина линии-солида в px при scale.x = 100
   wordRegex   — что искать, напр. /[^\s]*www[^\s]*/i
   yOffset     — сдвиг линии вниз от низа текста, px (необязательно)
   ===================================================================== */

function hideLine(line)
{
    var z = line.transform.scale.value;
    line.transform.scale.setValue([0, z[1], z[2] || 100]);
}

function underlineWordInline(textLayer, line, lineWidthPx, wordRegex, yOffset)
{
    yOffset = yOffset || 0;

    var original = textLayer.text.sourceText;                 // сохраняем как есть (с тегами)
    var plain = (original ? original : "").replace(/<[^>]*>/g, "");

    var m = plain.match(wordRegex);
    if (!m) { hideLine(line); return; }

    var idx = plain.indexOf(m[0]);
    var prefix = plain.substring(0, idx);
    var word = m[0];

    // Замер префикса (левый отступ слова).
    textLayer.text.sourceText = prefix;
    var wPrefix = (prefix === "") ? 0 : textLayer.sourceRectAtTime(false).width;

    // Замер префикс+слово (правый край слова + габариты строки).
    textLayer.text.sourceText = prefix + word;
    var r = textLayer.sourceRectAtTime(false);

    // Возвращаем исходный текст (внутри кадра, до рендера — не мелькает).
    textLayer.text.sourceText = original;

    var wordLeft = r.left + wPrefix;      // левый край слова (координаты слоя)
    var wordW    = r.width - wPrefix;     // ширина слова
    if (wordW <= 0) { hideLine(line); return; }

    // Переводим в координаты композиции с учётом позиции/привязки/масштаба.
    var pos = textLayer.transform.position.value;
    var anc = textLayer.transform.anchorPoint.value;
    var sc  = textLayer.transform.scale.value;
    var sx = sc[0] / 100, sy = sc[1] / 100;

    var compW    = wordW * sx;
    var centerX  = pos[0] + (wordLeft + wordW / 2 - anc[0]) * sx;
    var bottomY  = pos[1] + (r.top + r.height - anc[1]) * sy;

    line.transform.position.setValue([centerX, bottomY + yOffset, 0]);

    var lsc = line.transform.scale.value;
    var scaleX = compW / lineWidthPx * 100;
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
