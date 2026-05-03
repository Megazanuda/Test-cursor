// 06. Чтение и изменение параметра эффекта на слое.
// Для доступа к параметрам эффекта используется универсальный метод property(name).

var main = comp("Main Comp");
if (main == null) {
    alert('Композиция "Main Comp" не найдена.');
} else {
    var layer = main.layer(1);

    if (layer == null) {
        alert("В композиции нет слоёв.");
    } else {
        var curves = layer.effect("Curves");

        if (curves == null) {
            writeLn('Эффект "Curves" на слое не найден.');
        } else {
            var blend = curves.property("BlendWithOriginal");
            writeLn("Текущее значение BlendWithOriginal: " + blend.value);

            blend.setValue(50.0);
            writeLn("Новое значение BlendWithOriginal: " + blend.value);
        }
    }
}
