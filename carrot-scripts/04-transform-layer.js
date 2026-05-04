// 04. Преобразования слоя: позиция, масштаб, вращение, непрозрачность.

var main = comp("Main Comp");
if (main == null) {
    alert('Композиция "Main Comp" не найдена.');
} else {
    var layer = main.layer(1);

    if (layer == null) {
        alert("В композиции нет слоёв.");
    } else {
        layer.transform.position.setValue([960.0, 540.0, 0.0]);

        layer.transform.scale.setValue([120.0, 120.0, 100.0]);

        // Вращение по оси Z (в градусах).
        layer.transform.rotation.setValue(15.0);

        layer.transform.opacity.setValue(80.0);

        writeLn("Слой '" + layer.name + "' трансформирован.");
    }
}
