/* =====================================================================
   Смена myText 1 / myText 2 (linesPreComp), state RUN + Easy Ease
   ---------------------------------------------------------------------
   Композиция: 50 fps. Анимация каждый кадр.
   Уход / вход — прямолинейно по длительности, сглаживание easeEase
   (как Easy Ease в AE), без таблицы ключей.

   EXIT:  Y 1047→1025, opacity 100→0  (уход вверх)
   затем парковка вниз Y=1070, opacity 0
   ENTER: Y 1070→1047, opacity 0→100 (вход снизу), параллельно EXIT

   Startup  = до маркера SETSTATE
   SetState / ProcessFrame = блоки внизу
   ===================================================================== */


/* ===================== STARTUP ===================== */

var LINES_COMP   = "linesPreComp";
var PLATE_A_NAME = "myText 1";
var PLATE_B_NAME = "myText 2";

var HOLD_SEC     = 3;    // пауза на экране, секунды
var FPS          = 50;
var EXIT_FRAMES  = 20;   // длительность ухода (было 4*5 ключей)
var ENTER_FRAMES = 25;   // длительность входа (было 5*5 ключей)

var REST_Y = 1047;       // на экране
var EXIT_Y = 1025;       // верхняя точка ухода (перед парковкой)
var PARK_Y = 1070;       // ожидание снизу

var HOLD_FRAMES  = Math.round(HOLD_SEC * FPS);
var TRANS_FRAMES = Math.max(EXIT_FRAMES, ENTER_FRAMES);

var phase = "hold";
var phaseFrame = 0;
var frontIsA = true;
var runInited = false;


/* ---------- Easy Ease (из ease.js) ---------- */

function lerp(a, b, t)
{
	return a + (b - a) * t;
}

function clamp01(t)
{
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	return t;
}

// Easy Ease In + Out ≈ дефолтный Easy Ease в AE
function easeEase(t)
{
	t = clamp01(t);
	return t < 0.5
		? 4 * t * t * t
		: 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeLerp(a, b, t)
{
	return lerp(a, b, easeEase(t));
}

/* ---------- слои / позы ---------- */

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

// t01 = phaseFrame / длительность сегмента (0…1), каждый кадр
function applyTransition(f)
{
	var front = frontIsA ? getPlate(PLATE_A_NAME) : getPlate(PLATE_B_NAME);
	var back  = frontIsA ? getPlate(PLATE_B_NAME) : getPlate(PLATE_A_NAME);

	// Передняя: EXIT с Easy Ease, потом парковка вниз
	if (f >= EXIT_FRAMES)
	{
		park(front);
	}
	else
	{
		var te = f / EXIT_FRAMES;
		setYO(front, easeLerp(REST_Y, EXIT_Y, te), easeLerp(100, 0, te));
	}

	// Задняя: ENTER с Easy Ease параллельно
	if (f <= 0)
	{
		park(back);
	}
	else if (f >= ENTER_FRAMES)
	{
		rest(back);
	}
	else
	{
		var ti = f / ENTER_FRAMES;
		setYO(back, easeLerp(PARK_Y, REST_Y, ti), easeLerp(0, 100, ti));
	}
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
	printLog("[plates-swap] init RUN ease @50fps hold=" + HOLD_FRAMES +
		"f exit=" + EXIT_FRAMES + "f enter=" + ENTER_FRAMES + "f");
}

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

		phaseFrame += 1;
		if (phaseFrame >= HOLD_FRAMES)
		{
			printLog("[plates-swap] transition start");
			startTrans();
		}
		return;
	}

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
