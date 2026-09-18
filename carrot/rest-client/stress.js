'use strict';

/* =====================================================================
   stress — автоматическая смена набора новостей полосы через REST
   ---------------------------------------------------------------------
   Каждые N минут (по умолчанию 5) полностью заменяет переменную тикера
   следующим набором строк. Источник наборов:
     1) файл (--file): блоки строк, разделённые строкой ---
     2) без файла: генерируются разные блоки (метка времени + номер цикла)

   Для живого эфира у события должен быть allowRuntimeChange = true.
   ===================================================================== */

const fs = require('fs');

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

function stamp() {
    return new Date().toISOString().replace('T', ' ').replace(/\..+/, '');
}

// Файл: блоки новостей разделены строкой, состоящей только из ---
function loadBatchesFromFile(filePath) {
    var raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    var parts = raw.split(/\r?\n---+\r?\n/);
    var batches = [];
    for (var i = 0; i < parts.length; i++) {
        var lines = parts[i].split(/\r?\n/).filter(function (l) {
            return l.trim() !== '' && !/^---+$/.test(l.trim());
        });
        if (lines.length) batches.push(lines);
    }
    if (!batches.length) throw new Error('В файле нет блоков новостей: ' + filePath);
    return batches;
}

// Синтетические блоки для стресс-теста без файла.
function makeGeneratedBatch(cycle, lineCount) {
    lineCount = lineCount || 6;
    var t = stamp();
    var lines = [];
    lines.push('[СТРЕСС #' + cycle + '] обновление ' + t);
    for (var i = 1; i < lineCount; i++) {
        lines.push('Новость ' + cycle + '.' + i +
            ' — автозамена полосы, цикл ' + cycle + ', строка ' + i + ' (' + t + ')');
    }
    return lines;
}

function parseMinutes(flags) {
    var raw = flags.every;
    if (raw == null || raw === true) return 5;
    var n = Number(raw);
    if (!(n > 0)) throw new Error('--every должен быть числом минут > 0 (напр. 5)');
    return n;
}

/**
 * ticker — TickerClient
 * opts:
 *   everyMin  — интервал в минутах (по умолчанию 5)
 *   file      — путь к файлу с блоками ---
 *   lines     — сколько строк генерировать без файла (по умолчанию 6)
 *   rounds    — сколько смен (0 = бесконечно)
 *   once      — одна смена и выход
 */
async function runStress(ticker, opts) {
    opts = opts || {};
    var everyMin = opts.everyMin != null ? opts.everyMin : 5;
    var intervalMs = Math.round(everyMin * 60 * 1000);
    var rounds = opts.rounds != null ? opts.rounds : 0;
    var once = !!opts.once;
    var lineCount = opts.lines || 6;

    var batches = null;
    if (opts.file) batches = loadBatchesFromFile(opts.file);

    console.log('Стресс-тест полосы');
    console.log('  интервал:  ' + everyMin + ' мин');
    console.log('  источник:  ' + (batches ? opts.file + ' (' + batches.length + ' блоков)' : 'генератор'));
    console.log('  раундов:   ' + (once ? '1' : (rounds > 0 ? rounds : 'бесконечно')));
    console.log('  Ctrl+C — остановить');
    console.log('');

    var cycle = 0;
    for (;;) {
        cycle += 1;
        var lines = batches
            ? batches[(cycle - 1) % batches.length]
            : makeGeneratedBatch(cycle, lineCount);

        process.stdout.write('[' + stamp() + '] цикл ' + cycle +
            ': пишу ' + lines.length + ' строк... ');
        try {
            await ticker.setLines(lines);
            console.log('OK');
            lines.forEach(function (l, i) {
                console.log('  ' + i + ': ' + l);
            });
        } catch (err) {
            console.log('ОШИБКА');
            console.error('  ' + (err && err.message ? err.message : err));
            console.error('  повторю через тот же интервал');
        }

        if (once || (rounds > 0 && cycle >= rounds)) {
            console.log('Готово.');
            return;
        }

        console.log('Следующая смена через ' + everyMin + ' мин...\n');
        await sleep(intervalMs);
    }
}

module.exports = {
    runStress: runStress,
    loadBatchesFromFile: loadBatchesFromFile,
    makeGeneratedBatch: makeGeneratedBatch,
    parseMinutes: parseMinutes
};
