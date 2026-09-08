/* =====================================================================
   Бегущая строка (ticker) + зелёная подложка под текстом
   ---------------------------------------------------------------------
   База — исходный скрипт бегущей строки. Добавлено:
     - зелёный solid-«plate» под каждым текстом, у которого в композиции
       есть парный слой-подложка (см. правило именования PLATE_* ниже);
     - подложка растягивается по ширине текста + отступы PLATE_PAD (26 px)
       с каждой стороны и позиционируется по центру текста;
     - обновляется там же, где ставится текст: в ticker("init") и при
       переносе элемента в хвост (блок frame % 17) — каждый кадр не нужно,
       т.к. подложка тоже привязана к master и едет вместе с ним.

   ВАЖНО (настроить в композиции):
     1) слой-подложку назвать по правилу: имя текста "text N" -> "plate N"
        (для "text" -> "plate"); правило меняется в PLATE_PREFIX_*;
     2) подложку ПРИВЯЗАТЬ к master (parent), как текст и разделители,
        иначе она не поедет;
     3) якорь подложки — по ЦЕНТРУ (симметричный рост + ровные отступы);
     4) PLATE_BASE_PX = реальная ширина солида в px при scale.x = 100
        (из настроек солида) — ПОДСТАВЬ СВОЁ значение;
     5) подложку положить НИЖЕ текста в стеке слоёв (чтобы была под ним).
   ===================================================================== */

var Logger = {
    level: "ERROR", // DEBUG, INFO, WARN, ERROR

    levels: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    },

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


// Settings
var padding         = 20;   // расстояние между элементами полосы
var region_start    = 1920; // старт полосы по X
var region_end      = 0;    // X, где элементы переносятся в хвост (0 = за краем экрана)
var speed           = 3;    // скорость анимации, px/кадр
var TTL             = 0;    // сколько раз проиграть полосу (0 = бесконечно)
var gap             = 20;   // отступ текста от разделителя
var text_color      = [255, 255, 255];
var line_color      = [100, 100, 100];
// Settings

// --- PLATE: зелёная подложка под текстом ---
var PLATE_PREFIX_FROM = /^text/;  // из имени текста получаем имя подложки:
var PLATE_PREFIX_TO   = "plate";  //   "text 3" -> "plate 3", "text" -> "plate"
var PLATE_PAD         = 26;       // отступ подложки по бокам от текста, px
var PLATE_BASE_PX     = 400;      // !!! ширина солида-подложки в px при scale.x = 100
var plateLayers       = [];       // выровнен по индексам с textLayers
var layerNameSet      = {};       // множество имён слоёв (быстрая проверка наличия)
// --- /PLATE ---

var ticker_element  = 0;
var ticker_elements = [];

var ticker_counter  = 0;
var textLayers      = [];
var mediaLayers     = [];
var elementsWidth   = [];
var mediaLayerID    = 1; // id медиа-разделителя в Footages (для замера ширины)
var mediaLayerDefaultPxSize = 220;
var sepWidth        = getMediaWidth();
var lastElement     = 0;
var readyToOut      = true;
var padding_multiplayer = padding * 2;

var text_cont_count = 12;
var master          = thisComp.layer("master"); // управляющий null
var cycleOffset     = 0;
var anim_i          = 0; // индекс элемента, с которым работает anim
var frame           = 0;
var changeLayer     = false;
var frameCounter    = 0;
var clearStat;
var tickerGap;
var tickerPadding;

// --- PLATE helpers ---
// Собрать множество имён всех слоёв композиции (для быстрой проверки наличия plate).
function buildLayerNameSet(){
    layerNameSet = {};
    for (var n = 1; n <= thisComp.numLayers; n++)
        layerNameSet[thisComp.layer(n).name] = true;
}

// Вернуть слой-подложку для данного текста, либо null, если её нет.
function plateForText(textLayer){
    var name = textLayer.name.replace(PLATE_PREFIX_FROM, PLATE_PREFIX_TO);
    return (name !== textLayer.name && layerNameSet[name]) ? thisComp.layer(name) : null;
}

// Растянуть подложку по ширине текста + PLATE_PAD с двух сторон и
// поставить её по центру текста. Координаты локальные: и текст, и plate
// привязаны к master, поэтому работаем в системе master.
function placePlate(plate, textLayer){
    if (!plate) return;

    var r = textLayer.sourceRectAtTime();

    var scaleX = (r.width + PLATE_PAD * 2) / PLATE_BASE_PX * 100;
    if (PLATE_BASE_PX > 0 && isFinite(scaleX) && scaleX > 0)
        plate.scale[0] = scaleX;

    // центр текста в координатах master: position (якорь) + смещение центра рамки.
    plate.transform.position.x = textLayer.transform.position.x + r.left + r.width / 2;
    plate.Enabled = true;
}
// --- /PLATE helpers ---

function ticker(action){
    TTL = parseInt(thisComp.layer("TTL").property("Source Text").value);
    thisComp.layer("debug").property("Source Text").setValue(thisComp.layer("color_line").property("Source Text").value);

    if (thisComp.layer("color_text").property("Source Text").value != ""){
        text_color = recolor(thisComp.layer("color_text").property("Source Text").value.split(" "));
    } else {
        text_color = [1, 1, 1, 1];
    }

    if (thisComp.layer("color_line").property("Source Text").value != ""){
        line_color = recolor(thisComp.layer("color_line").property("Source Text").value.split(" "));
    } else {
        line_color = [0.392, 0.392, 0.392, 1];
    }

    ticker_elements = thisComp.layer("ticker_text").property("Source Text").value.split(/\r?\n/);

    Logger.debug(ticker_elements[0]);

    ticker_element  = 0;
    ticker_counter  = 0;
    textLayers      = [];
    mediaLayers     = [];
    elementsWidth   = [];
    plateLayers     = [];              // --- PLATE ---
    sepWidth        = getMediaWidth();
    lastElement     = 0;
    readyToOut      = true;

    tickerGap = (sepWidth === 1) ? 0 : gap;
    tickerPadding = (sepWidth === 1) ? padding_multiplayer : padding;

    cycleOffset     = 0;
    anim_i          = 0;
    frame           = 0;
    changeLayer     = false;
    frameCounter    = 0;

    buildLayerNameSet();              // --- PLATE ---

    var totalWidth = 0;

    for (var i = 1; i <= thisComp.numLayers; i++) {
        var textLayer = thisComp.layer(i);

        if (/^text(?: \d+)?$/.test(textLayer.name)) {

            var sepLayer        = thisComp.layer(i - 1);
            sepLayer.scale[0]   = sepWidth / mediaLayerDefaultPxSize * 100;

            switch (action){
                case "init":

                    // Цикличное заполнение полосы: дошли до конца массива -> с нуля,
                    // считаем количество полных проходов (для TTL).
                    if (ticker_element === ticker_elements.length){
                        ticker_element = 0;
                        TTL > 0 && (ticker_counter += 1);
                    }

                    // Ограничение количества проходов.
                    if (TTL === ticker_counter && TTL > 0) break;

                    textLayer.property("Source Text").setValue(ticker_elements[ticker_element]);
                    Logger.debug(ticker_elements[ticker_element]);
                    ticker_element += 1;

                    textLayers.push(textLayer);
                    mediaLayers.push(sepLayer);

                    var plate = plateForText(textLayer);   // --- PLATE ---
                    plateLayers.push(plate);               // --- PLATE ---

                    var textRect     = textLayer.sourceRectAtTime();
                    var textWidth    = textRect.width;
                    var layerPos     = totalWidth;
                    var elementWidth = sepWidth + textWidth + tickerPadding + tickerGap;

                    elementsWidth.push(elementWidth);

                    sepLayer.transform.position.x   = layerPos;
                    textLayer.transform.position.x  = layerPos + sepWidth + tickerGap;

                    placePlate(plate, textLayer);          // --- PLATE ---

                    totalWidth = totalWidth + elementWidth;

                    sepLayer.Enabled  = (sepWidth === 1) ? false : true;
                    textLayer.Enabled = true;

                    textLayer.effect("Fill").Color.setValue(text_color);
                    if (TTL != 0) lastElement = textLayers.length - 1;
                    break;

                case "clear":
                    textLayer.property("Source Text").setValue("");
                    textLayer.scale[0] = 100;
                    sepLayer.scale[0] = 100;
                    sepLayer.Enabled = false;
                    textLayer.transform.position.x = sepWidth;
                    master.transform.position.x = region_start;

                    var plateC = plateForText(textLayer);  // --- PLATE ---
                    if (plateC){                            // --- PLATE ---
                        plateC.scale[0] = 100;
                        plateC.Enabled  = false;
                    }
                    break;
            }
        }
    }
    thisComp.layer("Gray_String").effect("Tint").MapWhiteTo.setValue(line_color);
}

function ticker_anim(){
    master.transform.position.x -= speed;
    var mediaLayer;
    var textLayer;
    var mediaLayerX;
    var plate;                                              // --- PLATE ---
    check_out();

    // cycleOffset: элементы привязаны к master; при переносе в хвост остаётся
    // «дырка», её длину копим, чтобы правильно ловить момент следующего переноса.
    if (master.transform.position.x + elementsWidth[anim_i] + cycleOffset < region_end){

        if (ticker_element === ticker_elements.length){
            ticker_element = 0;
            TTL > 0 && (ticker_counter += 1);
        }

        if (TTL === ticker_counter && TTL > 0) return;

        mediaLayer  = mediaLayers[anim_i];
        textLayer   = textLayers[anim_i];
        plate       = plateLayers[anim_i];                 // --- PLATE ---
        mediaLayerX = mediaLayer.transform.position.x;

        changeLayer       = true;
        textLayer.Enabled = false;
        if (plate) plate.Enabled = false;                  // --- PLATE ---
        readyToOut        = false;

        if (frame % 17 === 0 && changeLayer){
            mediaLayer.transform.position.x = mediaLayerX + total_width();
            textLayer.transform.position.x  = sepWidth + tickerGap + total_width();
            textLayer.property("Source Text").setValue(ticker_elements[ticker_element]);

            cycleOffset += elementsWidth[anim_i];

            var textRect       = textLayer.sourceRectAtTime();
            var textLayerWidth = textRect.width;
            elementsWidth[anim_i] = sepWidth + textLayerWidth + tickerGap + tickerPadding;

            placePlate(plate, textLayer);                  // --- PLATE ---

            anim_i += 1;
            ticker_element += 1;

            if (anim_i === text_cont_count){
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

function check_out(){
    if (master.transform.position.x + total_width() + cycleOffset < region_end && readyToOut && TTL > 0){
        thisProject.SetState("OUT", false);
        Logger.debug("Command to OUT!");
        readyToOut = false;
    }
}

function total_width(){
    var totalWidth = 0;

    for (var i = 0; i < textLayers.length; i++) {
        var textLayer = textLayers[i];
        var textRect  = textLayer.sourceRectAtTime();
        var textWidth = textRect.width;

        totalWidth += textWidth + sepWidth + tickerPadding + tickerGap;
    }
    return totalWidth;
}

function getMediaWidth(){
    mediaFile = thisProject.Footages[mediaLayerID];
    var mediaW = Number(mediaFile.MainSource.Texture.Width);
    var mediaH = Number(mediaFile.MainSource.Texture.Height);
    return mediaW;
}

function recolor(color){
    var r = color[0] / 255;
    var g = color[1] / 255;
    var b = color[2] / 255;
    var a = 0;

    return [r, g, b, a];
}

ticker("clear");
ticker("init");
