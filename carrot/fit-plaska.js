/* =====================================================================
   fitPlaska — растянуть solid-подложку по ширине текста
   ---------------------------------------------------------------------
   Меняет только scale.x подложки так, чтобы её видимая ширина стала равна
   ширине текста + отступы. Обе ширины берутся из sourceRectAtTime (это
   натуральная ширина без учёта собственного scale), поэтому функция
   идемпотентна — можно звать хоть каждый кадр.

   textLayer — текстовый слой
   plaska    — слой-подложка (solid/shape)
   pad       — отступ подложки по бокам от текста, px (необязательно, 0)
   ===================================================================== */

function fitPlaska(textLayer, plaska, pad)
{
    pad = pad || 0;

    // Видимая ширина текста (с учётом его собственного масштаба).
    var tScale = textLayer.transform.scale.value;
    var textW  = textLayer.sourceRectAtTime(false).width * (tScale[0] / 100);

    // Натуральная ширина подложки.
    var plW = plaska.sourceRectAtTime(false).width;
    var pScale = plaska.transform.scale.value;

    var scaleX = (textW + pad * 2) / plW * 100;

    // Защита от NaN/0/отрицательных — не трогаем scale.x, если расчёт некорректен.
    if (plW > 0 && isFinite(scaleX) && scaleX > 0)
        plaska.transform.scale.setValue([scaleX, pScale[1], pScale[2] || 100]);
}
