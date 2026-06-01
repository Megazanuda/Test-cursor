// Максимальные значения длины и количества строк
var MAX_PX = 1000, MAX_LINES = 2;
// Значения сдвига строк по вертикали
var SHIFT_1 = 17, SHIFT_N = 12;
// Базовая позиция прекомпозиции со строками
var BASE_X = 960;
var BASE_Y = 540;
// Отступ солида-подложки по бокам от самой длинной строки.
// Внимание: единицы должны совпадать с тем, что возвращает sourceRectAtTime у текстовых слотов
// (если slot.sourceRectAtTime(false).width выходит «мелкими» числами вроде 1.92, то и BG_PAD
// нужно делать мелким, например 0.3, иначе плашка получится огромной).
var BG_PAD = 30;
// Элементы композиции
var comp  = app.project.item("Comp 1");
var preComp = app.project.item("LINES");
var preCompLayer = comp.layer("LINES");
var src   = comp.layer("MainText");

//var nul   = comp.layer("Null 1");

var slots = ["Line1", "Line2"];
var Plaska = comp.layer("Plaska"); // солид-подложка; если она лежит внутри LINES — поменяй на preComp.layer("Plaska")
var timeFragments = app.project.item("TIMEFRAGMENTS");
var fragments = ["Hours", "Minutes"];
var hours = timeFragments.layer("Hours");
var rect = hours.sourceRectAtTime(false);
// Парсинг текста по строкам
var lines = [];
var raw = src.TextSource.Text.split(/[\r\n]+/);
for (var i = 0; i < raw.length; i++) {
    var t = raw[i].trim();
    if (t) lines.push(t);
}
// Обработка строк
if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES - 1).concat(lines.slice(MAX_LINES - 1).join(" "));
}
// Заполняем строки (текст ставим ДО замера, иначе longestPx посчитается для старого текста
// и плашка будет не той ширины)
var longestPx = 0;
for (i = 0; i < slots.length; i++) {
    var l = preComp.layer(slots[i]);
    l.TextSource.Text = i < lines.length ? lines[i] : "";
    var w = l.sourceRectAtTime(false).width;
    if (w > longestPx) longestPx = w;
}
// Подгоняем ширину плашки: меняем только scale.x под нужную видимую ширину,
// scale.y оставляем как есть (высота плашки не меняется, якорь живёт
// в координатах источника, поэтому остаётся валидным автоматически).
// В Carrot Broadcast нет source.width — берём «нативную» ширину через sourceRectAtTime.
var plRectW  = Plaska.sourceRectAtTime(false).width;
var plScale  = Plaska.transform.scale.value;
var plScaleX = (longestPx + BG_PAD * 2) / plRectW * 100;
Plaska.transform.scale.setValue([plScaleX, plScale[1], plScale[2] || 100]);
// Измерение коэффициента изменения размера текста
var scalePctPx = longestPx > MAX_PX ? 100 * (MAX_PX / longestPx) : 100;
writeLn(longestPx);
// Разбиваем строку времени на элементы и заполняем соответствующие слои
var frg = comp.layer("Time").TextSource.Text.split(":");
for (i = 0; i < fragments.length; i++) {
    timeFragments.layer(fragments[i]).TextSource.Text = frg[i] || "";
}
// Применяем изменения на слои
var rightX = hours.transform.position.value[0] + (rect.left + rect.width) - hours.transform.anchorPoint.value[0];
var dotsPos = timeFragments.layer("Dots").transform.position.value;
timeFragments.layer("Dots").transform.position.setValue([rightX + 14, dotsPos[1], 0]);
timeFragments.layer("Minutes").transform.position.setValue([rightX + 99, timeFragments.layer("Minutes").transform.position.value[1], 0]);
var shift = (lines.length === 1 ? SHIFT_1 : SHIFT_N) * (MAX_LINES - lines.length);
preCompLayer.transform.position.setValue([BASE_X, BASE_Y + shift, 0]);
