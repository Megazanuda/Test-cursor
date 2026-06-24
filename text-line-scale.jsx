// Скрипт для текстового слоя с динамическим количеством строк.
// - Скейл текста: 100% при 1-2 строках, 172/N при N>=3.
// - Anchor автоматически выставляется в правый нижний угол ТЕКУЩЕГО source rect,
//   чтобы визуальная позиция не "плавала" при смене текста.
// - Позиция (визуальный bottom-right текста) ставится в (BASE_X, BASE_Y),
//   с возможным сдвигом по X на SHIFT_X, если внешняя переменная `control` > 5.

// === Параметры (поправь под свой проект) ===
var COMP_NAME  = "Comp 1";    // имя композиции
var LAYER_NAME = "text";      // имя текстового слоя

// Куда попадёт визуальный правый нижний угол текста после прогона скрипта.
// Эти координаты теперь работают как абсолютные — никаких Y_STEP-таблиц
// больше не нужно, поскольку якорь автоматически синхронизируется с source rect.
var BASE_X = 1577;
var BASE_Y = 955;

// На сколько пикселей сдвинуть слой вправо, когда control > 5
var SHIFT_X = 125;

// === Внешняя логика Carrot Broadcast ===
ageRating = thisComp.layer("variable").TextSource.Text;
EnabledRating(ageRating);

// === Логика ===
var comp = app.project.item(COMP_NAME);
var txt  = comp.layer(LAYER_NAME);

// 1. Считаем количество непустых строк
var raw = txt.TextSource.Text.split(/[\r\n]+/);
var nLines = 0;
for (var i = 0; i < raw.length; i++) {
    if (raw[i].trim().length > 0) nLines++;
}
if (nLines < 1) nLines = 1;

// 2. Скейл: 100% для 1-2 строк, 172/N для большего числа строк
//    (3 -> 57.33, 4 -> 43, 5 -> 34.4 и т.д.)
var scalePct = nLines <= 2 ? 100 : 172 / nLines;
var oldScale = txt.transform.scale.value;
txt.transform.scale.setValue([scalePct, scalePct, oldScale[2] || 100]);

// 3. Якорь — автоматически в правый нижний угол текущего source rect.
//    Важно: якорь, выставленный вручную в After Effects, "застывает" в одной точке
//    source coords. При смене текста source rect меняется (другое количество строк,
//    другая длина), а якорь остаётся там же — и уже не совпадает с реальным
//    правым нижним углом. Из-за этого визуальная позиция плывёт, хотя
//    transform.position в инспекторе остаётся прежней (955).
//    Перевыставляя якорь на каждом прогоне, мы гарантируем, что position
//    действительно совпадает с визуальным bottom-right текста.
var srcRect = txt.sourceRectAtTime(false);
txt.transform.anchorPoint.setValue([
    srcRect.left + srcRect.width,
    srcRect.top + srcRect.height,
    0
]);

// 4. Позиция: визуальный правый нижний угол окажется ровно в (newX, BASE_Y),
//    независимо от количества строк и скейла.
var newX = BASE_X + (control > 5 ? SHIFT_X : 0);
var pos  = txt.transform.position.value;
txt.transform.position.setValue([newX, BASE_Y, pos[2] || 0]);
