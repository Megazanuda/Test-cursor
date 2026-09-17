/* =====================================================================
   Смена двух текстовых плашек (state RUN)
   ---------------------------------------------------------------------
   В state RUN плашки по очереди:
     1) HOLD — передняя стоит на экране HOLD_SEC секунд (X=1047, opacity=100);
     2) TRANSITION — передняя уходит (X 1047→1025, opacity 100→0),
        задняя параллельно входит снизу (X 1070→1047, opacity 0→100);
     3) роли меняются, снова HOLD.

   Ключи сняты с шагом 5 кадров. Длительность шага = 5 / FPS секунд.
   Анимируются только position.x и opacity (Y не трогаем).

   Скопируй блоки в поля Carrot: STARTUP / SETSTATE / PROCESSFRAME.
   ===================================================================== */


/* ===================== // STARTUP ===================== */

// --- Настройки ---
var PLATE_A_NAME = "Plate 1";   // имя первого текстового слоя
var PLATE_B_NAME = "Plate 2";   // имя второго текстового слоя
var HOLD_SEC     = 3;           // сколько секунд плашка стоит на экране
var FPS          = 25;          // fps композиции (шаг ключей = 5 кадров)
var KEY_STEP     = 5;           // шаг ключей в кадрах
// -----------------

// Ключи EXIT (уход): кадры 0,5,10,15,20
var EXIT_X = [1047, 1044, 1038, 1031, 1025];
var EXIT_O = [100, 84, 50, 16, 0];

// Ключи ENTER (вход снизу): кадры 0,5,10,15,20,25 относительно начала входа
// (в исходной съёмке это точки после «телепорта» на 1070)
var ENTER_X = [1070, 1065, 1059, 1053, 1049, 1047];
var ENTER_O = [0, 18, 45, 71, 91, 100];

var REST_X   = EXIT_X[0];                 // 1047 — позиция на экране
var PARK_X   = ENTER_X[0];                // 1070 — парковка снизу (скрыта)
var STEP_SEC = KEY_STEP / FPS;            // длительность одного шага ключей
var EXIT_DUR = (EXIT_X.length - 1) * STEP_SEC;
var ENTER_DUR = (ENTER_X.length - 1) * STEP_SEC;
var TRANS_DUR = Math.max(EXIT_DUR, ENTER_DUR);

// phase: "hold" | "trans"
var phase = "hold";
var phaseStart = 0;
var frontIsA = true;   // true → Plate A на экране, B припаркована


function getPlate(name)
{
	return thisComp.layer(name);
}

function setXO(layer, x, opacity)
{
	if (!layer) return;
	layer.transform.position.x = x;
	// opacity в Carrot: и через transform.opacity, и через .opacity — пробуем оба стиля
	try { layer.transform.opacity = opacity; } catch (e) {}
	try { layer.transform.opacity.setValue(opacity); } catch (e2) {}
}

function lerp(a, b, t)
{
	return a + (b - a) * t;
}

// Выборка значения из массива ключей по времени (линейная интерполяция между ключами).
function sampleKeys(keys, tSec)
{
	if (tSec <= 0) return keys[0];
	var maxT = (keys.length - 1) * STEP_SEC;
	if (tSec >= maxT) return keys[keys.length - 1];

	var f = tSec / STEP_SEC;          // позиция в «шагах»
	var i = Math.floor(f);
	var frac = f - i;
	if (i >= keys.length - 1) return keys[keys.length - 1];
	return lerp(keys[i], keys[i + 1], frac);
}

function park(layer)
{
	setXO(layer, PARK_X, 0);
}

function rest(layer)
{
	setXO(layer, REST_X, 100);
}

function applyTransition(t)
{
	var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
	var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);

	// Передняя — EXIT (после окончания EXIT держим PARK)
	if (t >= EXIT_DUR)
		park(front);
	else
		setXO(front, sampleKeys(EXIT_X, t), sampleKeys(EXIT_O, t));

	// Задняя — ENTER с t=0 (параллельно)
	if (t <= 0)
		park(back);
	else if (t >= ENTER_DUR)
		rest(back);
	else
		setXO(back, sampleKeys(ENTER_X, t), sampleKeys(ENTER_O, t));
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
	// В момент старта: front ещё на REST, back на PARK — applyTransition(0) это подтвердит
	applyTransition(0);
}

function initRun()
{
	frontIsA = true;
	startHold();
}

function updateRun()
{
	var elapsed = time - phaseStart;

	if (phase == "hold")
	{
		// На всякий случай держим позы (если что-то снаружи сдвинуло)
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
		frontIsA = !frontIsA;
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
