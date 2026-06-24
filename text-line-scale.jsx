// Скрипт для текстового слоя с динамическим количеством строк.
// - Скейл текста: 100% при 1-2 строках, 172/N при N>=3.
// - Позиция компенсируется так, чтобы визуальный правый нижний угол текста
//   всегда оказывался в (BASE_X, BASE_Y) независимо от того, сколько в тексте
//   строк и какой у слоя стоит якорь.

// === Параметры (поправь под свой проект) ===
var COMP_NAME  = "Comp 1";    // имя композиции
var LAYER_NAME = "text";      // имя текстового слоя

// Куда должен попадать визуальный правый нижний угол текста.
// Эти координаты задаются один раз — скрипт сам считает, какую position
// присвоить слою, чтобы реально видимый bottom-right оказался ровно тут.
var BASE_X = 1577;
var BASE_Y = 955;

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
//    Якорь у тебя зафиксирован вручную (в правом нижнем углу при том количестве
//    строк, при котором ты настраивал). source rect меняется при смене текста,
//    поэтому при 3+ строках появляется ненулевая разница (sourceRectBR - anchor),
//    и position нужно компенсировать, чтобы видимый bottom-right всё равно
//    попал в (BASE_X, BASE_Y).
//
//    Для 2-строчного случая (под который и настраивался якорь) разница нулевая,
//    компенсация нулевая, position = (BASE_X, BASE_Y) — текст стоит ровно там,
//    где ты его выставлял изначально.
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
