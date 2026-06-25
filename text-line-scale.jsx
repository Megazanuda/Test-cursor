// Скрипт для текстового слоя с динамическим количеством строк.
// - Скейл текста: 100% при 1-2 строках, 172/N при N>=3.
// - Позиция компенсируется так, чтобы визуальный правый нижний угол текста
//   всегда оказывался в (BASE_X, BASE_Y) независимо от того, сколько в тексте
//   строк и какой у слоя стоит якорь.

// === Параметры (поправь под свой проект) ===
var COMP_NAME  = "Comp 1";    // имя композиции
var LAYER_NAME = "text";      // имя текстового слоя

// Куда должен попадать визуальный правый нижний угол ТЕКСТА
// (low-right corner of source rect, т.е. низ descender'ов последней строки).
// Эти координаты — РЕАЛЬНЫЕ комп-координаты, а не значение position.y из инспектора.
// Если ты раньше калибровал текст так, что position.y = 955 давало правильный визуал,
// и diagnostic показал brOffsetY = 31.5 при scale=1.0, то реальный визуальный низ был
// 955 + 31.5 = 986.5 — именно это и надо подставить сюда.
var BASE_X = 1577;
var BASE_Y = 986.5;

// На сколько пикселей сдвинуть слой вправо, когда control > 5
var SHIFT_X = 125;

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
//    Геометрия в After Effects: visible_bottom_right (в координатах комп) =
//        position + (sourceRectBottomRight - anchorPoint) * scale
//    Решаем относительно position, фиксируя видимый угол в (BASE_X, BASE_Y):
//        position = (BASE_X, BASE_Y) - (sourceRectBR - anchor) * scale
//    Якорь у нас никуда не двигается — мы только читаем его значение и
//    подстраиваем под него position так, чтобы низ source rect всегда
//    оказывался в одной и той же точке кадра.
var srcRect   = txt.sourceRectAtTime(false);
var anchor    = txt.transform.anchorPoint.value;
var brOffsetX = (srcRect.left + srcRect.width)  - anchor[0];
var brOffsetY = (srcRect.top  + srcRect.height) - anchor[1];
var scaleNow  = txt.transform.scale.value;
var sx        = scaleNow[0] / 100;
var sy        = scaleNow[1] / 100;

var pos  = txt.transform.position.value;
var newX = BASE_X + (control > 5 ? SHIFT_X : 0) - brOffsetX * sx;
var newY = BASE_Y                                - brOffsetY * sy;
txt.transform.position.setValue([newX, newY, pos[2] || 0]);
