/* =====================================================================
   Покраска текста: по умолчанию зелёный, слова с * — зелёные на белом
   ---------------------------------------------------------------------
     - нет *  -> весь текст зелёный;
     - есть * -> помеченные слова зелёные, остальное белое.

   richtext-движок заменяет переносы на <div>…</div> — сначала возвращаем
   обычные переносы, потом красим ПОСТРОЧНО (чтобы <font> не пересекал
   перенос). Уже покрашенный текст без * повторно не трогаем.
   ===================================================================== */

var GREEN = '<font color="#00ff00">';
var WHITE = '<font color="#ffffff">';

function GetPlainString(v8Text)
{
    var s = "";
    for (var i = 0; i < v8Text.length; i++)
        s += String.fromCharCode(v8Text.charCodeAt(i));
    return s;
}

var txt = thisComp.layer("TEXT");

// richtext-разметку -> обычные переносы строк
var text = GetPlainString(txt.TextSource.Text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div\s*>/gi, "")
    .replace(/<div\b[^>]*>/gi, "\n")
    .replace(/^\n+/, "");

var hasStar = text.indexOf("*") !== -1;

// красим, только если есть * или текст ещё не покрашен
if (hasStar || text.indexOf("<font") === -1)
{
    text = text.replace(/<\/?font[^>]*>/gi, "");   // убираем старую покраску

    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++)
    {
        if (lines[i] === "")
            continue;

        lines[i] = hasStar
            ? WHITE + lines[i].replace(/\*([^\r\n ]+)/g, GREEN + "$1</font>") + "</font>"
            : GREEN + lines[i] + "</font>";
    }

    txt.TextSource.Text = lines.join("\n");
}
