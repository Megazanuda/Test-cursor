/* =====================================================================
   Покраска слов, помеченных * — с обработкой richtext-разметки
   ---------------------------------------------------------------------
   Проблема: richtext-движок заменяет переносы строк на <div>…</div>,
   из-за чего жадная маска [^\r\n ]+ проглатывает весь текст (настоящих
   переносов уже нет). Перед покраской возвращаем обычные переносы:
     <div ...>  -> \n
     </div>     -> (удаляем)
     <br>       -> \n
   Функция идемпотентна: повторный прогон уже обработанного текста
   ничего не ломает и не дублирует.
   ===================================================================== */

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

var txt = thisComp.layer("TEXT");
var text = GetPlainString(txt.TextSource.Text);

// 1) Чиним переносы, испорченные richtext-движком.
text = normalizeNewlines(text);

// 2) Красим слова, начинающиеся с *.
text = text.replace(
    /\*([^\r\n ]+)/g,
    '<font color="#ff0000">$1</font>'
);

txt.TextSource.Text = text;
