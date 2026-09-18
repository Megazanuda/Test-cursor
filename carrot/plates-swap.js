/* =====================================================================
   Смена myText 1 / myText 2 (linesPreComp), state RUN
   ---------------------------------------------------------------------
   Композиция: 50 fps.
   Опорные ключи сняты каждые 5 кадров — по ним считаем Y/opacity
   на КАЖДЫЙ кадр (линейная интерполяция между ключами).
   ProcessFrame двигает анимацию на 1 кадр за вызов.

   Startup  = всё до маркера SETSTATE
   SetState / ProcessFrame = блоки внизу файла
   ===================================================================== */


/* ===================== STARTUP ===================== */

var LINES_COMP   = "linesPreComp";
var PLATE_A_NAME = "myText 1";
var PLATE_B_NAME = "myText 2";

var HOLD_SEC = 3;    // пауза на экране, секунды
var FPS      = 50;   // fps композиции
var KEY_STEP = 5;    // опорные ключи каждые 5 кадров

// Опорные ключи EXIT (уход вверх): кадры 0,5,10,15,20
var EXIT_Y = [1047, 1044, 1038, 1031, 1025];
var EXIT_O = [100, 84, 50, 16, 0];

// Опорные ключи ENTER (вход снизу): кадры 0,5,10,15,20,25
var ENTER_Y = [1070, 1065, 1059, 1053, 1049, 1047];
var ENTER_O = [0, 18, 45, 71, 91, 100];

var REST_Y = EXIT_Y[0];   // 1047 — на экране
var PARK_Y = ENTER_Y[0];  // 1070 — ждёт снизу

var HOLD_FRAMES  = Math.round(HOLD_SEC * FPS);           // 150 при 3с / 50fps
var EXIT_FRAMES  = (EXIT_Y.length - 1) * KEY_STEP;       // 20
var ENTER_FRAMES = (ENTER_Y.length - 1) * KEY_STEP;      // 25
var TRANS_FRAMES = Math.max(EXIT_FRAMES, ENTER_FRAMES);  // 25

var phase = "hold";
var phaseFrame = 0;   // счётчик кадров текущей фазы (каждый ProcessFrame +1)
var frontIsA = true;
var runInited = false;


function isRunState()
{
	return String(statename || "").toLowerCase() === "run";
}

function getLC()
{
	return app.project.item(LINES_COMP);
}

function getPlate(name)
{
	return getLC().layer(name);
}

function lerp(a, b, t)
{
	return a + (b - a) * t;
}

// Покадровая выборка: frame = 0,1,2,... между опорными ключами (шаг KEY_STEP).
// Пример EXIT на кадре 7: между ключами кадра 5 (1044) и 10 (1038)
//   t = (7-5)/5 = 0.4 → Y = 1044 + (1038-1044)*0.4
function sampleKeys(keys, frame)
{
	if (frame <= 0) return keys[0];

	var maxF = (keys.length - 1) * KEY_STEP;
	if (frame >= maxF) return keys[keys.length - 1];

	var i = Math.floor(frame / KEY_STEP);
	var local = frame - i * KEY_STEP;
	var t = local / KEY_STEP;
	return lerp(keys[i], keys[i + 1], t);
}

function setYO(layer, y, opacity)
{
	if (!layer) return;

	layer.transform.position.y = y;
	layer.transform.opacity = opacity;

	try
	{
		var v = layer.transform.position.value;
		if (v && v.length)
			layer.transform.position.setValue([v[0], y, v[2] != null ? v[2] : 0]);
	}
	catch (e) {}

	try { layer.transform.opacity.setValue(opacity); } catch (e2) {}
}

function park(layer) { setYO(layer, PARK_Y, 0); }
function rest(layer) { setYO(layer, REST_Y, 100); }

function applyTransition(f)
{
	var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
	var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);

	// Передняя уходит вверх по кадрам 0..EXIT_FRAMES, потом паркуется вниз
	if (f >= EXIT_FRAMES)
		park(front);
	else
		setYO(front, sampleKeys(EXIT_Y, f), sampleKeys(EXIT_O, f));

	// Задняя параллельно входит снизу по кадрам 0..ENTER_FRAMES
	if (f <= 0)
		park(back);
	else if (f >= ENTER_FRAMES)
		rest(back);
	else
		setYO(back, sampleKeys(ENTER_Y, f), sampleKeys(ENTER_O, f));
}

function startHold()
{
	phase = "hold";
	phaseFrame = 0;

	var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
	var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);
	rest(front);
	park(back);
}

function startTrans()
{
	phase = "trans";
	phaseFrame = 0;
	applyTransition(0);
}

function initRun()
{
	frontIsA = true;
	runInited = true;
	startHold();
	printLog("[plates-swap] init RUN @50fps hold=" + HOLD_FRAMES + "f trans=" + TRANS_FRAMES + "f");
}

// Вызывать каждый кадр из ProcessFrame
function updateRun()
{
	if (!runInited)
		initRun();

	if (phase == "hold")
	{
		var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
		var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);
		rest(front);
		park(back);

		phaseFrame += 1; // +1 кадр
		if (phaseFrame >= HOLD_FRAMES)
		{
			printLog("[plates-swap] transition start");
			startTrans();
		}
		return;
	}

	// Каждый кадр transition: ставим позу для текущего phaseFrame, потом +1
	applyTransition(phaseFrame);
	phaseFrame += 1;

	if (phaseFrame >= TRANS_FRAMES)
	{
		frontIsA = !frontIsA;
		printLog("[plates-swap] swap -> front " + (frontIsA ? PLATE_A_NAME : PLATE_B_NAME));
		startHold();
	}
}


/* ===================== SETSTATE ===================== */
/*
if (isRunState())
{
	runInited = false;
	initRun();
}
*/


/* ===================== PROCESSFRAME ===================== */
/*
if (isRunState())
{
	updateRun();
}
*/
