/* =====================================================================
   Движение текста "Name" за null'ом с учётом ширины текста
   ---------------------------------------------------------------------
   null "Null 2" едет по X от NULL_START до NULL_END. Текст "Name" должен
   ехать за ним, но проходить путь, зависящий от своей ширины: чем шире
   текст — тем длиннее путь.

   Модель (выведена из твоей рабочей точки: ширина 466 -> коэффициент 2.35):
     - путь null'а            = NULL_TRAVEL = NULL_END - NULL_START = 1587
     - путь текста при 466    = NULL_TRAVEL / 2.35 = 675
     - значит путь текста     = ширина + REVEAL, где REVEAL = 675 - 466 = 209
     - коэффициент            = NULL_TRAVEL / (ширина + REVEAL)

   Калибровка (поменяй, если поменяется композиция):
   ===================================================================== */

var NULL_START  = 326;                    // старт null'а по X
var NULL_END    = 1913;                   // финиш null'а по X
var NULL_TRAVEL = NULL_END - NULL_START;  // 1587

var CAL_WIDTH = 466;    // ширина текста, при которой коэффициент подобран
var CAL_COEFF = 2.35;   // сам подобранный коэффициент

// Фиксированная добавка к пути (насколько путь текста длиннее его ширины).
var REVEAL = NULL_TRAVEL / CAL_COEFF - CAL_WIDTH;   // ≈ 209

// Стартовая позиция текста по X (та же, что и в твоём варианте: NULL_START / CAL_COEFF).
var TEXT_START = NULL_START / CAL_COEFF;            // ≈ 138.7


// ---------------------------------------------------------------------
// Вариант 1 (рекомендуемый): явное линейное отображение.
// Старт текста ФИКСИРОВАН, с шириной меняется только длина пути.
// ---------------------------------------------------------------------
function nameX(nullX, width)
{
    var p = (nullX - NULL_START) / NULL_TRAVEL;   // прогресс null'а 0..1
    return TEXT_START + p * (width + REVEAL);
}

function setEndPos()
{
    var width = thisComp.layer("Name").sourceRectAtTime(false).width;
    var nullX = thisComp.layer("Null 2").transform.position.x;
    thisComp.layer("Name").transform.position.x = nameX(nullX, width);
}


// ---------------------------------------------------------------------
// Вариант 2 (минимальная правка): оставляем деление, но коэффициент
// считаем от ширины. ВНИМАНИЕ: при этом стартовая позиция текста
// (= nullX / coeff) тоже слегка зависит от ширины.
// ---------------------------------------------------------------------
function speedCoeff(width)
{
    return NULL_TRAVEL / (width + REVEAL);
}

// function setEndPos()
// {
//     var width = thisComp.layer("Name").sourceRectAtTime(false).width;
//     thisComp.layer("Name").transform.position.x =
//         thisComp.layer("Null 2").transform.position.x / speedCoeff(width);
// }
