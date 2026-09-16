/* =====================================================================
   Бегущая строка — Startup (актуальная версия пользователя + фикс пустого ввода)
   ---------------------------------------------------------------------
   Проблема: при очистке inputext split давал [""], пустая строка попадала
   в слои с width≈0 → ломались elementsWidth / cycleOffset / перенос в хвост.

   Фикс:
     - parseTickerLines() отбрасывает пустые строки;
     - при пустом вводе слои при рецикле НЕ включаются обратно и не
       получают пустой текст; ширина для математики не падает в 0;
     - при init с пустым вводом полоса просто очищается и ждёт текст;
     - ticker_anim защищён, если textLayers ещё пуст.
   ===================================================================== */

var Logger =
{
	level: "ERROR", // DEBUG, INFO, WARN, ERROR

	levels:
	{
		DEBUG: 0,
		INFO: 1,
		WARN: 2,
		ERROR: 3
	},

	log: function(level, msg)
	{
		if (this.levels[level] >= this.levels[this.level])
		{
			printLog("[" + level + "] " + String(msg));
		}
	},

	debug: function(msg) { this.log("DEBUG", msg); },
	info:  function(msg) { this.log("INFO",  msg); },
	warn:  function(msg) { this.log("WARN",  msg); },
	error: function(msg) { this.log("ERROR", msg); }
};


// ---------------------- Settings ----------------------
var padding         = 52;    // расстояние между текстами, px
var region_start    = 1950;  // старт полосы по X (где начинается движение)
var region_start_gap = 2000;
var region_end      = -50;     // X, где элемент переносится в хвост (0 = за краем экрана)
var region_visible_end = -10;
var speed           = 3.5;     // скорость анимации, px/кадр
var TTL             = 0;     // сколько раз проиграть полосу (0 = бесконечно)
var text_cont_count = 12;    // количество текст-слоёв (myText 1 … myText N)

// --- подложка ---
var PLATE_PAD       = 26;    // отступ подложки по бокам от текста, px
var PLATE_BASE_PX   = 1;   // !!! ширина солида-подложки в px при scale.x = 100

var toColorRatio = val => +(val / 255).toFixed(2);

var greenL = [toColorRatio(0), toColorRatio(148), toColorRatio(0), toColorRatio(0)];
var greenD = [toColorRatio(0), toColorRatio(103), toColorRatio(0), toColorRatio(0)];

var redL = [toColorRatio(255), toColorRatio(15), toColorRatio(50), toColorRatio(0)];
var redD = [toColorRatio(204), toColorRatio(12), toColorRatio(41), toColorRatio(0)];

var MayL = [toColorRatio(148), toColorRatio(38), toColorRatio(0), toColorRatio(0)];
var MayD = [toColorRatio(102), toColorRatio(26), toColorRatio(0), toColorRatio(0)];

var marked = 0;
var textVisGap = 0;
// ------------------------------------------------------

var ticker_element  = 0;
var ticker_elements = [];
var ticker_counter  = 0;

var textLayers      = [];
var plateLayers     = [];    // выровнен по индексам с textLayers (null если подложки нет)
var elementsWidth   = [];

var lastElement     = 0;
var readyToOut      = true;

var master          = app.project.item("linesPreComp").layer("master"); // управляющий null
var cycleOffset     = 0;
var anim_i          = 0;     // индекс элемента, с которым работает anim
var frame           = 0;
var changeLayer     = false;

var clearStat;
var layerNameSet    = {};    // множество имён слоёв (быстрая проверка наличия)


function getLC()
{
	return app.project.item("linesPreComp");
}

function buildLayerNameSet()
{
	layerNameSet = {};
	var c = getLC();

	for (var n = 1; n <= c.numLayers; n++)
		layerNameSet[c.layer(n).name] = true;
}

function getLayer(name)
{
	return layerNameSet[name] ? getLC().layer(name) : null;
}

// Нормализация inputext: UPPERCASE, trim, без пустых строк.
// Важно: "".split(/\r?\n/) -> [""] — это и ломало полосу при очистке ввода.
function parseTickerLines(raw)
{
	var text = (raw == null ? "" : String(raw))
		.toUpperCase()
		.trim()
		.replace(/\n\s*\n/g, "\n");

	if (!text) return [];

	var rawLines = text.split(/\r?\n/);
	var lines = [];

	for (var i = 0; i < rawLines.length; i++)
	{
		var t = rawLines[i].trim();
		if (t) lines.push(t);
	}
	return lines;
}

function readInputLines()
{
	var src = getLayer("inputext");
	if (!src) return [];

	// держим слой-источник в нормализованном виде
	var normalized = parseTickerLines(src.TextSource.Text).join("\n");
	if (src.TextSource.Text !== normalized)
		src.TextSource.Text = normalized;

	return parseTickerLines(src.TextSource.Text);
}

function plateForText(textLayer)
{
	var m = textLayer.name.match(/^myText\s+(\d+)$/);

	if (!m) return null;
	return getLayer("text_line " + m[1]);
}

function fixMarkedText(plate, textLayer)
{
	if (!plate) return;
	var e = textLayer.name.match(/^myText\s+(\d+)$/);

	if (!e) return null;
	textLayer.TextSource.Text = textLayer.TextSource.Text.trim();

	if (textLayer.TextSource.Text.lastIndexOf("*") == 0)
	{
		textLayer.TextSource.Text = textLayer.TextSource.Text.replace(/\*([^\r\n ]+)/g, "$1");
		marked = 1;
	}

	// было: == /^\s*$/ (сравнение строки с RegExp — всегда false)
	if (/^\s*$/.test(textLayer.TextSource.Text))
		plate.Enabled = false;
	else
		plate.Enabled = true;
}

function plateColor(plate, textLayer)
{
	if (!plate) return;
	var o = textLayer.name.match(/^myText\s+(\d+)$/);

	if (!o) return null;
	var num = parseInt(o[1], 10);

	if (thisComp.layer("SROCHNO").TextSource.Text == 0)
	{
		thisComp.layer("green_line").effect("Fill").Color.setValue(greenL);

		if (num % 2 == 0)
		{
			plate.effect("Fill").Color.setValue(greenD);

			if (marked == 1)
			{
				plate.effect("Fill").Color.setValue(redD);
				marked = 0;
			}
		} else {
			plate.effect("Fill").Color.setValue(greenL);

			if (marked == 1)
			{
				plate.effect("Fill").Color.setValue(redL);
				marked = 0;
			}
		}
	} else {
		thisComp.layer("green_line").effect("Fill").Color.setValue(redL);

		if (num % 2 == 0)
		{
			plate.effect("Fill").Color.setValue(redD);

			if (marked == 1)
			{
				plate.effect("Fill").Color.setValue(greenD);
				marked = 0;
			}
		} else {
			plate.effect("Fill").Color.setValue(redL);

			if (marked == 1)
			{
				plate.effect("Fill").Color.setValue(greenD);
				marked = 0;
			}
		}
	}
}

function placePlate(plate, textLayer)
{
	if (!plate) return;

	var r = textLayer.sourceRectAtTime();

	var scaleX = (r.width + PLATE_PAD * 2) / PLATE_BASE_PX * 100;
	if (PLATE_BASE_PX > 0 && isFinite(scaleX) && scaleX > 0)
		plate.scale[0] = scaleX;

	plate.transform.position.x = textLayer.transform.position.x - PLATE_PAD;
}

function total_width()
{
	var totalWidth = 0;

	for (var i = 0; i < textLayers.length; i++)
	{
		var w = textLayers[i].sourceRectAtTime().width;
		totalWidth += w + padding;
	}
	return totalWidth;
}

function check_out()
{
	if (master.transform.position.x + total_width() + cycleOffset < region_end && readyToOut && TTL > 0)
	{
		thisProject.SetState("OUT", false);
		Logger.debug("Command to OUT!");
		readyToOut = false;
	}
}

function hideSlot(textLayer, plate)
{
	if (textLayer)
	{
		textLayer.property("Source Text").setValue("");
		textLayer.Enabled = false;
		textLayer.transform.opacity = 0;
	}
	if (plate)
	{
		plate.Enabled = false;
		plate.scale[0] = 100;
	}
}


function ticker(action)
{
	buildLayerNameSet();

	var ttlLayer = getLayer("TTL");
	TTL = ttlLayer ? parseInt(ttlLayer.property("Source Text").value) : 0;
	if (isNaN(TTL)) TTL = 0;

	if (!getLayer("inputext"))
	{
		Logger.error("Нет слоя inputext");
		return;
	}

	ticker_elements = readInputLines();

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
	textVisGap     = 0;

	var totalWidth = 0;
	var hasNews = ticker_elements.length > 0;

	for (var k = 1; k <= text_cont_count; k++)
	{
		var textLayer = getLayer("myText " + k);
		if (!textLayer) continue;

		var plate = plateForText(textLayer);

		switch (action)
		{
			case "init":
				// Пустой ввод: не заполняем слои пустыми строками —
				// иначе width≈0 и полоса ломается.
				if (!hasNews)
				{
					hideSlot(textLayer, plate);
					master.transform.position.x = region_start;
					break;
				}

				if (ticker_element >= ticker_elements.length)
				{
					ticker_element = 0;
					TTL > 0 && (ticker_counter += 1);
				}

				if (TTL >= ticker_counter && TTL > 0) break;

				textLayer.property("Source Text").setValue(ticker_elements[ticker_element]);
				ticker_element += 1;

				textLayers.push(textLayer);
				plateLayers.push(plate);

				fixMarkedText(plate, textLayer);

				var textRect     = textLayer.sourceRectAtTime();
				var textWidth    = textRect.width;
				var layerPos     = totalWidth;
				var elementWidth = textWidth + padding;

				elementsWidth.push(elementWidth);

				textLayer.transform.position.x = layerPos;
				textLayer.Enabled = true;
				textLayer.transform.opacity = 100;

				placePlate(plate, textLayer);
				plateColor(plate, textLayer);

				totalWidth = totalWidth + elementWidth;

				if (TTL != 0) lastElement = textLayers.length - 1;
				break;

			case "clear":
				hideSlot(textLayer, plate);
				textLayer.scale[0] = 100;
				textLayer.transform.position.x = 0;
				master.transform.position.x = region_start;
				break;
		}
	}
}

function ticker_anim()
{
	ticker_elements = readInputLines();

	// Полоса ещё не собрана (init был с пустым вводом) — ждём текст.
	if (!textLayers.length || !elementsWidth.length)
	{
		if (ticker_elements.length > 0)
			ticker("init");
		return;
	}

	master.transform.position.x -= speed;
	var textLayer;
	var plate;

	check_out();

	if (master.transform.position.x + elementsWidth[anim_i] + cycleOffset < region_visible_end)
	{
		if (ticker_elements.length > 0 && ticker_element >= ticker_elements.length)
		{
			ticker_element = 0;
			TTL > 0 && (ticker_counter += 1);
		}

		if (TTL >= ticker_counter && TTL > 0) return;

		textLayer = textLayers[anim_i];
		plate     = plateLayers[anim_i];
		textVisGap += 1;

		changeLayer = true;
		textLayer.transform.opacity = 0;
		textLayer.Enabled = false;

		if (plate) plate.Enabled = false;
		readyToOut = false;

		var textLayerX = textLayer.transform.position.x;

		if (master.transform.position.x + elementsWidth[anim_i] + cycleOffset > region_end) return;

		if (frame % 12 === 0 && changeLayer && textVisGap > 28)
		{
			// переносим элемент в конец полосы
			textLayer.transform.position.x = textLayerX + total_width();

			cycleOffset += elementsWidth[anim_i];

			// Пустой ввод: не подставляем "" в слой и не включаем его обратно.
			// Ширину оставляем прежней (>= padding), чтобы математика полосы не рухнула.
			if (!ticker_elements.length)
			{
				textLayer.property("Source Text").setValue("");
				if (elementsWidth[anim_i] < padding)
					elementsWidth[anim_i] = padding;

				if (plate)
				{
					plate.Enabled = false;
					plate.scale[0] = 100;
				}

				anim_i += 1;
				if (anim_i >= textLayers.length) anim_i = 0;

				changeLayer = false;
				lastElement = anim_i;
				readyToOut = true;
				textVisGap = 0;
			}
			else
			{
				if (ticker_element >= ticker_elements.length) ticker_element = 0;

				textLayer.property("Source Text").setValue(ticker_elements[ticker_element]);
				fixMarkedText(plate, textLayer);

				var textRect       = textLayer.sourceRectAtTime();
				var textLayerWidth = textRect.width;
				// защита от нулевой ширины (на всякий случай)
				elementsWidth[anim_i] = Math.max(textLayerWidth, 1) + padding;

				placePlate(plate, textLayer);
				plateColor(plate, textLayer);

				anim_i += 1;
				ticker_element += 1;

				if (anim_i >= textLayers.length)
					anim_i = 0;

				// После рецикла сразу включаем слот обратно.
				// (Старое "a < x < b" в JS почти всегда было true и как раз
				// включало текст; узкое окно region_start..gap ломало это —
				// плашка жила через fixMarkedText, а текст оставался opacity=0.)
				changeLayer = false;
				lastElement = anim_i;
				readyToOut = true;

				textLayer.Enabled = true;
				textLayer.transform.opacity = 100;
				if (plate) plate.Enabled = true;
				textVisGap = 0;
			}
		}
	}
	frame += 1;
}

ticker("clear");
ticker("init");
