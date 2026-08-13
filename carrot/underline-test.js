/* =====================================================================
   Подчёркивание слов с "www" — через Unicode (без HTML-тегов)
   ---------------------------------------------------------------------
   Движок рендерит <font color>, но игнорирует <u> и text-decoration —
   подчёркивание через разметку недоступно. Поэтому подчёркиваем символом
   U+0332 (COMBINING LOW LINE): ставим его после каждого символа слова,
   и рендерер рисует линию под ними. Работает без поддержки HTML.

   Подчёркивается любое слово, в котором встречается "www" (регистр не важен).
   Оформляем ПОСТРОЧНО, чтобы не задеть переносы.
   ===================================================================== */

function GetPlainString(v8Text)
{
    var s = "";
    for (var i = 0; i < v8Text.length; i++)
        s += String.fromCharCode(v8Text.charCodeAt(i));
    return s;
}

// Ставим U+0332 после каждого символа слова -> визуальное подчёркивание.
function underlineWord(w)
{
    var out = "";
    for (var i = 0; i < w.length; i++)
        out += w.charAt(i) + "\u0332";
    return out;
}

var txt = thisComp.layer("TEXT");

// richtext-разметку -> обычные переносы + убираем старое подчёркивание (U+0332)
var text = GetPlainString(txt.TextSource.Text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div\s*>/gi, "")
    .replace(/<div\b[^>]*>/gi, "\n")
    .replace(/\u0332/g, "")
    .replace(/^\n+/, "");

var lines = text.split("\n");

for (var i = 0; i < lines.length; i++)
{
    var words = lines[i].split(" ");

    for (var j = 0; j < words.length; j++)
        if (/www/i.test(words[j]))
            words[j] = underlineWord(words[j]);

    lines[i] = words.join(" ");
}

txt.TextSource.Text = lines.join("\n");
