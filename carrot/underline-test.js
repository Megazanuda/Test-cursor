/* =====================================================================
   Подчёркивание слов с "www" через richText
   ---------------------------------------------------------------------
   Подчёркивает любое слово, в котором встречается "www" (регистр не важен),
   тегом <u>…</u>. Движок уже понимает <font>/<div>/<br>; подчёркивание
   обычно делается <u> (HTML-подмножество, напр. Qt richtext). Если <u> не
   рендерится — внизу запасной вариант через CSS-<span>.

   Оформляем ПОСТРОЧНО, чтобы теги не пересекали переносы строк.
   ===================================================================== */

function GetPlainString(v8Text)
{
    var s = "";
    for (var i = 0; i < v8Text.length; i++)
        s += String.fromCharCode(v8Text.charCodeAt(i));
    return s;
}

var txt = thisComp.layer("TEXT");

// richtext-разметку -> обычные переносы + убираем старое подчёркивание
var text = GetPlainString(txt.TextSource.Text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div\s*>/gi, "")
    .replace(/<div\b[^>]*>/gi, "\n")
    .replace(/<\/?u>/gi, "")
    .replace(/^\n+/, "");

var lines = text.split("\n");

for (var i = 0; i < lines.length; i++)
    lines[i] = lines[i].replace(/([^\s]*www[^\s]*)/gi, "<u>$1</u>");

text = lines.join("\n");

// --- Запасной вариант, если <u> не рендерится: CSS-<span> ---
// text = text
//     .replace(/<u>/g, '<span style="text-decoration:underline">')
//     .replace(/<\/u>/g, "</span>");

txt.TextSource.Text = text;
