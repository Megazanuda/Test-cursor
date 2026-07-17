/* =====================================================================
   Carrot Broadcast — поочерёдный вывод комментариев (Comment 1 / Comment 2)
   ---------------------------------------------------------------------
   Композиция:
     - State LOOP (длится 60 c): два текстовых слоя "Comment 1" и
       "Comment 2" по очереди появляются и исчезают. Сама анимация
       видимости — на кёйфреймах в композиции, скрипт её НЕ трогает.
     - State OUT: аутро, текст не меняем.
     - Слой "MainText" — источник строк. Каждая непустая строка
       по очереди подставляется в Comment 1 и Comment 2.

   Тайминги композиции:
     - START_TIME  0.18 c — когда впервые появляется Comment 1
     - PERIOD      5.98 c — период чередования (появление -> появление)
     - GAP         0.2  c — пауза между полным исчезновением одного
                            и началом появления другого

   Как избегаем рассинхрона:
     Текст плашки меняем в СЕРЕДИНЕ её "скрытого окна" — когда она
     заведомо невидима и до её следующего появления ещё ~3 c. Такой
     большой запас с обеих сторон гарантирует, что мелкий дрейф за
     60 c не приведёт ни к опозданию текста, ни к миганию.

   Логика подстановки строк:
     - Comment 1 показывает строки 0,2,4,...  Comment 2 — 1,3,5,...
     - на экране строки идут последовательно 0,1,2,3,... с зацикливанием.
   ===================================================================== */


/* =====================================================================
   STARTUP  (объявления переменных и функции — выполняется один раз)
   ===================================================================== */

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

// --- (опционально) автоподгон масштаба текста по ширине ---
function autoScale(layer)
{
    var maxWidth = 400;  // подставь ширину своей плашки
    var textWidth = layer.sourceRectAtTime().width;
    var result = 100;

    if (textWidth > maxWidth)
        result = maxWidth / textWidth * 100;

    layer.transform.scale = [result, result, 100];
}

// Установка текста в слой (+ при желании автоподгон масштаба).
function setComment(name, str)
{
    thisComp.layer(name).TextSource.Text = str;
    // autoScale(thisComp.layer(name));   // раскомментируй, если нужно вписывать по ширине
}

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
{
    prevTime = time;
}
else if (arrLocation && arrLocation.length > 0)
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
