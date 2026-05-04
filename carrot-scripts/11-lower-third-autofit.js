// 11. Lower Third Autofit
//
// Парсит MainText, режет на строки, лишнее склеивает в последнюю,
// считает автошрифт/трекинг и пишет их напрямую в TextLine 1..3
// через l.TextSource.*, гасит пустые слоты по opacity,
// двигает Null по Y относительно константы BASE_Y под число строк.

var MAX_CHARS = 40, MAX_LINES = 3;
var BASE_SIZE = 49, MIN_SIZE = 25, MIN_TRACK = -50;
var SHIFT_1 = 20, SHIFT_N = 15;

// Поставь сюда X и Y позиции Null-слоя в AE при 3 строках (как он стоит в шаблоне).
var BASE_X = 960;
var BASE_Y = 540;

var comp  = app.project.item("Comp 1");
var src   = comp.layer("MainText");
var nul   = comp.layer("Null 1");
var slots = ["TextLine 1", "TextLine 2", "TextLine 3"];

var lines = [];
var raw = src.TextSource.Text.split(/[\r\n]+/);
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
var tracking = MIN_TRACK * (1 - k);

for (i = 0; i < slots.length; i++) {
    var l = comp.layer(slots[i]);
    var on = i < lines.length;
    var ts = l.TextSource;
    ts.Text = on ? lines[i] : "";
    ts.FontSize = size;
    ts.Tracking = tracking;
    l.transform.opacity.setValue(on ? 100 : 0);
}

var shift = (lines.length === 1 ? SHIFT_1 : SHIFT_N) * (MAX_LINES - lines.length);
var newY = BASE_Y + shift;
nul.transform.position.setValue([BASE_X, newY, 0]);
alert("lines=" + lines.length + " shift=" + shift + " newY=" + newY + " actualY=" + nul.transform.position.value[1]);
