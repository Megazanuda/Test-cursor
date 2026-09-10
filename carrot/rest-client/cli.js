#!/usr/bin/env node
'use strict';

/* =====================================================================
   CLI для управления строками бегущей строки Carrot на лету
   ---------------------------------------------------------------------
   Команды:
     events                     список событий (id + имя)
     list                       показать строки бегущей строки
     add "текст" [--at N]       добавить строку (в конец или на позицию N)
     rm <index>                 удалить строку по индексу
     rm --match "substr"        удалить все строки с подстрокой
     set-file <path>            заменить все строки содержимым файла
     clear                      очистить все строки

   Конфиг — из .env (рядом с cli.js или в CWD) или из переменных окружения:
     CARROT_BASE_URL      базовый URL, напр. http://host:port/api
     CARROT_LOGIN         логин пользователя Carrot
     CARROT_PASSWORD      пароль
     CARROT_EVENT_ID      id события бегущей строки           (или --event)
     CARROT_EVENT_NAME    имя события (если нет id)           (или --event-name)
     CARROT_TICKER_VAR    имя переменной, по умолч. inputext  (или --var)
     CARROT_SENDER_ID / CARROT_RECEIVER_ID (необязательно)
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const { CarrotClient } = require('./carrot-client');
const { TickerClient } = require('./ticker');
const { PlayoutClient, STATUS_NAME } = require('./playout');

// Минимальная загрузка .env (без зависимостей). Не перетирает уже заданные env.
function loadEnv() {
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(__dirname, '.env')
    ];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        var raw = fs.readFileSync(file, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // BOM из Блокнота Windows
        raw.split(/\r?\n/).forEach(function (line) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (!m) return;
            let val = m[2];
            if ((val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (process.env[m[1]] === undefined) process.env[m[1]] = val;
        });
    }
}

function env(name, def) {
    return process.env[name] !== undefined ? process.env[name] : def;
}

function parseArgs(argv) {
    const out = { _: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.indexOf('--') === 0) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.indexOf('--') === 0) {
                out.flags[key] = true;
            } else {
                out.flags[key] = next;
                i++;
            }
        } else {
            out._.push(a);
        }
    }
    return out;
}

function previewText(text) {
    return String(text || '').replace(/\s+/g, ' ').slice(0, 160);
}

async function probe(method, url, body) {
    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: (body !== undefined) ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(5000)
        });
        const text = await res.text();
        return {
            ok: res.ok,
            status: res.status,
            ctype: res.headers.get('content-type') || '',
            text: text,
            preview: previewText(text)
        };
    } catch (err) {
        const cause = err && err.cause;
        return { error: (cause && cause.message) || err.message };
    }
}

function swaggerAuthPaths(jsonText) {
    try {
        const spec = JSON.parse(jsonText);
        const paths = spec.paths || {};
        return Object.keys(paths).filter(function (p) {
            return /auth|generate|token|login/i.test(p);
        });
    } catch (e) {
        return [];
    }
}

function usage() {
    console.log([
        'Carrot ticker REST client',
        '',
        'Использование: node cli.js <команда> [аргументы]',
        '',
        'Команды:',
        '  check                       проверить URL и авторизацию (диагностика fetch failed)',
        '  events                      список событий (id + имя)',
        '  vars                        переменные выбранного события (имя/тип/значение)',
        '  playlists                   список плейлистов (id + имя)',
        '  list                        показать строки бегущей строки',
        '  add "текст" [--at N]        добавить строку (в конец или на позицию N)',
        '  rm <index>                  удалить строку по индексу',
        '  rm --match "substr"         удалить все строки, содержащие подстроку',
        '  set-file <path>             заменить все строки содержимым файла',
        '  clear                       очистить все строки',
        '',
        'Эфир (элемент сценария):',
        '  status                      статус элемента (Unloaded/Loading/Ready/Active)',
        '  load                        прогрузить элемент (подготовить к эфиру)',
        '  in [--at ISO] [--duration N]  выдать в эфир (takeIn)',
        '  out [--at ISO]              снять с эфира (takeOut)',
        '  unload                      выгрузить элемент',
        '  air-on [--at ISO] [--duration N]  прогрузить+дождаться+выдать в эфир',
        '  air-off [--at ISO]          снять с эфира',
        '  find-item                   найти id элемента по событию в плейлисте',
        '',
        'Конфиг (env или .env; событие/элемент можно задать флагами):',
        '  CARROT_BASE_URL, CARROT_LOGIN, CARROT_PASSWORD',
        '  CARROT_EVENT_ID | CARROT_EVENT_NAME, CARROT_TICKER_VAR (по умолч. inputext)',
        '  CARROT_ITEM_ID (--item)     id элемента сценария для эфира, ИЛИ',
        '  CARROT_PLAYLIST_ID (--playlist)  плейлист для поиска элемента по событию'
    ].join('\n'));
}

async function main() {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];

    if (!cmd || cmd === 'help' || args.flags.help) {
        usage();
        return;
    }

    if (env('CARROT_INSECURE_TLS') === '1')
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const client = new CarrotClient({
        baseUrl: env('CARROT_BASE_URL'),
        login: env('CARROT_LOGIN'),
        password: env('CARROT_PASSWORD'),
        senderId: env('CARROT_SENDER_ID', 'ticker-client'),
        receiverId: env('CARROT_RECEIVER_ID', 'carrot-server'),
        notificationsEnabled: false
    });

    const ticker = new TickerClient(client, {
        eventId: args.flags.event || env('CARROT_EVENT_ID'),
        eventName: args.flags['event-name'] || env('CARROT_EVENT_NAME'),
        varName: args.flags.var || env('CARROT_TICKER_VAR', 'inputext')
    });

    const playout = new PlayoutClient(client, {
        itemId: args.flags.item || env('CARROT_ITEM_ID'),
        playlistId: args.flags.playlist || env('CARROT_PLAYLIST_ID'),
        eventId: args.flags.event || env('CARROT_EVENT_ID'),
        eventName: args.flags['event-name'] || env('CARROT_EVENT_NAME')
    });

    // Собрать body для takeIn/takeOut из флагов --at / --duration.
    function playBody() {
        const body = {};
        if (args.flags.at != null && args.flags.at !== true) body.timeStamp = String(args.flags.at);
        if (args.flags.duration != null && args.flags.duration !== true) {
            body.duration = parseInt(args.flags.duration, 10);
        }
        return body;
    }

    switch (cmd) {
        case 'check': {
            var rawBase = env('CARROT_BASE_URL') || '';
            console.log('CARROT_BASE_URL из .env: ' + (rawBase || '(не задан)'));
            console.log('куда стучимся:           ' + client.baseUrl);
            console.log('логин:                   ' + (env('CARROT_LOGIN') || '(не задан)'));
            if (/\/auth\/generate\/?$/i.test(rawBase)) {
                console.log('ВНИМАНИЕ: в URL не должно быть /auth/generate — это путь запроса, не база.');
            }
            if (/\/api\/api(\/|$)/i.test(client.baseUrl)) {
                console.log('ВНИМАНИЕ: /api повторён дважды.');
            }

            var origin;
            try { origin = new URL(client.baseUrl).origin; }
            catch (e) { throw new Error('Некорректный CARROT_BASE_URL'); }

            var q = '?MessageId=1&Time=' + encodeURIComponent(new Date().toISOString()) +
                '&SenderId=ticker-client&ReceiverId=carrot-server';
            var loginBody = {
                login: env('CARROT_LOGIN') || '',
                password: env('CARROT_PASSWORD') || '',
                notificationsEnabled: false
            };
            var candidates = [
                ['POST', client.baseUrl + '/auth/generate' + q],
                ['POST', origin + '/api/auth/generate' + q],
                ['POST', origin + '/auth/generate' + q],
                ['POST', origin + '/api/Auth/Generate' + q],
                ['GET',  origin + '/swagger/v1/swagger.json'],
                ['GET',  origin + '/swagger/index.html'],
                ['GET',  origin + '/api']
            ];
            // убрать дубликаты URL
            var seen = {};
            console.log('');
            console.log('Пробую типичные пути:');
            for (var i = 0; i < candidates.length; i++) {
                var method = candidates[i][0];
                var url = candidates[i][1];
                if (seen[method + ' ' + url]) continue;
                seen[method + ' ' + url] = true;
                var r = await probe(method, url, method === 'POST' ? loginBody : undefined);
                if (r.error) {
                    console.log(method + ' ' + url);
                    console.log('  ошибка: ' + r.error);
                    continue;
                }
                console.log(method + ' ' + url);
                console.log('  HTTP ' + r.status + (r.ctype ? '  ' + r.ctype.split(';')[0] : '') +
                    (r.preview ? '  ' + r.preview : ''));
                if (/swagger\.json/i.test(url) && r.ok) {
                    var found = swaggerAuthPaths(r.text);
                    if (found.length) {
                        console.log('  пути auth в swagger: ' + found.join(', '));
                        var needApi = found.some(function (p) { return p.indexOf('/api/') === 0; });
                        console.log('  поставь в .env: CARROT_BASE_URL=' + origin + (needApi ? '/api' : ''));
                    }
                }
            }

            console.log('');
            client.maxRetries = 0;
            await client.authenticate();
            console.log('OK: сервер ответил, токен получен');
            break;
        }

        case 'events': {
            const list = await client.listEvents();
            if (!list || !list.length) { console.log('(событий нет)'); break; }
            list.forEach(function (h) { console.log(h.id + '  ' + h.name); });
            break;
        }

        case 'vars': {
            const id = ticker.eventId || await client.findEventIdByName(ticker.eventName);
            if (!id) throw new Error('нужен --event / --event-name / CARROT_EVENT_*');
            const ev = await client.getEvent(id);
            const vars = (ev && ev.variables) ? ev.variables : [];
            console.log('событие: ' + ev.name + '  id=' + ev.id);
            console.log('allowRuntimeChange: ' + ev.allowRuntimeChange);
            if (!vars.length) { console.log('(переменных нет)'); break; }
            vars.forEach(function (v) {
                const preview = String(v.value == null ? '' : v.value).replace(/\r?\n/g, ' | ');
                console.log((v.type || '?') + '  ' + v.name + '  =  ' + preview);
            });
            break;
        }

        case 'playlists': {
            const list = await client.listPlaylists();
            if (!list || !list.length) { console.log('(плейлистов нет)'); break; }
            list.forEach(function (h) { console.log(h.id + '  ' + h.name); });
            break;
        }

        case 'list': {
            const lines = await ticker.getLines();
            if (!lines.length) { console.log('(пусто)'); break; }
            lines.forEach(function (l, i) { console.log(i + ': ' + l); });
            break;
        }

        case 'add': {
            const text = args._[1];
            if (text == null) throw new Error('usage: add "текст" [--at N]');
            const at = (args.flags.at != null && args.flags.at !== true)
                ? parseInt(args.flags.at, 10) : null;
            const lines = await ticker.addLine(text, at);
            console.log('OK, строк: ' + lines.length);
            break;
        }

        case 'rm':
        case 'remove': {
            if (args.flags.match != null && args.flags.match !== true) {
                const lines = await ticker.removeMatching(String(args.flags.match));
                console.log('OK, строк: ' + lines.length);
            } else {
                const idx = parseInt(args._[1], 10);
                if (Number.isNaN(idx)) throw new Error('usage: rm <index> | rm --match "substr"');
                const lines = await ticker.removeAt(idx);
                console.log('OK, строк: ' + lines.length);
            }
            break;
        }

        case 'set-file': {
            const file = args._[1];
            if (!file) throw new Error('usage: set-file <path>');
            const raw = fs.readFileSync(file, 'utf8');
            const lines = raw.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
            const saved = await ticker.setLines(lines);
            console.log('OK, строк: ' + saved.length);
            break;
        }

        case 'clear': {
            await ticker.clear();
            console.log('OK, очищено');
            break;
        }

        case 'status': {
            const s = await playout.status();
            console.log('status: ' + (STATUS_NAME[s] || s));
            break;
        }

        case 'load': {
            await playout.load();
            console.log('OK, load отправлен');
            break;
        }

        case 'in':
        case 'take-in': {
            await playout.takeIn(playBody());
            console.log('OK, takeIn отправлен');
            break;
        }

        case 'out':
        case 'take-out': {
            await playout.takeOut(playBody());
            console.log('OK, takeOut отправлен');
            break;
        }

        case 'unload': {
            await playout.unload();
            console.log('OK, unload отправлен');
            break;
        }

        case 'air-on': {
            await playout.airOn(playBody());
            console.log('OK, в эфире');
            break;
        }

        case 'air-off': {
            await playout.airOff(playBody());
            console.log('OK, снято с эфира');
            break;
        }

        case 'find-item': {
            const id = playout.itemId || await playout.findItemId();
            console.log(id ? id : '(элемент не найден)');
            break;
        }

        default:
            usage();
            process.exitCode = 2;
    }
}

main().catch(function (err) {
    console.error('Ошибка: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
