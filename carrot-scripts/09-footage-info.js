// 09. Работа с медиа (импортированные файлы, видео, изображения).
// footage(name) возвращает объект FootageItem или null.

var bg = footage("background.mp4");

if (bg == null) {
    alert('Медиа "background.mp4" не найдено в шаблоне.');
} else {
    writeLn("Имя:           " + bg.name);
    writeLn("Тип:           " + bg.typeName);
    writeLn("Размер:        " + bg.width + " x " + bg.height);
    writeLn("Длительность:  " + bg.duration + " сек");
    writeLn("Кадр:          " + bg.frameDuration + " сек");
    writeLn("PAR:           " + bg.pixelAspect);
}
