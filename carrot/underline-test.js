/* =====================================================================
   Подчёркивание текста через richText — проверка и рабочий вариант
   ---------------------------------------------------------------------
   Движок уже понимает <font>/<div>/<br>. Подчёркивание обычно делается
   тегом <u>…</u> (в HTML-подмножестве, напр. Qt richtext, он есть).
   Если <u> не сработает — есть запасной вариант через CSS-<span>.

   Как проверить:
     1) Прогони блок ТЕСТ (подчёркивает весь текст). Если появилось
        подчёркивание — <u> поддерживается, используй рабочий вариант.
     2) Если нет — раскомментируй строки с заменой <u> на <span ...> внизу.

   Красим/оформляем ПОСТРОЧНО, чтобы теги не пересекали переносы строк.
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
    .replace(/<span[^>]*>/gi, "").replace(/<\/span>/gi, "")
    .replace(/^\n+/, "");

var lines = text.split("\n");

for (var i = 0; i < lines.length; i++)
{
    if (lines[i] === "")
        continue;

    // --- ТЕСТ: подчеркнуть весь текст (для проверки поддержки <u>) ---
    // lines[i] = "<u>" + lines[i] + "</u>";

    // --- РАБОЧИЙ ВАРИАНТ: подчеркнуть слова, помеченные _ ---
    lines[i] = lines[i].replace(/_([^\r\n ]+)/g, "<u>$1</u>");
}

text = lines.join("\n");

// --- Запасной вариант, если <u> не рендерится: CSS-<span> ---
// text = text
//     .replace(/<u>/g, '<span style="text-decoration:underline">')
//     .replace(/<\/u>/g, "</span>");

txt.TextSource.Text = text;
