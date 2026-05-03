// 05. Случайная позиция слоя.
// generateRandomNumber() возвращает число в диапазоне [0; 1].

var main = comp("Main Comp");
if (main == null) {
    alert('Композиция "Main Comp" не найдена.');
} else {
    var layer = main.layer("Logo");

    if (layer == null) {
        alert('Слой "Logo" не найден.');
    } else {
        var screenWidth = 1920;
        var screenHeight = 1080;

        var x = generateRandomNumber() * screenWidth;
        var y = generateRandomNumber() * screenHeight;

        layer.transform.position.setValue([x, y, 0.0]);

        writeLn("Новая позиция Logo: " + x.toFixed(1) + ", " + y.toFixed(1));
    }
}
