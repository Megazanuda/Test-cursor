/* =====================================================================
   Бегущая строка (только текст) + зелёная подложка
   ---------------------------------------------------------------------
   Версия под проект, где ВСЕ слои строки лежат в прекомпозиции.

   Структура композиций:
     - главная композиция (thisComp): слой-источник строк "inputext";
     - прекомпозиция "linesPreComp": тексты myText 1 … myText 12,
       подложки dark_green_line 1…, управляющий null "master".
       Тексты и подложки ПРИВЯЗАНЫ к master (parent внутри прекомпа).

   Доступ к слоям внутри прекомпа — через app.project.item("linesPreComp"),
   как в comments-loop.js (thisComp.layer видит только слои главной комп.).

   Подложка (dark_green_line) стоит под КАЖДЫМ НЕЧЁТНЫМ текстом:
     myText 1 -> dark_green_line 1
     myText 3 -> dark_green_line 2
     myText 5 -> dark_green_line 3
     ...  (myText N, N нечётное -> dark_green_line ((N+1)/2))

   Подложка растягивается по ширине текста + PLATE_PAD (26px) с каждой
   стороны и держится по центру текста. Обновляется там же, где ставится
   текст: в ticker("init") и при переносе в хвост (frame % 17).

   Что настроить в композиции:
     1) тексты и подложки ПРИВЯЗАТЬ к master (parent) — всё внутри linesPreComp;
     2) якорь подложки — по ЦЕНТРУ (симметричный рост, ровные отступы);
     3) PLATE_BASE_PX = реальная ширина солида в px при scale.x = 100;
     4) подложку положить НИЖЕ своего текста в стеке слоёв прекомпа.

   Разбивка по полям Carrot — см. маркеры // STARTUP / // SETSTATE / // PROCESSFRAME.
   ===================================================================== */


/* ===================== // STARTUP ===================== */

var Logger = {
    level: "ERROR", // DEBUG, INFO, WARN, ERROR

    levels: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },

    log: function(level, msg) {
        if (this.levels[level] >= this.levels[this.level]) {
            printLog("[" + level + "] " + String(msg));
        }
    },

    debug: function(msg) { this.log("DEBUG", msg); },
    info:  function(msg) { this.log("INFO",  msg); },
    warn:  function(msg) { this.log("WARN",  msg); },
    error: function(msg) { this.log("ERROR", msg); }
};


// ---------------------- Settings ----------------------
var LINES_COMP_NAME = "linesPreComp"; // прекомп со всеми слоями строки
var SOURCE_LAYER    = "inputext";     // источник строк (в главной композиции)

var padding         = 20;    // расстояние между текстами, px
var region_start    = 1920;  // старт полосы по X (в координатах прекомпа)
var region_end      = 0;     // X, где элемент переносится в хвост (0 = за краем)
var speed           = 3;     // скорость анимации, px/кадр
var TTL             = 0;     // сколько раз проиграть полосу (0 = бесконечно)
var text_cont_count = 12;    // количество текст-слоёв (myText 1 … myText N)

// --- подложка ---
var PLATE_PAD       = 26;    // отступ подложки по бокам от текста, px
var PLATE_BASE_PX   = 400;   // !!! ширина солида-подложки в px при scale.x = 100 (ПОДСТАВЬ СВОЁ)
// ------------------------------------------------------

var ticker_element  = 0;
var ticker_elements = [];
var ticker_counter  = 0;

var textLayers      = [];
var plateLayers     = [];    // выровнен по индексам с textLayers (null если подложки нет)
var elementsWidth   = [];

var lastElement     = 0;
var readyToOut      = true;

var master          = null;  // управляющий null внутри прекомпа
var cycleOffset     = 0;
var anim_i          = 0;     // индекс элемента, с которым работает anim
var frame           = 0;
var changeLayer     = false;

var clearStat       = false;
var layerNameSet    = {};    // множество имён слоёв прекомпа (быстрая проверка)


// Прекомп со слоями строки.
// ВАЖНО: не кэшируем в отдельную переменную — в движке Carrot чтение
// объявленной-но-неинициализированной переменной даёт ReferenceError.
function getLC(){
    return app.project.item(LINES_COMP_NAME);
}

// Собрать множество имён слоёв прекомпа (для безопасной проверки наличия).
function buildLayerNameSet(){
    layerNameSet = {};
    var c = getLC();
    for (var n = 1; n <= c.numLayers; n++)
        layerNameSet[c.layer(n).name] = true;
}

// Безопасно получить слой прекомпа по имени (null, если такого нет).
function getLayer(name){
    return layerNameSet[name] ? getLC().layer(name) : null;
}

// Подложка для текста: у каждого текста своя, номер совпадает.
//   myText 1 -> dark_green_line 1,  myText 2 -> dark_green_line 2, ...
function plateForText(textLayer){
    var m = textLayer.name.match(/^myText\s+(\d+)$/);
    if (!m) return null;
    return getLayer("dark_green_line " + m[1]);
}

// Растянуть подложку по ширине текста + PLATE_PAD с двух сторон и
// поставить по центру текста. Координаты локальные (внутри прекомпа):
// текст и plate привязаны к master, поэтому считаем в системе master.
function placePlate(plate, textLayer){
    if (!plate) return;

    var r = textLayer.sourceRectAtTime();

    var scaleX = (r.width + PLATE_PAD * 2) / PLATE_BASE_PX * 100;
    if (PLATE_BASE_PX > 0 && isFinite(scaleX) && scaleX > 0)
        plate.scale[0] = scaleX;

    // центр текста: position (якорь) + смещение центра рамки текста.
    plate.transform.position.x = textLayer.transform.position.x + r.left + r.width / 2;
    plate.Enabled = true;
}

// Суммарная длина полосы (все элементы: текст + padding).
function total_width(){
    var totalWidth = 0;
    for (var i = 0; i < textLayers.length; i++) {
        var w = textLayers[i].sourceRectAtTime().width;
        totalWidth += w + padding;
    }
    return totalWidth;
}

// Досрочный выход в OUT, когда полоса проиграна нужное число раз (TTL).
function check_out(){
    if (master.transform.position.x + total_width() + cycleOffset < region_end && readyToOut && TTL > 0){
        thisProject.SetState("OUT", false);
        Logger.debug("Command to OUT!");
        readyToOut = false;
    }
}

// Инициализация / очистка полосы.
function ticker(action){
    buildLayerNameSet();
    master = getLayer("master");

    // TTL — необязательный слой прекомпа; нет слоя -> бесконечно (0).
    var ttlLayer = getLayer("TTL");
    TTL = ttlLayer ? parseInt(ttlLayer.property("Source Text").value) : 0;
    if (isNaN(TTL)) TTL = 0;

    // Источник строк — в ГЛАВНОЙ композиции.
    var srcLayer = thisComp.layer(SOURCE_LAYER);
    if (!srcLayer){ Logger.error("Нет слоя " + SOURCE_LAYER); return; }
    ticker_elements = srcLayer.property("Source Text").value.split(/\r?\n/);

    ticker_element = 0;
    ticker_counter = 0;
    textLayers     = [];
    plateLayers    = [];
    elementsWidth  = [];
    lastElement    = 0;
    readyToOut     = true;
    cycleOffset    = 0;
    anim_i         = 0;
    frame          = 0;
    changeLayer    = false;

    var totalWidth = 0;

    // Идём строго по номерам 1..N — порядок слева направо = порядок номеров.
    for (var k = 1; k <= text_cont_count; k++) {
        var textLayer = getLayer("myText " + k);
        if (!textLayer) continue;

        var plate = plateForText(textLayer);

        switch (action){
            case "init":

                // Цикличное заполнение: дошли до конца массива -> с нуля,
                // считаем полные проходы (для TTL).
                if (ticker_element === ticker_elements.length){
                    ticker_element = 0;
                    TTL > 0 && (ticker_counter += 1);
                }

                // Ограничение количества проходов.
                if (TTL === ticker_counter && TTL > 0) break;

                textLayer.property("Source Text").setValue(ticker_elements[ticker_element]);
                ticker_element += 1;

                textLayers.push(textLayer);
                plateLayers.push(plate);

                var textRect     = textLayer.sourceRectAtTime();
                var textWidth    = textRect.width;
                var layerPos     = totalWidth;
                var elementWidth = textWidth + padding;

                elementsWidth.push(elementWidth);

                textLayer.transform.position.x = layerPos;
                placePlate(plate, textLayer);

                totalWidth = totalWidth + elementWidth;
                textLayer.Enabled = true;

                if (TTL != 0) lastElement = textLayers.length - 1;
                break;

            case "clear":
                textLayer.property("Source Text").setValue("");
                textLayer.scale[0] = 100;
                textLayer.transform.position.x = 0;
                if (master) master.transform.position.x = region_start;

                if (plate){
                    plate.scale[0] = 100;
                    plate.Enabled  = false;
                }
                break;
        }
    }
}

// Кадр анимации: двигаем master; ушедшие за region_end элементы — в хвост.
function ticker_anim(){
    if (!master) master = getLayer("master");
    master.transform.position.x -= speed;

    var textLayer;
    var plate;

    check_out();

    // cycleOffset: тексты привязаны к master; при переносе элемента в хвост
    // впереди остаётся «дырка» — копим её длину для корректного момента следующего переноса.
    if (master.transform.position.x + elementsWidth[anim_i] + cycleOffset < region_end){

        if (ticker_element === ticker_elements.length){
            ticker_element = 0;
            TTL > 0 && (ticker_counter += 1);
        }

        if (TTL === ticker_counter && TTL > 0) return;

        textLayer = textLayers[anim_i];
        plate     = plateLayers[anim_i];

        changeLayer       = true;
        textLayer.Enabled = false;
        if (plate) plate.Enabled = false;
        readyToOut        = false;

        if (frame % 17 === 0 && changeLayer){
            // переносим элемент в конец полосы
            textLayer.transform.position.x = total_width();
            textLayer.property("Source Text").setValue(ticker_elements[ticker_element]);

            cycleOffset += elementsWidth[anim_i];

            var textRect       = textLayer.sourceRectAtTime();
            var textLayerWidth = textRect.width;
            elementsWidth[anim_i] = textLayerWidth + padding;

            placePlate(plate, textLayer);

            anim_i += 1;
            ticker_element += 1;

            if (anim_i === textLayers.length){
                anim_i = 0;
            }

            changeLayer       = false;
            textLayer.Enabled = true;
            lastElement       = anim_i;
            readyToOut        = true;
        }
    }
    frame += 1;
}

ticker("clear");
ticker("init");


/* ===================== // SETSTATE ===================== */
/*
if (statename == "IN"){
    Logger.debug("IN");
    ticker("clear");
    ticker("init");
}

if (statename == "OUT"){
    clearStat = true;
}
*/


/* ===================== // PROCESSFRAME ===================== */
/*
if (time > 1.6 && time < 5.7){
    ticker_anim();
}

if (statename == "OUT" && clearStat && time > 5.7){
    Logger.debug("OUT");
    ticker("clear");
    clearStat = false;
}
*/
