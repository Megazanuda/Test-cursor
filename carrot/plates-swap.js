/* =====================================================================
   Смена двух текстовых плашек (state RUN) — анимация по Y + opacity
   ---------------------------------------------------------------------
   Слои в прекомпе linesPreComp: myText 1, myText 2.

   После входа в RUN:
     - myText 1 сразу видна на месте (Y=1047, opacity=100);
     - myText 2 припаркована снизу (Y=1070, opacity=0);
     - HOLD_SEC секунд пауза;
     - TRANSITION: передняя уходит ВВЕРХ (Y↓) и гаснет,
       задняя параллельно поднимается снизу на её место и проявляется;
     - ушедшая после opacity=0 телепортируется вниз (Y=1070) и ждёт;
     - роли меняются → снова HOLD → бесконечно.

   Ключи сняты с шагом 5 кадров (длительность шага = 5/FPS сек).
   Анимируются только position.y и opacity (X не трогаем).

   Скопируй блоки в поля Carrot: STARTUP / SETSTATE / PROCESSFRAME.
   ===================================================================== */


/* ===================== // STARTUP ===================== */

// --- Настройки ---
var LINES_COMP   = "linesPreComp";
var PLATE_A_NAME = "myText 1";
var PLATE_B_NAME = "myText 2";
var HOLD_SEC     = 3;    // сколько секунд плашка стоит на экране до смены
var FPS          = 25;   // fps композиции
var KEY_STEP     = 5;    // шаг ключей в кадрах
// -----------------

// EXIT — уход вверх (Y уменьшается), opacity 100→0
// ключи: кадры 0,5,10,15,20
var EXIT_Y = [1047, 1044, 1038, 1031, 1025];
var EXIT_O = [100, 84, 50, 16, 0];

// ENTER — вход снизу (Y 1070→1047), opacity 0→100
// ключи: кадры 0,5,10,15,20,25 относительно начала входа
var ENTER_Y = [1070, 1065, 1059, 1053, 1049, 1047];
var ENTER_O = [0, 18, 45, 71, 91, 100];

var REST_Y   = EXIT_Y[0];    // 1047 — позиция на экране
var PARK_Y   = ENTER_Y[0];   // 1070 — ожидание снизу (скрыта)
var STEP_SEC = KEY_STEP / FPS;
var EXIT_DUR = (EXIT_Y.length - 1) * STEP_SEC;   // 4 * step
var ENTER_DUR = (ENTER_Y.length - 1) * STEP_SEC; // 5 * step
var TRANS_DUR = Math.max(EXIT_DUR, ENTER_DUR);

var phase = "hold";   // "hold" | "trans"
var phaseStart = 0;
var frontIsA = true;  // true → myText 1 на экране, myText 2 снизу


function getLC()
{
	return app.project.item(LINES_COMP);
}

function getPlate(name)
{
	return getLC().layer(name);
}

function setYO(layer, y, opacity)
{
	if (!layer) return;
	layer.transform.position.y = y;
	try { layer.transform.opacity = opacity; } catch (e) {}
	try { layer.transform.opacity.setValue(opacity); } catch (e2) {}
}

function lerp(a, b, t)
{
	return a + (b - a) * t;
}

// Линейная выборка по ключам: tSec от 0 до (n-1)*STEP_SEC
function sampleKeys(keys, tSec)
{
	if (tSec <= 0) return keys[0];
	var maxT = (keys.length - 1) * STEP_SEC;
	if (tSec >= maxT) return keys[keys.length - 1];

	var f = tSec / STEP_SEC;
	var i = Math.floor(f);
	var frac = f - i;
	if (i >= keys.length - 1) return keys[keys.length - 1];
	return lerp(keys[i], keys[i + 1], frac);
}

function park(layer)
{
	// Скрыта и ждёт снизу следующего своего входа
	setYO(layer, PARK_Y, 0);
}

function rest(layer)
{
	// Стоит на экране
	setYO(layer, REST_Y, 100);
}

function applyTransition(t)
{
	var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
	var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);

	// Передняя уходит вверх; как только EXIT закончился — паркуем вниз
	if (t >= EXIT_DUR)
		park(front);
	else
		setYO(front, sampleKeys(EXIT_Y, t), sampleKeys(EXIT_O, t));

	// Задняя параллельно выезжает снизу на место первой
	if (t <= 0)
		park(back);
	else if (t >= ENTER_DUR)
		rest(back);
	else
		setYO(back, sampleKeys(ENTER_Y, t), sampleKeys(ENTER_O, t));
}

function startHold()
{
	phase = "hold";
	phaseStart = time;

	var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
	var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);
	rest(front);
	park(back);
}

function startTrans()
{
	phase = "trans";
	phaseStart = time;
	applyTransition(0);
}

// Вызов при входе в state RUN
function initRun()
{
	frontIsA = true;   // с начала видна myText 1
	startHold();
}

// Каждый кадр в RUN
function updateRun()
{
	var elapsed = time - phaseStart;

	if (phase == "hold")
	{
		var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
		var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);
		rest(front);
		park(back);

		if (elapsed >= HOLD_SEC)
			startTrans();
		return;
	}

	// phase == "trans"
	if (elapsed >= TRANS_DUR)
	{
		frontIsA = !frontIsA;  // бывшая задняя становится передней
		startHold();
		return;
	}

	applyTransition(elapsed);
}


/* ===================== // SETSTATE ===================== */
/*
if (statename == "RUN" || statename == "run")
{
	initRun();
}
*/


/* ===================== // PROCESSFRAME ===================== */
/*
if (statename == "RUN" || statename == "run")
{
	updateRun();
}
*/
