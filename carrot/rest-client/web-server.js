#!/usr/bin/env node
'use strict';

/* =====================================================================
   Локальный веб-сервер: HTML UI + прокси к Carrot REST API
   ---------------------------------------------------------------------
   Браузер не ходит на Carrot напрямую (CORS/JWT) — запросы идут сюда,
   а сервер использует CarrotClient.

   Запуск (из папки rest-client, с заполненным .env):
     node web-server.js
     затем открыть http://127.0.0.1:3456
   ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { CarrotClient, CarrotError } = require('./carrot-client');

const PORT = parseInt(process.env.CARROT_WEB_PORT || '3456', 10);
const HOST = process.env.CARROT_WEB_HOST || '127.0.0.1';
const WEB_DIR = path.join(__dirname, 'web');

function loadEnv() {
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(__dirname, '.env')
    ];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        var raw = fs.readFileSync(file, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
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

loadEnv();

function env(name, def) {
    return process.env[name] !== undefined ? process.env[name] : def;
}

var client = null;
var clientKey = '';

function ensureClient(creds) {
    creds = creds || {};
    const baseUrl = creds.baseUrl || env('CARROT_BASE_URL');
    const login = creds.login || env('CARROT_LOGIN');
    const password = creds.password || env('CARROT_PASSWORD');
    if (!baseUrl) throw new Error('Нужен CARROT_BASE_URL или baseUrl в форме');
    if (!login || !password) throw new Error('Нужны login/password (из .env или формы)');

    const wsUrl = creds.wsUrl || env('CARROT_WS_URL') || undefined;
    const key = baseUrl + '\0' + login + '\0' + password + '\0' + (wsUrl || '');
    if (!client || clientKey !== key) {
        client = new CarrotClient({
            baseUrl: baseUrl,
            login: login,
            password: password,
            wsUrl: wsUrl,
            senderId: env('CARROT_SENDER_ID', 'ticker-web'),
            receiverId: env('CARROT_RECEIVER_ID', 'carrot-server')
        });
        clientKey = key;
    }
    return client;
}

function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(text);
}

function sendText(res, status, text, ctype) {
    res.writeHead(status, {
        'Content-Type': (ctype || 'text/plain') + '; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(text);
}

function mimeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html';
    if (ext === '.css') return 'text/css';
    if (ext === '.js') return 'application/javascript';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.png') return 'image/png';
    if (ext === '.ico') return 'image/x-icon';
    return 'application/octet-stream';
}

function safeWebPath(urlPath) {
    var rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    rel = decodeURIComponent(rel).replace(/\?.*$/, '');
    if (rel.indexOf('..') !== -1) return null;
    const full = path.join(WEB_DIR, rel);
    if (!full.startsWith(WEB_DIR)) return null;
    return full;
}

function readBody(req) {
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (c) {
            size += c.length;
            if (size > 1e6) {
                reject(new Error('Тело запроса слишком большое'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', function () {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve(null);
            try { resolve(JSON.parse(raw)); }
            catch (e) { reject(new Error('Тело запроса не JSON')); }
        });
        req.on('error', reject);
    });
}

function errPayload(err) {
    return {
        ok: false,
        error: err && err.message ? err.message : String(err),
        errorCode: err instanceof CarrotError ? err.errorCode : undefined,
        httpStatus: err instanceof CarrotError ? err.httpStatus : undefined
    };
}

async function handleApi(req, res, url) {
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, {
            ok: true,
            hasEnv: !!(env('CARROT_BASE_URL') && env('CARROT_LOGIN') && env('CARROT_PASSWORD')),
            defaults: {
                baseUrl: env('CARROT_BASE_URL', ''),
                login: env('CARROT_LOGIN', '')
            }
        });
    }

    if (req.method === 'POST' && pathname === '/api/connect') {
        const body = await readBody(req);
        const c = ensureClient(body || {});
        await c.authenticate();
        return sendJson(res, 200, {
            ok: true,
            baseUrl: c.baseUrl,
            login: body && body.login ? body.login : env('CARROT_LOGIN', '')
        });
    }

    if (req.method === 'GET' && pathname === '/api/playlists') {
        const c = ensureClient();
        const list = await c.listPlaylists();
        return sendJson(res, 200, { ok: true, playlists: list || [] });
    }

    const plMatch = pathname.match(/^\/api\/playlists\/([^/]+)\/events$/);
    if (req.method === 'GET' && plMatch) {
        const c = ensureClient();
        const playlistId = decodeURIComponent(plMatch[1]);
        const rows = await c.listPlaylistEvents(playlistId);
        return sendJson(res, 200, { ok: true, events: rows });
    }

    // Все события (без плейлиста) — до /api/events/:id.
    // ?force=1 — обойти серверный кэш (кнопка ↻).
    if (req.method === 'GET' && pathname === '/api/events') {
        const c = ensureClient();
        const force = url.searchParams.get('force') === '1';
        const rows = await c.listAllEvents({ force: force });
        return sendJson(res, 200, {
            ok: true,
            events: rows,
            cached: !force && !!c._allEventsCacheAt &&
                (Date.now() - c._allEventsCacheAt) < c._allEventsCacheTtlMs
        });
    }

    if (req.method === 'GET' && pathname === '/api/media') {
        const c = ensureClient();
        const assets = await c.listMediaAssets({ deep: true });
        return sendJson(res, 200, { ok: true, media: assets || [] });
    }

    if (req.method === 'GET' && pathname === '/api/templates') {
        const c = ensureClient();
        const templates = await c.listNormalizedTemplates();
        return sendJson(res, 200, {
            ok: true,
            templates: templates.map(function (t) {
                return {
                    id: t.id,
                    name: t.name,
                    contentId: t.contentId,
                    templateTypeInt: t.templateTypeInt,
                    defaultInState: t.defaultInState,
                    states: t.states,
                    variableCount: (t.variables || []).length
                };
            })
        });
    }

    const tplMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
    if (req.method === 'GET' && tplMatch) {
        const c = ensureClient();
        const templateId = decodeURIComponent(tplMatch[1]);
        const template = await c.getNormalizedTemplate(templateId);
        return sendJson(res, 200, { ok: true, template: template });
    }

    // Создание событий: { events: [{ name, templateId, state?, comment?, variables? }] }
    if (req.method === 'POST' && pathname === '/api/events/create') {
        const body = await readBody(req);
        const events = (body && Array.isArray(body.events)) ? body.events
            : (body && Array.isArray(body) ? body : null);
        if (!events || !events.length) {
            return sendJson(res, 400, {
                ok: false,
                error: 'Нужен массив events: [{ name, templateId, variables? }, ...]'
            });
        }
        const c = ensureClient();
        const result = await c.createEvents(events);
        return sendJson(res, 200, { ok: true, created: result.created || [] });
    }

    // Пакетное удаление: { ids: [guid, ...] }
    if (req.method === 'POST' && pathname === '/api/events/delete') {
        const body = await readBody(req);
        const ids = (body && Array.isArray(body.ids)) ? body.ids : [];
        if (!ids.length) {
            return sendJson(res, 400, { ok: false, error: 'Нужен массив ids' });
        }
        const c = ensureClient();
        const deleted = [];
        const failed = [];
        for (let i = 0; i < ids.length; i++) {
            const eventId = ids[i];
            try {
                await c.deleteEvent(eventId);
                deleted.push(eventId);
            } catch (err) {
                failed.push({
                    id: eventId,
                    error: err && err.message ? err.message : String(err)
                });
            }
        }
        return sendJson(res, 200, { ok: true, deleted: deleted, failed: failed });
    }

    const varsMatch = pathname.match(/^\/api\/events\/([^/]+)\/variables$/);
    if (req.method === 'PATCH' && varsMatch) {
        const c = ensureClient();
        const eventId = decodeURIComponent(varsMatch[1]);
        const body = await readBody(req);
        const vars = Array.isArray(body) ? body
            : (body && Array.isArray(body.variables) ? body.variables : null);
        if (!vars) {
            return sendJson(res, 400, {
                ok: false,
                error: 'Нужен массив [{name, value}, ...] или { variables: [...] }'
            });
        }
        await c.editVariables(eventId, vars);
        return sendJson(res, 200, { ok: true, eventId: eventId });
    }

    const evMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
    if (req.method === 'GET' && evMatch) {
        const c = ensureClient();
        const eventId = decodeURIComponent(evMatch[1]);
        const event = await c.getEvent(eventId);
        return sendJson(res, 200, { ok: true, event: event });
    }

    if (req.method === 'DELETE' && evMatch) {
        const c = ensureClient();
        const eventId = decodeURIComponent(evMatch[1]);
        await c.deleteEvent(eventId);
        return sendJson(res, 200, { ok: true, deleted: eventId });
    }

    return sendJson(res, 404, { ok: false, error: 'Unknown API path: ' + pathname });
}

function serveStatic(req, res, url) {
    const filePath = safeWebPath(url.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        sendText(res, 404, 'Not found');
        return;
    }
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
        'Content-Type': mimeFor(filePath) + '; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(data);
}

const server = http.createServer(async function (req, res) {
    try {
        const url = new URL(req.url || '/', 'http://' + HOST + ':' + PORT);
        if (url.pathname.indexOf('/api/') === 0) {
            await handleApi(req, res, url);
            return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendText(res, 405, 'Method not allowed');
            return;
        }
        serveStatic(req, res, url);
    } catch (err) {
        const status = (err instanceof CarrotError && err.httpStatus) ? err.httpStatus : 500;
        sendJson(res, status >= 400 && status < 600 ? status : 500, errPayload(err));
    }
});

server.listen(PORT, HOST, function () {
    console.log('Carrot playlist browser: http://' + HOST + ':' + PORT);
    console.log('Конфиг: CARROT_BASE_URL=' + (env('CARROT_BASE_URL') || '(не задан)') +
        ', login=' + (env('CARROT_LOGIN') || '(не задан)'));
    const wsHint = env('CARROT_WS_URL') ||
        (env('CARROT_BASE_URL')
            ? '(по умолчанию ws://' + (() => {
                try { return new URL(env('CARROT_BASE_URL')).hostname + ':24710'; }
                catch (e) { return 'хост:24710'; }
            })() + ')'
            : '(не задан)');
    console.log('Удаление/создание событий: REST + WebSocket ' + wsHint);
});
