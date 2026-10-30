/* =====================================================================
   easeEase — универсальный Easy Ease (как в After Effects)
   ---------------------------------------------------------------------
   Линейное движение в скрипте:   y = lerp(a, b, t)
   С Easy Ease:                   y = easeLerp(a, b, t)
                                  или lerp(a, b, easeEase(t))

   t — прогресс 0…1 (кадр/длительность, время/длительность и т.п.)
   На выходе — тот же 0…1, но с замедлением в начале и в конце
   (Easy Ease In + Easy Ease Out).

   Приближение к дефолтному Easy Ease AE (influence ≈ 33%):
   кубическая кривая ease-in-out. Для большинства плашек/тизеров
   визуально совпадает с AE.

   Скопируй нужные функции в Startup любого шаблона.
   ===================================================================== */

// Линейная интерполяция (без сглаживания).
function lerp(a, b, t)
{
	return a + (b - a) * t;
}

// Ограничить t в [0, 1].
function clamp01(t)
{
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	return t;
}

// --- Easy Ease (in + out), аналог Easy Ease в AE ---
// Кубическая: медленный старт → быстро в середине → медленный финиш.
function easeEase(t)
{
	t = clamp01(t);
	return t < 0.5
		? 4 * t * t * t
		: 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Только разгон в начале (Easy Ease In / ease out of stop).
function easeIn(t)
{
	t = clamp01(t);
	return t * t * t;
}

// Только торможение в конце (Easy Ease Out).
function easeOut(t)
{
	t = clamp01(t);
	return 1 - Math.pow(1 - t, 3);
}

// Удобная обёртка: сразу интерполяция a→b с Easy Ease.
function easeLerp(a, b, t)
{
	return lerp(a, b, easeEase(t));
}

function easeInLerp(a, b, t)
{
	return lerp(a, b, easeIn(t));
}

function easeOutLerp(a, b, t)
{
	return lerp(a, b, easeOut(t));
}

/* ---------------------------------------------------------------------
   Примеры

   1) Покадровое движение Y за EXIT_FRAMES кадров:
        var t = phaseFrame / EXIT_FRAMES;          // 0…1 линейно
        var y = easeLerp(1047, 1025, t);           // с Easy Ease
        var o = easeLerp(100, 0, t);

   2) Уже есть линейный sampleKeys — сгладить весь сегмент:
        var t = easeEase(phaseFrame / ENTER_FRAMES);
        var y = lerp(1070, 1047, t);

   3) Несколько ключей AE, снятых с шагом 5 кадров, УЖЕ содержат
      кривую — поверх них easeEase обычно НЕ нужен (получится
      «двойной» ease). Easy Ease бери для движения «из A в B».
   --------------------------------------------------------------------- */
