/* =====================================================================
   Carrot Broadcast — поочерёдный вывод комментариев (Comment 1 / Comment 2)
   ---------------------------------------------------------------------
   Композиция:
     - State LOOP: два текстовых слоя "Comment 1" и "Comment 2"
       по очереди появляются и исчезают (анимация видимости —
       на кёйфреймах в самой композиции, скрипт её НЕ трогает).
     - State OUT: аутро, текст не меняем.
     - Слой "MainText" — источник строк. Каждая непустая строка
       по очереди подставляется в Comment 1 и Comment 2.

   Тайминги (из композиции):
     - первый комментарий появляется в 0.18 c
     - каждый комментарий висит на экране 5.96 c
     - пауза между исчезновением одного и появлением другого 0.2 c

   Идея скрипта:
     - Появления нумеруются "слотами": slot 0, 1, 2, 3, ...
         slot чётный  -> Comment 1
         slot нечётный-> Comment 2
         содержимое slot k = arrLocation[k % N]  (N = кол-во строк)
       => на экране строки идут последовательно 0,1,2,3,... с зацикливанием.
     - Текст слоя меняем, пока слой СКРЫТ (в момент паузы GAP перед его
       появлением), чтобы смена не была видна.
   ===================================================================== */


/* =====================================================================
   STARTUP  (объявления переменных и функции — выполняется один раз)
   ===================================================================== */

// --- Тайминги композиции ---
var START_TIME   = 0.18;   // когда появляется первый комментарий
var DISPLAY_TIME = 5.96;   // сколько каждый комментарий висит на экране
var GAP          = 0.2;    // пауза между исчезновением одного и появлением другого

// Период чередования: следующий комментарий появляется через
// (DISPLAY_TIME + GAP) после предыдущего.
var PERIOD = DISPLAY_TIME + GAP;   // = 6.16

// За сколько до появления слоя менять его текст. Делаем это в паузе GAP —
// в этот момент слой уже скрыт, поэтому смена текста не видна.
var PRELOAD_TIME = GAP;            // = 0.2

// --- Рабочие переменные ---
var arrLocation;        // массив непустых строк из MainText
var nextSlot;           // номер следующего появления, которому надо подготовить текст
var nextPrepareTime;    // время, когда готовим текст для nextSlot
var prevTime;           // время предыдущего кадра (для детекта зацикливания)

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

// (Пере)инициализация цикла: заполняем стартовые тексты и планируем
// первую подготовку. Используется и в SetState, и при зацикливании.
function initLoop()
{
    arrLocation = buildLines(thisComp.layer("MainText").TextSource.Text);

    var has = arrLocation.length > 0;
    thisComp.layer("Comment 1").Enabled = has;
    thisComp.layer("Comment 2").Enabled = has;

    if (!has)
        return;

    // slot 0 -> Comment 1, slot 1 -> Comment 2
    setComment("Comment 1", arrLocation[0]);
    setComment("Comment 2", arrLocation[1 % arrLocation.length]);

    // Первое появление, которому нужен новый текст, — slot 2 (снова Comment 1).
    // Готовим его в паузе перед появлением (когда слой ещё скрыт).
    nextSlot = 2;
    nextPrepareTime = START_TIME + nextSlot * PERIOD - PRELOAD_TIME;

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
    // Композиция залупилась -> начинаем цикл заново.
    if (time < prevTime)
        initLoop();

    // Готовим текст для всех появлений, чьё время подготовки уже наступило.
    // (while — на случай "перескока" кадра; при нормальном проигрывании
    //  срабатывает не чаще одного раза за проход.)
    while (time >= nextPrepareTime)
    {
        var layerName = (nextSlot % 2 == 0) ? "Comment 1" : "Comment 2";
        setComment(layerName, arrLocation[nextSlot % arrLocation.length]);

        nextSlot++;
        nextPrepareTime = START_TIME + nextSlot * PERIOD - PRELOAD_TIME;
    }

    prevTime = time;
}
