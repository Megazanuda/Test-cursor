// 10. Безопасный доступ к элементам шаблона.
// Все функции поиска (comp, footage, layer, effect) возвращают null,
// если объект не найден. Проверяйте результат перед использованием,
// иначе скрипт упадёт с ошибкой и остановит выдачу графики.

function getLayer(compName, layerName) {
    var c = comp(compName);
    if (c == null) {
        writeLn('Композиция "' + compName + '" не найдена.');
        return null;
    }
    var l = c.layer(layerName);
    if (l == null) {
        writeLn('Слой "' + layerName + '" не найден в "' + compName + '".');
        return null;
    }
    return l;
}

function setText(compName, layerName, value) {
    var l = getLayer(compName, layerName);
    if (l == null) {
        return false;
    }
    if (l.text == null) {
        writeLn('Слой "' + layerName + '" не является текстовым.');
        return false;
    }
    l.text.sourceText.setValue(value);
    return true;
}

if (setText("Lower Third", "Name", "Иван Иванов")) {
    writeLn("Имя установлено.");
}
if (setText("Lower Third", "Position", "Ведущий эфира")) {
    writeLn("Должность установлена.");
}
