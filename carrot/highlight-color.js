/* =====================================================================
   Покраска текста: по умолчанию зелёный, слова с * — зелёные на белом
   ---------------------------------------------------------------------
   Правила:
     - если в тексте НЕТ *  -> весь текст зелёный;
     - если ГДЕ-ТО есть *   -> помеченные слова зелёные, остальное белое.

   Особенности:
     - richtext-движок заменяет переносы строк на <div>…</div> — сначала
       возвращаем обычные переносы (normalizeNewlines);
     - красим ПОСТРОЧНО, чтобы теги <font> не пересекали переносы (иначе
       при обратной разбивке на <div> получается битая разметка);
     - без вложенных <font> (каждый сегмент строки красится отдельно);
     - идемпотентно: * при покраске «съедается», поэтому уже покрашенный
       текст без * повторно не трогаем.

   Цвета — в константах ниже.
   ===================================================================== */

var GREEN_COLOR = "#00ff00";
var WHITE_COLOR = "#ffffff";

var GREEN = '<font color="' + GREEN_COLOR + '">';
var WHITE = '<font color="' + WHITE_COLOR + '">';
var CLOSE = '</font>';
var GREEN_SPAN = new RegExp('(<font color="' + GREEN_COLOR + '">[^<]*<\\/font>)');


function GetPlainString(v8Text)
{
    var result = "";

    for (var i = 0; i < v8Text.length; i++)
        result += String.fromCharCode(v8Text.charCodeAt(i));

    return result;
}

// Возвращаем div/br-разметку к обычным переносам строк.
function normalizeNewlines(text)
{
    text = text.replace(/<br\s*\/?>/gi, "\n");   // <br> -> перенос
    text = text.replace(/<\/div\s*>/gi, "");      // закрывающий </div> убираем
    text = text.replace(/<div\b[^>]*>/gi, "\n");  // каждый <div> -> перенос
    text = text.replace(/^\n+/, "");              // убрать перенос(ы) в самом начале
    return text;
}

// Убираем любую предыдущую покраску (теги <font>).
function stripFont(text)
{
    return text.replace(/<\/?font[^>]*>/gi, "");
}

// Красим одну строку.
function colorLine(line, hasStar)
{
    if (line === "")
        return "";

    // Нет * во всём тексте -> строка целиком зелёная.
    if (!hasStar)
        return GREEN + line + CLOSE;

    // Есть * -> помеченные слова зелёные, остальное белое.
    line = line.replace(/\*([^\r\n ]+)/g, GREEN + "$1" + CLOSE);

    // Оборачиваем в белый всё, что не является зелёным сегментом (без вложенности).
    var parts = line.split(GREEN_SPAN);
    var out = "";

    for (var i = 0; i < parts.length; i++)
    {
        if (parts[i] === "")
            continue;

        out += (parts[i].indexOf(GREEN) === 0) ? parts[i] : WHITE + parts[i] + CLOSE;
    }

    return out;
}

// Красим весь текст построчно.
function colorText(text, hasStar)
{
    var lines = text.split("\n");

    for (var i = 0; i < lines.length; i++)
        lines[i] = colorLine(lines[i], hasStar);

    return lines.join("\n");
}


var txt = thisComp.layer("TEXT");
var text = normalizeNewlines(GetPlainString(txt.TextSource.Text));

if (text.indexOf("*") !== -1)
{
    // Есть * -> зелёные помеченные слова, остальное белое.
    txt.TextSource.Text = colorText(stripFont(text), true);
}
else if (text.indexOf("<font") === -1)
{
    // Нет * и текст ещё не покрашен -> весь зелёный.
    txt.TextSource.Text = colorText(text, false);
}
// Иначе (нет *, но уже покрашено) — оставляем как есть.
