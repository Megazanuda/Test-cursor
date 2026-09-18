/* =====================================================================
   Name follows Null — движение текста "Name" за null'ом
   ---------------------------------------------------------------------
   - "Null 2" едет по X от BASE_X(326) до NULL_END(1913).
   - "Name" едет за ним: Name.x = Null.x / C(width), где коэффициент
     зависит от ширины текста:  C(width) = NULL_END / (width + K).
     Калибровка K по двум замерам (466->2.35, 761.3->1.73): K ≈ 346.
   - updateLines раскладывает "Line_input" по строкам в Line_1 / Line_2,
     масштабирует их и смещает прекомп по вертикали.
   ===================================================================== */


/* ===== Константы и переменные ===== */

var preCompLayer = thisComp.layer("Pre-comp Line1");
var preCompItem  = app.project.item("Pre-comp Line1");

var BASE_Y   = 540;
var BASE_X   = 326;     // старт null'а по X
var NULL_END = 1913;    // финиш null'а по X
var K        = 346;     // калибровка: C(width) = NULL_END / (width + K)

var checker = true;


/* ===== Функции ===== */

// Разбивка текста исходного слоя по строкам в целевые слои.
// Пустой/отсутствующий текст корректно очищает целевые слои.
function splitTextToLayers(src, targets)
{
    var text = src.TextSource.Text;
    var raw = (text ? text : "").split(/[\r\n]+/);
    var lines = [];

    for (var i = 0; i < raw.length; i++)
        if (raw[i].trim() !== "")
            lines.push(raw[i].trim());

    for (var j = 0; j < targets.length; j++)
        targets[j].TextSource.Text = j < lines.length ? lines[j] : "";
}

// Количество непустых строк в тексте.
function countLines(txt)
{
    var raw = (txt ? txt : "").split(/[\r\n]+/);
    var n = 0;

    for (var i = 0; i < raw.length; i++)
        if (raw[i].trim() !== "")
            n++;

    return n;
}

// Раскладка строк из "Line_input" + масштаб + вертикальное смещение.
function updateLines()
{
    var count = countLines(thisComp.layer("Line_input").TextSource.Text);

    splitTextToLayers(thisComp.layer("Line_input"),
                      [preCompItem.layer("Line_1"), thisComp.layer("Line_2")]);

    var s = (count >= 2) ? 85 : 100;
    preCompItem.layer("Line_1").transform.scale.setValue([s, s, 0]);
    thisComp.layer("Line_2").transform.scale.setValue([s, s, 0]);

    preCompLayer.transform.position.y = (count <= 1) ? BASE_Y + 9 : BASE_Y;
}

// Коэффициент замедления текста для заданной ширины.
function speedCoeff(width)
{
    return NULL_END / (width + K);
}

// Позиционируем "Name" за "Null 2" с учётом ширины текста.
function setEndPos()
{
    var width = thisComp.layer("Name").sourceRectAtTime(false).width;
    thisComp.layer("Name").transform.position.x =
        thisComp.layer("Null 2").transform.position.x / speedCoeff(width);
}

// Флаг: не дошёл ли null до точки "старт + ширина текста".
function checkPos()
{
    var width = thisComp.layer("Name").sourceRectAtTime(false).width;
    checker = thisComp.layer("Null 2").transform.position.x < BASE_X + width;
}


/* ---------------------------------------------------------------------
   Пересчёт K по двум своим точкам (w1,C1) и (w2,C2), если нужно:

     function calibrateK(w1, C1, w2, C2) {
         return ((NULL_END / C1 - w1) + (NULL_END / C2 - w2)) / 2;
     }
     K = calibrateK(466, 2.35, 761.3, 1.73);   // ≈ 346

   Где вызывать функции (пример):
     - SetState (вход в state):   updateLines();
     - ProcessFrame (каждый кадр): checkPos();  setEndPos();
   --------------------------------------------------------------------- */
