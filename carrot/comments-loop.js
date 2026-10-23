/* =====================================================================
   Carrot Broadcast — комментарии + раскладка плашки/времени
   ---------------------------------------------------------------------
   Скрипт состоит из двух независимых частей:

   1) ЧЕРЕДОВАНИЕ КОММЕНТАРИЕВ (Comment 1 / Comment 2)
      - State LOOP (длится 60 c): два текстовых слоя по очереди
        появляются и исчезают (анимация видимости — на кёйфреймах в
        композиции, скрипт её НЕ трогает).
      - Слой "MainText" — источник строк. Comment 1 показывает строки
        0,2,4,...  Comment 2 — 1,3,5,...  => на экране 0,1,2,3,...
      - Смена текста делается в СЕРЕДИНЕ "скрытого окна" плашки, чтобы
        не было ни рассинхрона, ни мигания.

   2) РАСКЛАДКА (каждый кадр, updateLayout)
      - строки из "MainText" -> слои Line1/Line2 прекомпа "LINES";
      - ширина солида-подложки "Plaska" подгоняется под самую длинную строку;
      - строка "Time" (ЧЧ:ММ) раскладывается по слоям Hours/Minutes
        прекомпа "TIMEFRAGMENTS", а "Dots"/"Minutes" сдвигаются вплотную
        к "Hours";
      - прекомп "LINES" сдвигается по вертикали в зависимости от числа строк.
   ===================================================================== */


/* =====================================================================
   STARTUP  (объявления переменных и функции — выполняется один раз)
   ===================================================================== */

/* ---------- Часть 1: чередование комментариев ---------- */

// --- Тайминги композиции ---
var START_TIME = 0.18;   // первое появление Comment 1
var PERIOD     = 5.98;   // период чередования (появление -> появление)
var GAP        = 0.2;    // пауза между исчезновением одного и появлением другого

// За сколько до появления менять текст. Берём середину "скрытого окна"
// плашки (окно = PERIOD + GAP), чтобы был максимальный запас по времени.
var CHANGE_LEAD = (PERIOD + GAP) / 2;   // = 3.09

// --- Рабочие переменные ---
var arrLocation;      // массив непустых строк из MainText
var nextSlot;         // номер следующего появления, которому готовим текст
var nextChangeTime;   // время, когда меняем текст для nextSlot
var prevTime;         // время предыдущего кадра (для детекта зацикливания)

// Разбить текст MainText на непустые строки.
function buildLines(txt)
{
    var raw = txt.split("\n");
    var res = [];

    for (var i = 0; i < raw.length; i++)
    {
        if (raw[i].trim() != "")
            res.push(raw[i].trim());
    }

    return res;
}

// Установка текста в комментарий.
function setComment(name, str)
{
    thisComp.layer(name).TextSource.Text = str;
}

// (Пере)инициализация цикла. Используется и в SetState, и при зацикливании.
function initLoop()
{
    arrLocation = buildLines(thisComp.layer("MainText").TextSource.Text);

    var has = arrLocation.length > 0;
    thisComp.layer("Comment 1").Enabled = has;
    thisComp.layer("Comment 2").Enabled = has;

    if (!has)
        return;

    // Стартовые строки: слот 0 -> Comment 1, слот 1 -> Comment 2.
    setComment("Comment 1", arrLocation[0]);
    setComment("Comment 2", arrLocation[1 % arrLocation.length]);

    // Следующее появление, которому нужен новый текст, — слот 2 (снова Comment 1).
    nextSlot = 2;
    nextChangeTime = START_TIME + nextSlot * PERIOD - CHANGE_LEAD;

    prevTime = 0;
}

// Смена текста скрытых комментариев по расписанию (вызывать каждый кадр в LOOP).
function updateComments()
{
    // Композиция залупилась -> начинаем цикл заново (снова строки 0 и 1).
    if (time < prevTime)
        initLoop();

    // Готовим текст для всех появлений, чьё время смены уже наступило.
    // nextChangeTime считается по формуле от START_TIME (не накапливается),
    // поэтому ошибка не растёт от цикла к циклу.
    while (time >= nextChangeTime)
    {
        var layerName = (nextSlot % 2 == 0) ? "Comment 1" : "Comment 2";
        setComment(layerName, arrLocation[nextSlot % arrLocation.length]);

        nextSlot++;
        nextChangeTime = START_TIME + nextSlot * PERIOD - CHANGE_LEAD;
    }

    prevTime = time;
}


/* ---------- Часть 2: раскладка плашки / строк / времени ---------- */

var MAX_LINES = 2;                 // максимум строк (лишние сливаются в последнюю)
var SHIFT_1 = 17, SHIFT_N = 12;    // сдвиг строк по вертикали
var BASE_X = 960, BASE_Y = 540;    // базовая позиция прекомпа LINES
var BG_PAD = 30;                   // отступ подложки по бокам от текста (px)
var PLASKA_UNIT_TO_PX = 1024;      // перевод единиц ширины солида в пиксели

var LINE_SLOTS = ["Line1", "Line2"];
var TIME_FRAGMENTS = ["Hours", "Minutes"];

// Разбор MainText в строки; всё, что сверх MAX_LINES, сливается в последнюю.
function parseLines(txt)
{
    var lines = [];
    var raw = txt.split(/[\r\n]+/);

    for (var i = 0; i < raw.length; i++)
    {
        var t = raw[i].trim();
        if (t) lines.push(t);
    }

    if (lines.length > MAX_LINES)
        lines = lines.slice(0, MAX_LINES - 1).concat(lines.slice(MAX_LINES - 1).join(" "));

    return lines;
}

// Заполняем Line1/Line2 и возвращаем ширину самой длинной строки (px).
// Текст ставим ДО замера, иначе ширина посчитается для старого текста.
function fillSlots(preComp, lines)
{
    var longestPx = 0;

    for (var i = 0; i < LINE_SLOTS.length; i++)
    {
        var l = preComp.layer(LINE_SLOTS[i]);
        l.TextSource.Text = i < lines.length ? lines[i] : "";

        var w = l.sourceRectAtTime(false).width;
        if (w > longestPx) longestPx = w;
    }

    return longestPx;
}

// Подгоняем ширину подложки под текст: меняем только scale.x.
function fitPlaska(preComp, plaska, longestPx)
{
    var preCompScaleX = preComp.layer("Line1").transform.scale.value[0];
    var textVisiblePx = longestPx * (preCompScaleX / 100);

    var plSrcW   = plaska.sourceRectAtTime(false).width * PLASKA_UNIT_TO_PX;
    var plScale  = plaska.transform.scale.value;
    var plScaleX = (textVisiblePx + BG_PAD * 2) / plSrcW * 100;

    // Защита от NaN/0/отрицательных — не трогаем scale.x, если расчёт некорректен.
    if (plSrcW > 0 && isFinite(plScaleX) && plScaleX > 0)
        plaska.transform.scale.setValue([plScaleX, plScale[1], plScale[2] || 100]);
}

// Сдвиг прекомпа LINES по вертикали в зависимости от числа строк.
function placeLines(preCompLayer, lineCount)
{
    var shift = (lineCount === 1 ? SHIFT_1 : SHIFT_N) * (MAX_LINES - lineCount);
    preCompLayer.transform.position.setValue([BASE_X, BASE_Y + shift, 0]);
}

// Раскладка строки "Time" (ЧЧ:ММ) по Hours/Minutes + подгон Dots/Minutes.
function updateTime(comp, timeFragments)
{
    var hours = timeFragments.layer("Hours");
    // Ширину Hours берём по текущему тексту (до его обновления) — как в исходнике.
    var rect = hours.sourceRectAtTime(false);

    var frg = comp.layer("Time").TextSource.Text.split(":");
    for (var i = 0; i < TIME_FRAGMENTS.length; i++)
        timeFragments.layer(TIME_FRAGMENTS[i]).TextSource.Text = frg[i] || "";

    var rightX = hours.transform.position.value[0]
               + (rect.left + rect.width)
               - hours.transform.anchorPoint.value[0];

    var dotsPos = timeFragments.layer("Dots").transform.position.value;
    timeFragments.layer("Dots").transform.position.setValue([rightX + 10, dotsPos[1], 0]);

    var minPos = timeFragments.layer("Minutes").transform.position.value;
    timeFragments.layer("Minutes").transform.position.setValue([rightX + 17, minPos[1], 0]);
}

// Полная раскладка кадра.
function updateLayout()
{
    var comp          = app.project.item("Comp 1");
    var preComp       = app.project.item("LINES");
    var timeFragments = app.project.item("TIMEFRAGMENTS");
    var preCompLayer  = comp.layer("LINES");
    var src           = comp.layer("MainText");
    var plaska        = comp.layer("Plaska");

    var lines = parseLines(src.TextSource.Text);
    var longestPx = fillSlots(preComp, lines);

    fitPlaska(preComp, plaska, longestPx);
    updateTime(comp, timeFragments);
    placeLines(preCompLayer, lines.length);
}


/* =====================================================================
   SETSTATE  (выполняется при входе в state; имя state — в statename)
   ===================================================================== */

if (statename == "LOOP")
{
    initLoop();
}


/* =====================================================================
   PROCESSFRAME  (каждый кадр; time — текущее время композиции)
   ===================================================================== */

if (statename != "LOOP")
    prevTime = time;
else if (arrLocation && arrLocation.length > 0)
    updateComments();

updateLayout();
