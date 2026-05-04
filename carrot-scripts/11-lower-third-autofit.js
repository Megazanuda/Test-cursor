// 11. Lower Third Autofit (минимальная версия)
//
// Парсит текст из MainText, режет на строки, лишнее склеивает в последнюю,
// автоуменьшает шрифт/трекинг, публикует результат в local.*,
// гасит неиспользуемые TextLine-слоты через opacity, сдвигает Null по Y.
//
// На слоях TextLine 1/2/3 должны стоять AE-выражения на Source Text:
//     local.lines[0]   // для TextLine 1
//     local.lines[1]   // для TextLine 2
//     local.lines[2]   // для TextLine 3
// И аналогично на Font Size / Tracking - local.finalSize / local.finalTracking.
//
// Примечание: в Carrot text.sourceText возвращает строку напрямую (не Property),
// поэтому .setValue() на нём не работает - текст прокидывается выражениями.

var MAX_CHARS = 40, MAX_LINES = 3;
var BASE_SIZE = 49, MIN_SIZE = 25, MIN_TRACK = -50;
var SHIFT_1 = 20, SHIFT_N = 15;

var comp  = app.project.item("Comp 1");
var src   = comp.layer("MainText");
var nul   = comp.layer("Null 1");
var slots = ["TextLine 1", "TextLine 2", "TextLine 3"];

var lines = [];
var raw = src.text.sourceText.split(/[\r\n]+/);
for (var i = 0; i < raw.length; i++) {
    var t = raw[i].replace(/^\s+|\s+$/g, "");
    if (t) lines.push(t);
}
if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES - 1).concat(lines.slice(MAX_LINES - 1).join(" "));
}

var longest = 0;
for (i = 0; i < lines.length; i++)
    if (lines[i].length > longest) longest = lines[i].length;

var size = longest > MAX_CHARS
    ? Math.max(MIN_SIZE, BASE_SIZE * MAX_CHARS / longest)
    : BASE_SIZE;
var k = (size - MIN_SIZE) / (BASE_SIZE - MIN_SIZE);

local.lines         = lines;
local.finalSize     = size;
local.finalTracking = MIN_TRACK * (1 - k);

for (i = 0; i < slots.length; i++) {
    comp.layer(slots[i]).transform.opacity.setValue(i < lines.length ? 100 : 0);
}

if (local.baseY === undefined) {
    var p = nul.transform.position.value;
    local.baseX = p[0];
    local.baseY = p[1];
}
var shift = (lines.length === 1 ? SHIFT_1 : SHIFT_N) * (MAX_LINES - lines.length);
nul.transform.position.setValue([local.baseX, local.baseY + shift, 0]);
