// 11. Lower Third Autofit (размер через transform.scale)
//
// Парсит MainText, режет на строки, лишнее склеивает в последнюю,
// масштабирует TextLine 1..3 через transform.scale при длинном тексте,
// гасит пустые слоты по opacity, двигает Null по Y под число строк.
//
// Базовый размер шрифта задаётся в After Effects - скрипт только масштабирует
// от 100% вниз до MIN_SCALE%.
//
// Следи за Anchor Point на TextLine 1..3: масштаб идёт от него.

var MAX_CHARS = 40, MAX_LINES = 3;
var MIN_SCALE = 51;
var SHIFT_1 = 20, SHIFT_N = 15;

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

var scalePct = longest > MAX_CHARS
    ? Math.max(MIN_SCALE, 100 * MAX_CHARS / longest)
    : 100;

for (i = 0; i < slots.length; i++) {
    var l = comp.layer(slots[i]);
    var on = i < lines.length;
    l.TextSource.Text = on ? lines[i] : "";
    l.transform.scale.setValue([scalePct, scalePct, 100]);
    l.transform.opacity.setValue(on ? 100 : 0);
}

var shift = (lines.length === 1 ? SHIFT_1 : SHIFT_N) * (MAX_LINES - lines.length);
nul.transform.position.setValue([BASE_X, BASE_Y + shift, 0]);
