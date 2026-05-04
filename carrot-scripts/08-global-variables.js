// 08. Переменные: обычные (var), локальные (local.*) и глобальные (global.*).
//
// var      - живёт только в этом шаблоне и только на время выполнения скрипта.
// local.*  - живёт в рамках одной запущенной схемы Carrot Engine.
// global.* - живёт на всех схемах одного Carrot Server
//            (использовать умеренно: частые чтения/записи могут тормозить выдачу).

var localCounter = 1;
writeLn("var localCounter = " + localCounter);

if (typeof local.viewsCount == "undefined") {
    local.viewsCount = 0;
}
local.viewsCount = local.viewsCount + 1;
writeLn("local.viewsCount = " + local.viewsCount);

if (typeof global.currentShow == "undefined") {
    global.currentShow = "Morning News";
}
writeLn("global.currentShow = " + global.currentShow);

global.currentShow = "Evening News";
writeLn("Значение global.currentShow обновлено: " + global.currentShow);
