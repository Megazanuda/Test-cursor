/* =====================================================================
   Центрирование строки из нескольких текстовых слоёв по X
   ---------------------------------------------------------------------
   Несколько слоёв (напр. Дата + Время) держим как единую группу,
   отцентрованную по заданной X-координате, независимо от их ширины.

   Логика: складываем видимые ширины слоёв + зазоры между ними, от центра
   отступаем половину общей ширины влево (левый край группы), затем
   раскладываем слои слева направо, ставя каждому нужный левый край.

   Ширина берётся из sourceRectAtTime (с учётом собственного масштаба слоя),
   поэтому пересчёт корректен при любой длине текста.
   ===================================================================== */

// Видимая ширина текста слоя, px.
function visWidth(layer)
{
    return layer.sourceRectAtTime(false).width * (layer.transform.scale.value[0] / 100);
}

// Ставит слой так, чтобы ЛЕВЫЙ край его текста оказался на compX (по X).
function setLeftEdge(layer, compX)
{
    var rect = layer.sourceRectAtTime(false);
    var pos  = layer.transform.position.value;
    var anc  = layer.transform.anchorPoint.value;
    var sx   = layer.transform.scale.value[0] / 100;

    // left(comp) = position.x + (rect.left - anchor.x) * scale  =>  решаем относительно position.x
    var newX = compX - (rect.left - anc[0]) * sx;
    layer.transform.position.setValue([newX, pos[1], pos[2] || 0]);
}

// Центрирует массив слоёв как строку по центру centerX с зазором gap между ними.
function centerRowX(layers, centerX, gap)
{
    var widths = [];
    var total = 0;

    for (var i = 0; i < layers.length; i++)
    {
        widths[i] = visWidth(layers[i]);
        total += widths[i];
    }
    total += gap * (layers.length - 1);

    var x = centerX - total / 2;   // левый край группы

    for (var j = 0; j < layers.length; j++)
    {
        setLeftEdge(layers[j], x);
        x += widths[j] + gap;
    }
}


/* =====================================================================
   ВЫЗОВ (в SetState — при смене текста, или в ProcessFrame — если
   время обновляется каждую секунду).
   Поменяй имена слоёв, координату центра и зазор под себя.
   ===================================================================== */

centerRowX([thisComp.layer("Date"), thisComp.layer("Time")], 1117, 20);
