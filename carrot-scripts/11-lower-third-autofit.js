// 11. Lower Third Autofit (без анимации opacity)
//
// Делает:
//   1) парсит текст из слоя-источника на строки (разделители \n, \r, \r\n);
//   2) следит, чтобы строк было не больше MAX_LINES — лишнее склеивает в последнюю;
//   3) автоуменьшает шрифт и трекинг, если самая длинная строка длиннее BASE_CHARS_PER_LINE;
//   4) раскидывает строки по слоям LINE_LAYERS: заполненные - opacity 100, пустые - 0;
//   5) сдвигает Null-слой по Y в зависимости от числа строк.
//
// local.finalSize / local.finalTracking не применяются напрямую - подразумевается,
// что их читают AE-выражения на текстовых слоях (Font Size, Tracking).

var BASE_CHARS_PER_LINE    = 40;
var MAX_LINES              = 3;
var BASE_FONT_SIZE         = 49;
var MIN_FONT_SIZE          = 25;
var BASE_TRACKING          = 0;
var MIN_TRACKING           = -50;
var SHIFT_PER_MISSING_LINE = 15;
var SHIFT_WHEN_ONE_LINE    = 20;

var COMP_NAME    = "Comp 1";
var SOURCE_LAYER = "MainText";
var LINE_LAYERS  = ["TextLine 1", "TextLine 2", "TextLine 3"];
var NULL_LAYER   = "Null 1";

// === СБРОС КЭША (раскомментировать, если двигали Null вручную) ===
// local.baseNullY   = undefined;
// local.lastRawText = undefined;

var mainComp    = app.project.item(COMP_NAME);
var sourceLayer = mainComp.layer(SOURCE_LAYER);
var nullLayer   = mainComp.layer(NULL_LAYER);
var srcText     = sourceLayer.text.sourceText.value;

if (local.lastRawText !== srcText) {
    local.lastRawText = srcText;

    var raw = srcText.split(/\r\n|\r|\n/);
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
        var trimmed = raw[i].replace(/^[ \t]+|[ \t]+$/g, "");
        if (trimmed.length > 0) lines.push(trimmed);
    }

    if (lines.length > MAX_LINES) {
        var tail = lines.slice(MAX_LINES - 1).join(" ");
        lines = lines.slice(0, MAX_LINES - 1);
        lines.push(tail);
    }

    var longest = 0;
    for (var j = 0; j < lines.length; j++) {
        if (lines[j].length > longest) longest = lines[j].length;
    }

    var finalSize     = BASE_FONT_SIZE;
    var finalTracking = BASE_TRACKING;
    if (longest > BASE_CHARS_PER_LINE) {
        finalSize = BASE_FONT_SIZE * BASE_CHARS_PER_LINE / longest;
        if (finalSize < MIN_FONT_SIZE) finalSize = MIN_FONT_SIZE;

        var k = (finalSize - MIN_FONT_SIZE) / (BASE_FONT_SIZE - MIN_FONT_SIZE);
        finalTracking = MIN_TRACKING + k * (BASE_TRACKING - MIN_TRACKING);
    }

    for (var s = 0; s < LINE_LAYERS.length; s++) {
        var ll = mainComp.layer(LINE_LAYERS[s]);
        var hasLine = s < lines.length;
        ll.text.sourceText.setValue(hasLine ? lines[s] : "");
        ll.transform.opacity.setValue(hasLine ? 100 : 0);
    }

    local.lines         = lines;
    local.finalSize     = finalSize;
    local.finalTracking = finalTracking;
    local.lineCount     = lines.length;
}

var lineCount = local.lineCount || 0;
var shiftPx   = (lineCount === 1) ? SHIFT_WHEN_ONE_LINE : SHIFT_PER_MISSING_LINE;
var yShift    = (MAX_LINES - lineCount) * shiftPx;

if (local.baseNullY === undefined) {
    var np = nullLayer.transform.position.value;
    local.baseNullX = np[0];
    local.baseNullY = np[1];
}

var newY = local.baseNullY + yShift;
if (local.lastNullY !== newY) {
    nullLayer.transform.position.setValue([local.baseNullX, newY, 0]);
    local.lastNullY = newY;
}
