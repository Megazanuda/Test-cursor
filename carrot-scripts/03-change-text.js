// 03. Изменение текста текстового слоя
// Берёт композицию "Main Comp" и меняет текст слоя "Title".
// Для изменения любого свойства используется метод setValue().

var main = comp("Main Comp");

if (main == null) {
    alert('Композиция "Main Comp" не найдена.');
} else {
    var title = main.layer("Title");

    if (title == null) {
        alert('Слой "Title" не найден в "Main Comp".');
    } else {
        var newText = "Добро пожаловать в эфир!";
        title.text.sourceText.setValue(newText);
        writeLn("Текст слоя обновлён: " + newText);
    }
}
