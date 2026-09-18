/* =====================================================================
   Смена myText 1 / myText 2 в linesPreComp (state RUN)
   ---------------------------------------------------------------------
   Тайминг — ПО КАДРАМ (не time): так надёжнее в Carrot.
   Анимация: position.y + opacity. X не трогаем.

   Скопируй три блока ниже в Startup / SetState / ProcessFrame.
   ===================================================================== */


/* ===================== STARTUP (целиком в поле Startup) ===================== */

var LINES_COMP   = "linesPreComp";
var PLATE_A_NAME = "myText 1";
var PLATE_B_NAME = "myText 2";

var HOLD_SEC = 3;   // пауза на экране, секунды
var FPS      = 25;  // fps композиции
var KEY_STEP = 5;   // шаг ключей в кадрах

// EXIT — уход вверх (Y↓), opacity 100→0
var EXIT_Y = [1047, 1044, 1038, 1031, 1025];
var EXIT_O = [100, 84, 50, 16, 0];

// ENTER — вход снизу (Y 1070→1047), opacity 0→100
var ENTER_Y = [1070, 1065, 1059, 1053, 1049, 1047];
var ENTER_O = [0, 18, 45, 71, 91, 100];

var REST_Y = EXIT_Y[0];   // 1047
var PARK_Y = ENTER_Y[0];  // 1070

var HOLD_FRAMES  = Math.round(HOLD_SEC * FPS);
var EXIT_FRAMES  = (EXIT_Y.length - 1) * KEY_STEP;   // 20
var ENTER_FRAMES = (ENTER_Y.length - 1) * KEY_STEP;  // 25
var TRANS_FRAMES = Math.max(EXIT_FRAMES, ENTER_FRAMES);

var phase = "hold";      // hold | trans
var phaseFrame = 0;
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

// frame — кадры от начала кривой; ключи каждые KEY_STEP кадров
function sampleKeys(keys, frame)
{
	if (frame <= 0) return keys[0];
	var maxF = (keys.length - 1) * KEY_STEP;
	if (frame >= maxF) return keys[keys.length - 1];

	var f = frame / KEY_STEP;
	var i = Math.floor(f);
	var frac = f - i;
	if (i >= keys.length - 1) return keys[keys.length - 1];
	return lerp(keys[i], keys[i + 1], frac);
}

function setYO(layer, y, opacity)
{
	if (!layer) return;

	// Как в рабочей бегущей строке: прямое присваивание компонентов
	layer.transform.position.y = y;
	layer.transform.opacity = opacity;

	// Запасной путь через value/setValue (если движок так требует)
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

	// Передняя: EXIT, затем парковка вниз
	if (f >= EXIT_FRAMES)
		park(front);
	else
		setYO(front, sampleKeys(EXIT_Y, f), sampleKeys(EXIT_O, f));

	// Задняя: ENTER параллельно
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
	printLog("[plates-swap] initRun: hold " + HOLD_FRAMES + "f, trans " + TRANS_FRAMES + "f");
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
			printLog("[plates-swap] start transition, front=" + (frontIsA ? PLATE_A_NAME : PLATE_B_NAME));
			startTrans();
		}
		return;
	}

	// trans
	applyTransition(phaseFrame);
	phaseFrame += 1;

	if (phaseFrame >= TRANS_FRAMES)
	{
		frontIsA = !frontIsA;
		printLog("[plates-swap] swap done, now front=" + (frontIsA ? PLATE_A_NAME : PLATE_B_NAME));
		startHold();
	}
}


/* ----- SETSTATE (только это в поле SetState) -----
if (isRunState())
{
	runInited = false;
	initRun();
}
----- */

/* ----- PROCESSFRAME (только это в поле ProcessFrame) -----
if (isRunState())
{
	updateRun();
}
----- */
