// Максимальная ширина строки (px) и максимальное количество строк
var MAX_PX = 1000;
var MAX_LINES = 3;

// Вертикальный сдвиг строк: SHIFT_1 — когда строка одна, SHIFT_N — для нескольких
var SHIFT_1 = 17;
var SHIFT_N = 12;

// Базовая позиция прекомпозиции со строками
var BASE_X = 1045.5;
var BASE_Y = 34.8;

// Элементы основной композиции
var comp         = app.project.item("Comp 1");
var preComp      = app.project.item("LINES");
var preCompLayer = comp.layer("LINES");
var src          = comp.layer("MainText");
var nul          = comp.layer("Null 1");
var slots        = ["TextLine 1", "TextLine 2", "TextLine 3"];

// Элементы композиции с фрагментами времени
var timeFragments = app.project.item("TIMEFRAGMENTS");
var fragments     = ["Hours", "Minutes"];
var hoursLayer    = timeFragments.layer("Hours");
var minutesLayer  = timeFragments.layer("Minutes");
var dotsLayer     = timeFragments.layer("Dots");
var hoursRect     = hoursLayer.sourceRectAtTime(false);

// Парсинг исходного текста по строкам с отсечением пустых
var lines = [];
var raw   = src.TextSource.Text.split(/[\r\n]+/);
for (var i = 0; i < raw.length; i++) {
    var t = raw[i].trim();
    if (t) lines.push(t);
}

// Если строк больше допустимого — лишние склеиваем в последнюю
if (lines.length > MAX_LINES) {
    var head = lines.slice(0, MAX_LINES - 1);
    var tail = lines.slice(MAX_LINES - 1).join(" ");
    lines = head.concat(tail);
}

// Заполняем слоты прекомпозиции и попутно ищем самую длинную строку
var longestPx = 0;
for (i = 0; i < slots.length; i++) {
    var slotLayer = preComp.layer(slots[i]);
    var width     = slotLayer.sourceRectAtTime(false).width;
    if (width > longestPx) longestPx = width;
    slotLayer.TextSource.Text = i < lines.length ? lines[i] : "";
}

// Коэффициент масштабирования, чтобы длиннейшая строка вписалась в MAX_PX
var scalePctPx = longestPx > MAX_PX ? 100 * (MAX_PX / longestPx) : 100;
writeLn(longestPx);

// Разбиваем строку времени на фрагменты и раскладываем по слоям
var frg = comp.layer("Time").TextSource.Text.split(":");
for (i = 0; i < fragments.length; i++) {
    timeFragments.layer(fragments[i]).TextSource.Text = frg[i] || "";
}

// Позиционируем разделитель и минуты относительно правого края часов
var hoursPos    = hoursLayer.transform.position.value;
var hoursAnchor = hoursLayer.transform.anchorPoint.value;
var rightX      = hoursPos[0] + (hoursRect.left + hoursRect.width) - hoursAnchor[0];

var dotsPos    = dotsLayer.transform.position.value;
var minutesPos = minutesLayer.transform.position.value;
dotsLayer.transform.position.setValue([rightX + 14, dotsPos[1], 0]);
minutesLayer.transform.position.setValue([rightX + 99, minutesPos[1], 0]);

// Применяем масштаб и итоговую позицию прекомпозиции со строками
preCompLayer.transform.scale.setValue([scalePctPx, scalePctPx, 100]);
var shift = (lines.length === 1 ? SHIFT_1 : SHIFT_N) * (MAX_LINES - lines.length);
preCompLayer.transform.position.setValue([BASE_X, BASE_Y + shift, 0]);
