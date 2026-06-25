// Скрипт для текстового слоя с динамическим количеством строк.
// - Скейл текста: 100% при 1-2 строках, 172/N при N>=3.
// - Позиция компенсируется так, чтобы визуальный ВЕРХНИЙ-правый угол source rect
//   текста всегда оказывался в (BASE_X, TARGET_TOP_Y), независимо от количества
//   строк и скейла. Текст с большим количеством строк "растёт вниз", не уезжая
//   при этом ни верхом, ни правым краем.

// === Параметры (поправь под свой проект) ===
var COMP_NAME  = "Comp 1";    // имя композиции
var LAYER_NAME = "text";      // имя текстового слоя

// X — правый край текста в координатах композиции.
var BASE_X = 1577;

// Y — координата, в которую попадает ВЕРХ source rect текста (верх caps первой строки)
// в координатах композиции. При смене количества строк верх остаётся фиксированным,
// текст "растёт вниз".
//
// Откуда взять значение:
//   TARGET_TOP_Y = position.y_калибровки + (srcRect.top - anchor.y) * scale.y/100
// Для пользователя при 2 строках:
//   position.y_калибровки = 955
//   srcRect.top  = -26.344
//   anchor.y     = 38.478
//   scale.y/100  = 1.0
//   => TARGET_TOP_Y = 955 + (-26.344 - 38.478) * 1.0 = 890.178
var TARGET_TOP_Y = 890.178;

// На сколько пикселей сдвинуть слой вправо, когда control > 5
var SHIFT_X = 125;

// Дополнительный сдвиг вниз для каждой строки сверх Y_SHIFT_FROM_LINES.
// Накладывается ПОВЕРХ геометрической компенсации (которая фиксирует верх текста).
// Нужен потому, что scale-формула 172/N даёт константную видимую высоту текста при N>=3,
// и 4-строчный текст без этого сдвига выглядит точно так же, как 3-строчный.
// Поставь 0 — никакого дополнительного смещения. Поставь 10-20 — 4+ строки начнут уходить вниз.
var Y_SHIFT_PER_EXTRA_LINE = 15;
var Y_SHIFT_FROM_LINES     = 3;

// === Внешняя логика Carrot Broadcast ===
ageRating = thisComp.layer("variable").TextSource.Text;
EnabledRating(ageRating);

// === Логика ===
var comp = app.project.item(COMP_NAME);
var txt  = comp.layer(LAYER_NAME);

// 1. Считаем количество непустых строк
var raw = txt.TextSource.Text.split(/[\r\n]+/);
var nLines = 0;
for (var i = 0; i < raw.length; i++) {
    if (raw[i].trim().length > 0) nLines++;
}
if (nLines < 1) nLines = 1;

// 2. Скейл: 100% для 1-2 строк, 172/N для большего числа строк
//    (3 -> 57.33, 4 -> 43, 5 -> 34.4 и т.д.)
var scalePct = nLines <= 2 ? 100 : 172 / nLines;
var oldScale = txt.transform.scale.value;
txt.transform.scale.setValue([scalePct, scalePct, oldScale[2] || 100]);

// 3. Считаем компенсацию позиции.
//    Геометрия в After Effects:
//        visible_top   = position.y + (srcRect.top    - anchor.y) * scale
//        visible_right = position.x + (srcRect.right  - anchor.x) * scale
//    Решаем относительно position, фиксируя видимый верх в TARGET_TOP_Y
//    и видимый правый край в BASE_X:
//        position.y = TARGET_TOP_Y + (anchor.y - srcRect.top)   * scale
//        position.x = BASE_X       + (anchor.x - srcRect.right) * scale
//    Якорь у нас никуда не двигается — мы только читаем его значение.
var srcRect    = txt.sourceRectAtTime(false);
var anchor     = txt.transform.anchorPoint.value;
var scaleNow   = txt.transform.scale.value;
var sx         = scaleNow[0] / 100;
var sy         = scaleNow[1] / 100;
var srcRight   = srcRect.left + srcRect.width;
var srcTop     = srcRect.top;

var extraLines = nLines - Y_SHIFT_FROM_LINES;
if (extraLines < 0) extraLines = 0;
var manualYShift = extraLines * Y_SHIFT_PER_EXTRA_LINE;

var pos  = txt.transform.position.value;
var newX = BASE_X        + (control > 5 ? SHIFT_X : 0) + (anchor[0] - srcRight) * sx;
var newY = TARGET_TOP_Y                                + (anchor[1] - srcTop)   * sy + manualYShift;
txt.transform.position.setValue([newX, newY, pos[2] || 0]);
