/* =====================================================================
   fitTickerPlate — зелёная подложка под текст бегущей строки
   ---------------------------------------------------------------------
   Отличие от fitPlaska: строка ЕДЕТ, поэтому подложку надо не только
   растянуть по ширине текста (+ отступы), но и КАЖДЫЙ КАДР держать под
   этим текстом по X (и по Y, если нужно).

   Что делает за один вызов:
     1) scale.x подложки  → видимая_ширина_текста + 2*pad;
     2) position.x подложки → центр текста в координатах композиции;
        (Y не трогаем — задай его один раз в самом слое; либо см. ALSO_Y ниже).

   Требования к солиду:
     - якорь (anchor) солида — по ЦЕНТРУ (тогда рост scale.x симметричный
       и центр солида совпадает с центром текста → отступы ровно по 26px);
     - plateWidthPx — реальная ширина солида в px при scale.x = 100
       (движок не отдаёт plate.width / sourceRectAtTime у солида — не в px).

   text        — текстовый слой строки
   plate       — слой-подложка (solid) под этим текстом
   plateWidthPx— ширина солида в px при scale.x = 100
   pad         — отступ по бокам, px (по умолчанию 26)
   ===================================================================== */

function fitTickerPlate(text, plate, plateWidthPx, pad)
{
    pad = (pad === undefined) ? 26 : pad;

    // Масштаб текста — видимая ширина/высота считаются с его учётом.
    var ts = text.transform.scale.value;
    var sx = ts[0] / 100;
    var sy = ts[1] / 100;

    var r = text.sourceRectAtTime(false);   // left/top/width/height в коорд. слоя

    // 1) Растяжка: ширина подложки = ширина текста + отступы с двух сторон.
    var plateW = r.width * sx + pad * 2;
    var scaleX = plateW / plateWidthPx * 100;

    var ps = plate.transform.scale.value;
    if (plateWidthPx > 0 && isFinite(scaleX) && scaleX > 0)
        plate.transform.scale.setValue([scaleX, ps[1], ps[2] || 100]);

    // 2) Позиция: центр текста в координатах композиции.
    //    sourceRect даёт габариты относительно якоря текста, position — сдвиг.
    var tp = text.transform.position.value;
    var centerX = tp[0] + (r.left + r.width  / 2) * sx;

    var pp = plate.transform.position.value;
    plate.transform.position.setValue([centerX, pp[1], pp[2] || 0]);

    /* ALSO_Y: если хочешь, чтобы подложка ещё и по вертикали шла по центру
       текста, раскомментируй:

       var centerY = tp[1] + (r.top + r.height / 2) * sy;
       plate.transform.position.setValue([centerX, centerY, pp[2] || 0]);
    */
}

/* ---------------------------------------------------------------------
   Как звать в бегущей строке
   ---------------------------------------------------------------------
   Подложку надо обновлять В ТОМ ЖЕ месте, где двигаются слои строки —
   т.е. внутри функции анимации (ticker_anim) или в ProcessFrame после
   того, как позиции текстов уже пересчитаны за этот кадр.

   Пример (каждый второй текст со своей зелёной подложкой):

     fitTickerPlate(thisComp.layer("Text 2"), thisComp.layer("Plate 2"), 400, 26);

   Если пар несколько — заведи массив пар и пройди циклом:

     var PAIRS = [
         [thisComp.layer("Text 2"), thisComp.layer("Plate 2")],
         [thisComp.layer("Text 4"), thisComp.layer("Plate 4")]
     ];
     for (var i = 0; i < PAIRS.length; i++)
         fitTickerPlate(PAIRS[i][0], PAIRS[i][1], 400, 26);

   Узнать plateWidthPx один раз логом (при scale.x = 100 у солида):
     writeLn("plate w=" + plate.sourceRectAtTime(false).width
             + " scale.x=" + plate.transform.scale.value[0]);
   реальная ширина px = видимая / (scale.x / 100).
   --------------------------------------------------------------------- */
