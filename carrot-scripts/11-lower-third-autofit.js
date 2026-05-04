// 11. Lower Third Autofit
//
// Парсит MainText, режет на строки, лишнее склеивает в последнюю,
// считает автошрифт/трекинг и пишет их в первый Text Animator каждого
// из TextLine 1..3, гасит пустые слоты по opacity, сдвигает Null по Y.
//
// Требование к шаблону: на каждом слое TextLine 1..3 должен быть один
// Text Animator ("Animator 1") со свойствами Font Size и Tracking Amount.

var MAX_CHARS = 40, MAX_LINES = 3;
var BASE_SIZE = 49, MIN_SIZE = 25, MIN_TRACK = -50;
var SHIFT_1 = 20, SHIFT_N = 15;

var comp  = app.project.item("Comp 1");
var src   = comp.layer("MainText");
var nul   = comp.layer("Null 1");
var slots = ["TextLine 1", "TextLine 2", "TextLine 3"];

// === СБРОС КЭША позиции Null (раскомментировать один раз, если Null двигали вручную) ===
// local.baseY = undefined;

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
var tracking = MIN_TRACK * (1 - k);

for (i = 0; i < slots.length; i++) {
    var l = comp.layer(slots[i]);
    var on = i < lines.length;
    l.text.sourceText = on ? lines[i] : "";
    l.text.animator(1).property("ADBE Text Size").setValue(size);
    l.text.animator(1).property("ADBE Text Tracking Amount").setValue(tracking);
    l.transform.opacity.setValue(on ? 100 : 0);
}

if (local.baseY === undefined) {
    var p = nul.transform.position.value;
    local.baseX = p[0];
    local.baseY = p[1];
}
var shift = (lines.length === 1 ? SHIFT_1 : SHIFT_N) * (MAX_LINES - lines.length);
nul.transform.position.setValue([local.baseX, local.baseY + shift, 0]);
