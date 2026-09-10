/* =====================================================================
   fitPlaska — растянуть solid-подложку по ширине текста
   ---------------------------------------------------------------------
   Меняет только scale.x подложки так, чтобы её видимая ширина стала равна
   ширине текста + отступы.

   Почему ширина солида передаётся параметром:
     - plaska.width / plaska.source.width движок не отдаёт;
     - plaska.sourceRectAtTime() у солида возвращает ширину НЕ в пикселях.
   Поэтому реальную ширину солида (в px при scale.x = 100) задаём числом —
   это фиксированный размер солида, его видно в его настройках.

   textLayer     — текстовый слой
   plaska        — слой-подложка (solid)
   plaskaWidthPx — ширина солида в пикселях при scale.x = 100
   pad           — отступ подложки по бокам от текста, px (необязательно, 0)
   ===================================================================== */

function fitPlaska(textLayer, plaska, plaskaWidthPx, pad)
{
    pad = pad || 0;

    // Видимая ширина текста (с учётом его собственного масштаба), px.
    var tScale = textLayer.transform.scale.value;
    var textW  = textLayer.sourceRectAtTime(false).width * (tScale[0] / 100);

    var pScale = plaska.transform.scale.value;
    var scaleX = (textW + pad * 2) / plaskaWidthPx * 100;

    // Защита от NaN/0/отрицательных — не трогаем scale.x, если расчёт некорректен.
    if (plaskaWidthPx > 0 && isFinite(scaleX) && scaleX > 0)
        plaska.transform.scale.setValue([scaleX, pScale[1], pScale[2] || 100]);
}

/* ---------------------------------------------------------------------
   Если не знаешь точную ширину солида — узнай её один раз логом
   (подставь текущий scale.x = 100 у солида и посмотри):

     writeLn("plaska sourceRect.width=" + plaska.sourceRectAtTime(false).width
           + "  scale.x=" + plaska.transform.scale.value[0]);

   Реальная ширина в px = видимая_ширина / (scale.x / 100). Либо просто
   возьми размер солида из его настроек.

   Пример вызова:
     fitPlaska(thisComp.layer("Name"), thisComp.layer("Plaska"), 1920, 30);
   --------------------------------------------------------------------- */
