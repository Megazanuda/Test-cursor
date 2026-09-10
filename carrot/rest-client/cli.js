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

// Минимальная загрузка .env (без зависимостей). Не перетирает уже заданные env.
function loadEnv() {
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(__dirname, '.env')
    ];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        const raw = fs.readFileSync(file, 'utf8');
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

function usage() {
    console.log([
        'Carrot ticker REST client',
        '',
        'Использование: node cli.js <команда> [аргументы]',
        '',
        'Команды:',
        '  events                      список событий (id + имя)',
        '  list                        показать строки бегущей строки',
        '  add "текст" [--at N]        добавить строку (в конец или на позицию N)',
        '  rm <index>                  удалить строку по индексу',
        '  rm --match "substr"         удалить все строки, содержащие подстроку',
        '  set-file <path>             заменить все строки содержимым файла',
        '  clear                       очистить все строки',
        '',
        'Конфиг (env или .env; событие можно задать флагами --event/--event-name/--var):',
        '  CARROT_BASE_URL, CARROT_LOGIN, CARROT_PASSWORD',
        '  CARROT_EVENT_ID | CARROT_EVENT_NAME, CARROT_TICKER_VAR (по умолч. inputext)'
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

    switch (cmd) {
        case 'events': {
            const list = await client.listEvents();
            if (!list || !list.length) { console.log('(событий нет)'); break; }
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

        default:
            usage();
            process.exitCode = 2;
    }
}

main().catch(function (err) {
    console.error('Ошибка: ' + (err && err.message ? err.message : err));
    process.exit(1);
});
