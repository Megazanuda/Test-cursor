// Скрипт: считает количество строк в текстовом слое, выставляет ему scale
// по формуле "1-2 строки = 100%, дальше 172/N", и сдвигает слой вправо
// на SHIFT_X пикселей, если контрольная переменная равна нулю.

// === Параметры (поправь под свой проект) ===
var COMP_NAME  = "Comp 1";    // имя композиции
var LAYER_NAME = "MainText";  // имя текстового слоя

// Базовая X-позиция слоя (нейтральная, до возможного сдвига).
// Скрипт всегда выставляет X = BASE_X + сдвиг, поэтому здесь должна быть
// та X, в которой слой стоит, когда CONTROL_VAR != 0.
var BASE_X = 960;

// На сколько пикселей сдвинуть слой вправо, когда CONTROL_VAR == 0
var SHIFT_X = 50;

// Y-позиция в зависимости от количества строк.
// Якорь у слоя выставлен в After Effects в правый нижний угол.
//   1-3 строки   → Y = BASE_Y
//   4 строки     → Y = BASE_Y + Y_STEP
//   5 строк      → Y = BASE_Y + Y_STEP * 2
//   ...
// На пользовательских измерениях: 2-3 строки → 955, 4 строки → 966.
var BASE_Y = 955;
var Y_STEP = 11;
var Y_STEP_FROM = 3; // прибавлять Y_STEP начиная со строки (Y_STEP_FROM + 1)

// Контрольная переменная. Подставь сюда нужный источник значения:
//   - просто число (как сейчас, для проверки);
//   - значение слайдера: comp.layer("Controls").effect("Flag")(1).value;
//   - любое другое выражение/вычисление.
var CONTROL_VAR = 0;

// === Логика ===
var comp = app.project.item(COMP_NAME);
var txt  = comp.layer(LAYER_NAME);

// 1. Считаем количество непустых строк в тексте
var raw = txt.TextSource.Text.split(/[\r\n]+/);
var nLines = 0;
for (var i = 0; i < raw.length; i++) {
    if (raw[i].trim().length > 0) nLines++;
}
if (nLines < 1) nLines = 1;

// 2. Скейл: 100% для 1-2 строк, 172/N для большего числа строк
//    (3 -> 57.33, 4 -> 43, 5 -> 34.4, 6 -> 28.67 и т.д.)
var scalePct = nLines <= 2 ? 100 : 172 / nLines;
var oldScale = txt.transform.scale.value;
txt.transform.scale.setValue([scalePct, scalePct, oldScale[2] || 100]);

// 3. Позиция:
//    X = BASE_X + сдвиг (если CONTROL_VAR == 0)
//    Y = BASE_Y + Y_STEP * (nLines - Y_STEP_FROM), но не меньше BASE_Y
var newX = BASE_X + (CONTROL_VAR === 0 ? SHIFT_X : 0);
var extraLines = nLines - Y_STEP_FROM;
if (extraLines < 0) extraLines = 0;
var newY = BASE_Y + Y_STEP * extraLines;
var pos  = txt.transform.position.value;
txt.transform.position.setValue([newX, newY, pos[2] || 0]);

writeLn("nLines=" + nLines + " scalePct=" + scalePct + " CONTROL_VAR=" + CONTROL_VAR + " posX=" + newX + " posY=" + newY);
