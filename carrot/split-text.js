/* =====================================================================
   splitTextToLayers — разбивка текста слоя по строкам в другие слои
   ---------------------------------------------------------------------
   Берёт текст слоя src, режет на непустые строки и раскладывает их
   по одной в слои из массива targets. Лишние слои очищаются.

   src     — исходный текстовый слой (thisComp.layer("..") / comp.layer(".."))
   targets — массив целевых текстовых слоёв

   Пример:
     splitTextToLayers(
         thisComp.layer("MainText"),
         [thisComp.layer("Line1"), thisComp.layer("Line2")]
     );
   ===================================================================== */

function splitTextToLayers(src, targets)
{
    var raw = src.TextSource.Text.split(/[\r\n]+/);
    var lines = [];

    for (var i = 0; i < raw.length; i++)
        if (raw[i].trim() !== "")
            lines.push(raw[i].trim());

    for (var j = 0; j < targets.length; j++)
        targets[j].TextSource.Text = j < lines.length ? lines[j] : "";
}
