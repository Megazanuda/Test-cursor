// Скрипт: считает количество строк в текстовом слое, выставляет ему scale
// по формуле "1-2 строки = 100%, дальше 172/N", и сдвигает слой вправо
// на SHIFT_X пикселей, если контрольная переменная равна нулю.

// === Параметры (поправь под свой проект) ===
var COMP_NAME  = "Comp 1";    // имя композиции
var LAYER_NAME = "MainText";  // имя текстового слоя

// Базовая X-позиция слоя (нейтральная, до возможного сдвига).
// Скрипт всегда выставляет X = BASE_X + сдвиг, поэтому здесь должна быть
// та позиция, в которой слой стоит, когда CONTROL_VAR != 0.
var BASE_X = 960;

// На сколько пикселей сдвинуть слой вправо, когда CONTROL_VAR == 0
var SHIFT_X = 50;

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

// 3. Сдвиг позиции вправо, если контрольная переменная равна 0.
//    Y не трогаем — берём текущее значение слоя.
var pos  = txt.transform.position.value;
var newX = BASE_X + (CONTROL_VAR === 0 ? SHIFT_X : 0);
txt.transform.position.setValue([newX, pos[1], pos[2] || 0]);

writeLn("nLines=" + nLines + " scalePct=" + scalePct + " CONTROL_VAR=" + CONTROL_VAR + " posX=" + newX);
