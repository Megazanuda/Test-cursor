// 02. Информация о шаблоне
// Печатает список элементов шаблона (композиций и медиа).

var project = app.project;

writeLn("Всего элементов в шаблоне: " + project.items.length);
writeLn("----------------------------------------");

// Индексация начинается с 1 (как в After Effects), не с 0.
for (var i = 1; i <= project.items.length; i++) {
    var item = project.item(i);
    if (item == null) {
        continue;
    }
    writeLn(i + ". " + item.name + "  [" + item.typeName + "], id=" + item.id);
}
