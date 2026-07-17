/* =====================================================================
   Carrot Broadcast — поочерёдный вывод комментариев (Comment 1 / Comment 2)
   ---------------------------------------------------------------------
   Композиция:
     - State LOOP: два текстовых слоя "Comment 1" и "Comment 2"
       по очереди появляются и исчезают (анимация видимости — на
       кёйфреймах в самой композиции, скрипт её НЕ трогает).
     - State OUT: аутро, текст не меняем.
     - Слой "MainText" — источник строк. Каждая непустая строка
       по очереди подставляется в Comment 1 и Comment 2.

   ВАЖНО (почему так, а не по таймеру):
     Текст плашки меняется РОВНО в тот кадр, когда плашка стала скрытой
     (её прозрачность упала ниже порога). Смена привязана к самой
     анимации, поэтому НИКАКОГО накопительного рассинхрона нет —
     сколько бы времени ни шёл цикл.

   Логика подстановки строк:
     - Comment 1 показывает строки 0,2,4,...  Comment 2 — 1,3,5,...
     - на экране строки идут последовательно 0,1,2,3,... с зацикливанием.
   ===================================================================== */


/* =====================================================================
   STARTUP  (объявления переменных и функции — выполняется один раз)
   ===================================================================== */

// Порог прозрачности (в %), ниже которого плашка считается скрытой.
// Смена текста происходит, когда плашка уже практически невидима,
// поэтому мигания нет.
var HIDE_LEVEL = 1;

// --- Рабочие переменные ---
var arrLocation;   // массив непустых строк из MainText
var nextLine;      // индекс следующей строки для подстановки
var vis1, vis2;    // была ли плашка видима на предыдущем кадре
var prevTime;      // время предыдущего кадра (для детекта зацикливания)

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

// Видима ли плашка сейчас. Если в композиции скрытие сделано НЕ через
// прозрачность (а, например, сдвигом позиции/масштабом) — поменяй тело
// этой функции на нужную проверку.
function isVisible(name)
{
    return thisComp.layer(name).transform.opacity > HIDE_LEVEL;
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

    // Следующая строка, которую выдадим при первом же скрытии плашки.
    nextLine = 2;

    // На старте плашки ещё скрыты — считаем их невидимыми,
    // чтобы не сработал ложный "переход в скрытое".
    vis1 = false;
    vis2 = false;

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

    var v1 = isVisible("Comment 1");
    var v2 = isVisible("Comment 2");

    // Плашка ТОЛЬКО ЧТО скрылась -> сразу подставляем в неё следующую
    // строку (она невидима, поэтому смена не видна). Порядок проверок
    // задаёт порядок выдачи строк: 0,1,2,3,...
    if (vis1 && !v1)
    {
        setComment("Comment 1", arrLocation[nextLine % arrLocation.length]);
        nextLine++;
    }

    if (vis2 && !v2)
    {
        setComment("Comment 2", arrLocation[nextLine % arrLocation.length]);
        nextLine++;
    }

    vis1 = v1;
    vis2 = v2;
    prevTime = time;
}
