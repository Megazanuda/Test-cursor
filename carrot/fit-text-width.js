/* =====================================================================
   fitTextWidth — универсальная подгонка масштаба текста под ширину
   ---------------------------------------------------------------------
   Вставляется в любой скрипт Carrot Broadcast. Если натуральная ширина
   текста больше maxWidth — уменьшает масштаб слоя так, чтобы текст ровно
   влез в maxWidth; если и так помещается — возвращает масштаб к 100%.

   Особенности:
     - меряет НАТУРАЛЬНУЮ ширину (sourceRectAtTime, без учёта собственного
       scale слоя), поэтому идемпотентна — можно звать хоть каждый кадр,
       результат не «уплывает»;
     - только уменьшает, никогда не увеличивает текст;
     - по умолчанию масштабирует равномерно (сохраняет пропорции);
     - поддерживает оба API: и прямое присваивание transform.scale = [...],
       и transform.scale.setValue([...]);
     - защищена от NaN / нулевой / отрицательной ширины.

   Параметры:
     layer      — текстовый слой (thisComp.layer("..") или comp.layer(".."))
     maxWidth   — максимальная ширина в пикселях
     keepHeight — (необязательно) true = сжимать только по ширине,
                  высоту не трогать (по умолчанию false = равномерно)

   Возвращает применённый масштаб в процентах (или undefined, если мерить нечего).

   Примеры:
     fitTextWidth(thisComp.layer("Comment 1"), 1180);
     fitTextWidth(comp.layer("MainText"), 1000);
     fitTextWidth(preComp.layer("Line1"), 900, true); // только по ширине
   ===================================================================== */

function fitTextWidth(layer, maxWidth, keepHeight)
{
    if (!layer || !(maxWidth > 0))
        return;

    // 1) Натуральная ширина контента слоя (без учёта его собственного scale).
    var w = 0;
    try {
        w = layer.sourceRectAtTime(false).width;
    } catch (e) {
        try { w = layer.sourceRectAtTime().width; } catch (e2) { return; }
    }
    if (!(w > 0))
        return;

    // 2) Нужный масштаб: уменьшаем, только если не влезает, иначе 100%.
    var pct = (w > maxWidth) ? (maxWidth / w) * 100 : 100;

    // 3) Читаем текущий scale (поддержка обоих API: массив или свойство с .value).
    var sc  = layer.transform.scale;
    var cur = (sc && sc.value) ? sc.value : sc;

    // 4) Собираем новое значение, сохраняя размерность (2D/3D) и, при keepHeight, высоту.
    var y = keepHeight ? ((cur && cur.length > 1) ? cur[1] : 100) : pct;
    var next;
    if (cur && cur.length === 2)
        next = [pct, y];
    else
        next = [pct, y, (cur && cur.length > 2) ? cur[2] : 100];

    // 5) Пишем scale (поддержка обоих API: setValue или прямое присваивание).
    if (sc && typeof sc.setValue === "function")
        sc.setValue(next);
    else
        layer.transform.scale = next;

    return pct;
}
