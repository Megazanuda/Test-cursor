'use strict';

/* =====================================================================
   CarrotClient — минимальный REST-клиент Carrot Broadcast
   ---------------------------------------------------------------------
   Без внешних зависимостей. Требует Node.js >= 18 (глобальный fetch).
   Удаление событий: REST часто не отдаёт DELETE (HTTP 405) — тогда
   используется WebSocket RemoveEventFromDB (порт 24710).

   Берёт на себя:
     - авторизацию (POST /auth/generate) и автообновление токена;
     - обязательные query-параметры конверта (MessageId/Time/SenderId/ReceiverId);
     - разбор обёртки Message<T> и доменных ошибок ResponseData.errorCode;
     - ретраи на сетевых сбоях с экспоненциальной задержкой;
     - повтор запроса один раз при 401 (протух токен).
   ===================================================================== */

const crypto = require('crypto');

const ERROR_NAMES = {
    0: 'Success',
    1: 'CommonError',
    2: 'FileUploadingError',
    31: 'NoEngines',
    32: 'NoContent',
    41: 'InUse',
    42: 'AlreadyExists',
    43: 'NameError',
    44: 'NotFound',
    45: 'InvalidState',
    46: 'InvalidValue',
    99: 'Unknown'
};

class CarrotError extends Error {
    constructor(message, opts) {
        super(message);
        this.name = 'CarrotError';
        opts = opts || {};
        this.httpStatus = opts.httpStatus;
        this.errorCode = opts.errorCode;
        this.description = opts.description;
        this.url = opts.url;
        this.code = opts.code;
    }
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

// Windows: Node fetch часто идёт на ::1 (IPv6), а сервер слушает только IPv4.
function normalizeBaseUrl(url) {
    return String(url).replace(/\/+$/, '')
        .replace(/^(https?:\/\/)localhost\b/i, '$1127.0.0.1');
}

function isFatalNet(code) {
    return /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ERR_INVALID_URL|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|CERT_UNTRUSTED)$/.test(code || '');
}

function wrapNetError(err, url) {
    const cause = err && err.cause;
    const code = (cause && cause.code) || err.code || '';
    const detail = (cause && cause.message) || err.message || String(err);
    var hint = '';
    if (code === 'ECONNREFUSED') {
        hint = ' На этом адресе никто не слушает. В .env порт 8080 — заглушка, поставь реальный URL REST API Carrot (не порты 24710/24712).';
    } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        hint = ' Имя хоста не резолвится. Проверь CARROT_BASE_URL.';
    } else if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
        hint = ' Таймаут. Сервер недоступен с этой машины (файрвол, VPN, неверный IP).';
    } else if (/CERT|UNABLE_TO_VERIFY/i.test(code + detail)) {
        hint = ' HTTPS с самоподписанным сертификатом. Добавь в .env CARROT_INSECURE_TLS=1';
    } else if (err.name === 'AbortError' || /aborted/i.test(detail)) {
        hint = ' Таймаут ожидания ответа. Проверь CARROT_BASE_URL и доступность сервера.';
    } else if (detail === 'fetch failed') {
        hint = ' Нет соединения. Проверь CARROT_BASE_URL командой: node cli.js check';
    }
    return new CarrotError(
        'Сеть: ' + (code ? code + ' — ' : '') + detail + ' [' + url + ']' + hint,
        { url: url, code: code }
    );
}

function xmlEscape(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function defaultWsUrlFromBase(baseUrl) {
    try {
        const u = new URL(baseUrl);
        const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
        return proto + '//' + u.hostname + ':24710';
    } catch (e) {
        return null;
    }
}

class CarrotClient {
    constructor(opts) {
        opts = opts || {};
        if (!opts.baseUrl) throw new Error('baseUrl обязателен (напр. http://host:port/api)');

        this.baseUrl = normalizeBaseUrl(opts.baseUrl);
        this.timeoutMs = (opts.timeoutMs != null) ? opts.timeoutMs : 10000;
        this.login = opts.login;
        this.password = opts.password;
        this.notificationsEnabled = !!opts.notificationsEnabled;
        this.senderId = opts.senderId || 'ticker-client';
        this.receiverId = opts.receiverId || 'carrot-server';
        this.wsUrl = opts.wsUrl || defaultWsUrlFromBase(this.baseUrl);

        this.token = null;
        this.tokenAcquiredAt = 0;
        this.tokenTtlMs = 55 * 60 * 1000; // токен живёт 1 час — обновляем заранее
        this.maxRetries = (opts.maxRetries != null) ? opts.maxRetries : 3;

        this._messageId = 0;
    }

    _nextMessageId() { return ++this._messageId; }

    // Обязательная строка query-параметров конверта Carrot.
    _envelopeQuery() {
        const p = new URLSearchParams({
            MessageId: String(this._nextMessageId()),
            Time: new Date().toISOString(),
            SenderId: this.senderId,
            ReceiverId: this.receiverId
        });
        return '?' + p.toString();
    }

    async _request(method, path, body, opts) {
        opts = opts || {};
        const needAuth = opts.auth !== false;
        if (needAuth) await this._ensureToken();

        const url = this.baseUrl + path + this._envelopeQuery();
        const headers = { 'Content-Type': 'application/json' };
        if (needAuth && this.token) headers['Authorization'] = 'Bearer ' + this.token;

        let lastErr;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const ac = new AbortController();
                const t = setTimeout(function () { ac.abort(); }, this.timeoutMs);
                var res;
                try {
                    res = await fetch(url, {
                        method: method,
                        headers: headers,
                        body: (body !== undefined) ? JSON.stringify(body) : undefined,
                        signal: ac.signal
                    });
                } finally {
                    clearTimeout(t);
                }

                // Токен протух — обновим и повторим ровно один раз.
                if (res.status === 401 && needAuth && !opts._retriedAuth) {
                    this.token = null;
                    await this._ensureToken();
                    return this._request(method, path, body,
                        Object.assign({}, opts, { _retriedAuth: true }));
                }

                const text = await res.text();
                var json = null;
                if (text) {
                    try { json = JSON.parse(text); }
                    catch (e) {
                        const ctype = res.headers.get('content-type') || '(нет)';
                        const preview = text.replace(/\s+/g, ' ').slice(0, 220);
                        const looksHtml = /<html|<!doctype html|<head|<body/i.test(text);
                        throw new CarrotError(
                            'Ответ не JSON (HTTP ' + res.status + ', Content-Type: ' + ctype + '). ' +
                            (looksHtml
                                ? 'Это HTML — веб-интерфейс Carrot, не REST. Порт веб-плейлиста (часто 8088) сюда не подходит; нужен отдельный URL REST API из документации (/api + JWT). '
                                : '') +
                            'URL: ' + url + ' | начало ответа: ' + preview,
                            { httpStatus: res.status, url: url }
                        );
                    }
                }

                if (!res.ok) {
                    const preview = text ? text.replace(/\s+/g, ' ').slice(0, 220) : '';
                    var hint = '';
                    if (res.status === 404) {
                        hint = ' Путь не найден. В .env нужен http://хост:порт/api — без /auth/generate на конце и без второго /api.';
                    }
                    throw new CarrotError(
                        'HTTP ' + res.status + ' ' + res.statusText +
                        ' [' + method + ' ' + url + ']' + hint +
                        (preview ? ' | ответ: ' + preview : ''),
                        { httpStatus: res.status, url: url }
                    );
                }

                const data = json ? json.data : null;

                // Доменная ошибка Carrot внутри data (errorCode != 0).
                if (data && typeof data === 'object' &&
                    typeof data.errorCode === 'number' && data.errorCode !== 0) {
                    throw new CarrotError(
                        'Carrot ' + (ERROR_NAMES[data.errorCode] || data.errorCode) +
                        ': ' + (data.description || ''),
                        { errorCode: data.errorCode, description: data.description }
                    );
                }

                return data;
            } catch (err) {
                if (err instanceof CarrotError) throw err;
                const wrapped = wrapNetError(err, url);
                lastErr = wrapped;
                if (isFatalNet(wrapped.code) || attempt >= this.maxRetries) throw wrapped;
                await sleep(1000 * Math.pow(2, attempt));
            }
        }
        throw lastErr;
    }

    async _ensureToken() {
        const fresh = this.token && (Date.now() - this.tokenAcquiredAt) < this.tokenTtlMs;
        if (!fresh) await this.authenticate();
    }

    async authenticate() {
        if (!this.login || !this.password) throw new Error('login/password обязательны');
        try {
            return await this._authenticateOnce();
        } catch (err) {
            // PDF пишет базу /api, живые инсталляции часто без префикса (см. swagger /auth/generate).
            if (err && err.httpStatus === 404 && /\/api$/i.test(this.baseUrl)) {
                this.baseUrl = this.baseUrl.replace(/\/api$/i, '');
                return await this._authenticateOnce();
            }
            if (err && err.httpStatus === 404 && !/\/api$/i.test(this.baseUrl)) {
                this.baseUrl = this.baseUrl + '/api';
                return await this._authenticateOnce();
            }
            throw err;
        }
    }

    async _authenticateOnce() {
        const data = await this._request('POST', '/auth/generate', {
            login: this.login,
            password: this.password,
            notificationsEnabled: this.notificationsEnabled
        }, { auth: false });
        if (!data || !data.token) throw new CarrotError('Сервер не вернул токен');
        this.token = data.token;
        this.tokenAcquiredAt = Date.now();
        return this.token;
    }

    async refresh() {
        const data = await this._request('PUT', '/auth/refresh');
        if (data && data.token) {
            this.token = data.token;
            this.tokenAcquiredAt = Date.now();
        }
        return this.token;
    }

    /* ---------------- События ---------------- */

    // Список заголовков событий: [{id, name, changed, externalId}]
    listEvents() {
        return this._request('GET', '/events');
    }

    // Полная структура события (с variables: [{name, value, type, lengthLimit}]).
    getEvent(eventId) {
        return this._request('GET', '/events/' + encodeURIComponent(eventId));
    }

    // Изменить переменные события: vars = [{name, value}, ...]
    editVariables(eventId, vars) {
        return this._request('PATCH',
            '/events/' + encodeURIComponent(eventId) + '/editVariables', vars);
    }

    // Одноразовый REST-запрос без ретраев — для перебора путей удаления.
    async _tryOnce(method, path, body) {
        const prev = this.maxRetries;
        this.maxRetries = 0;
        try {
            return { ok: true, data: await this._request(method, path, body) };
        } catch (err) {
            return {
                ok: false,
                error: err,
                httpStatus: err instanceof CarrotError ? err.httpStatus : undefined,
                message: err && err.message ? err.message : String(err)
            };
        } finally {
            this.maxRetries = prev;
        }
    }

    // Удалить событие.
    // REST DELETE /events/{id} на Carrot даёт 405 — пробуем несколько REST-путей,
    // затем WebSocket-команду RemoveEventFromDB (документированный способ).
    async deleteEvent(eventId) {
        const enc = encodeURIComponent(eventId);
        const restAttempts = [
            { method: 'POST', path: '/events/' + enc + '/removeFromDB', body: {} },
            { method: 'POST', path: '/events/' + enc + '/RemoveFromDB', body: {} },
            { method: 'POST', path: '/events/removeFromDB', body: { eventId: eventId } },
            { method: 'POST', path: '/events/removeFromDB', body: { id: eventId } },
            { method: 'POST', path: '/events/RemoveEventFromDB', body: { eventId: eventId } },
            { method: 'POST', path: '/events/RemoveEventFromDB', body: { EventId: eventId } },
            { method: 'POST', path: '/events/' + enc + '/delete', body: {} },
            { method: 'DELETE', path: '/events/' + enc + '/fromDB', body: undefined },
            { method: 'DELETE', path: '/events/' + enc, body: undefined }
        ];

        const tried = [];
        for (let i = 0; i < restAttempts.length; i++) {
            const a = restAttempts[i];
            const r = await this._tryOnce(a.method, a.path, a.body);
            tried.push(a.method + ' ' + a.path + ' → ' +
                (r.ok ? 'OK' : ('HTTP ' + (r.httpStatus || '?'))));
            if (r.ok) return r.data;
            // Доменные ошибки (InUse и т.п.) — не маскируем перебором.
            if (r.error instanceof CarrotError && r.error.errorCode) throw r.error;
            if (r.httpStatus && r.httpStatus !== 404 && r.httpStatus !== 405) {
                throw r.error;
            }
        }

        try {
            const wsResult = await this.deleteEventViaWebSocket(eventId);
            return wsResult;
        } catch (wsErr) {
            throw new CarrotError(
                'Не удалось удалить событие через REST и WebSocket. ' +
                'REST: ' + tried.join('; ') + '. ' +
                'WebSocket (' + (this.wsUrl || 'нет URL') + '): ' +
                (wsErr && wsErr.message ? wsErr.message : wsErr) +
                '. Проверь, что порт 24710 доступен с этой машины (CARROT_WS_URL).',
                { httpStatus: 405 }
            );
        }
    }

    // Удаление через WS API: Playlists / RemoveEventFromDB (см. carrotsoftware/api).
    deleteEventViaWebSocket(eventId) {
        const self = this;
        const wsUrl = this.wsUrl;
        if (!wsUrl) {
            return Promise.reject(new CarrotError(
                'Не задан WebSocket URL (CARROT_WS_URL или хост из CARROT_BASE_URL)'
            ));
        }
        if (typeof WebSocket === 'undefined') {
            return Promise.reject(new CarrotError(
                'WebSocket недоступен в этой версии Node.js (нужен Node >= 21/22)'
            ));
        }
        if (!this.login || !this.password) {
            return Promise.reject(new Error('login/password обязательны для WS-удаления'));
        }

        const sessionId = crypto.randomUUID();
        const timeoutMs = Math.max(this.timeoutMs, 15000);

        return new Promise(function (resolve, reject) {
            var ws;
            var msgId = 1;
            var stage = 'wait-client-id';
            var settled = false;

            function done(err, value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { ws.close(); } catch (e) { /* ignore */ }
                if (err) reject(err);
                else resolve(value);
            }

            function send(xml) {
                ws.send(xml);
            }

            const timer = setTimeout(function () {
                done(new CarrotError(
                    'Таймаут WebSocket при удалении события (stage=' + stage + ', url=' + wsUrl + ')'
                ));
            }, timeoutMs);

            try {
                ws = new WebSocket(wsUrl);
            } catch (err) {
                done(new CarrotError('Не удалось открыть WebSocket: ' + err.message, { url: wsUrl }));
                return;
            }

            ws.addEventListener('error', function () {
                done(new CarrotError(
                    'Ошибка WebSocket-соединения [' + wsUrl + ']. ' +
                    'Порт 24710 должен быть доступен с этой машины.',
                    { url: wsUrl }
                ));
            });

            ws.addEventListener('close', function () {
                if (!settled) {
                    done(new CarrotError(
                        'WebSocket закрыт до завершения удаления (stage=' + stage + ')'
                    ));
                }
            });

            ws.addEventListener('message', function (ev) {
                const text = String(ev.data || '');

                // Keepalive
                if (/CmdGroup="HeartBeat"/.test(text) && !/MessageId=/.test(text)) {
                    send(
                        '<Command CmdGroup="HeartBeat" MessageId="-1">' +
                        '<SessionId>' + sessionId + '</SessionId></Command>'
                    );
                    return;
                }

                if (stage === 'wait-client-id' && /CmdGroup="ClientID"/.test(text)) {
                    stage = 'login';
                    send(
                        '<Command CmdGroup="HandShake" MessageId="' + (msgId++) + '">' +
                        '<AppName>ticker-web</AppName>' +
                        '<SessionID>' + sessionId + '</SessionID></Command>'
                    );
                    send(
                        '<Command CmdGroup="Users" CmdName="LoginUnsecure" MessageId="' +
                        (msgId++) + '">' +
                        '<UserName>' + xmlEscape(self.login) + '</UserName>' +
                        '<PassWord>' + xmlEscape(self.password) + '</PassWord></Command>'
                    );
                    return;
                }

                if (stage === 'login') {
                    if (/CmdName="LoginError"/.test(text)) {
                        const m = text.match(/<Message>([\s\S]*?)<\/Message>/);
                        done(new CarrotError(
                            'WS LoginError: ' + (m ? m[1] : 'неверный логин/пароль')
                        ));
                        return;
                    }
                    if (/CmdName="LoginOk"/.test(text)) {
                        stage = 'remove';
                        send(
                            '<Command CmdGroup="Playlists" CmdName="RemoveEventFromDB" MessageId="' +
                            (msgId++) + '">' +
                            '<EventId>' + xmlEscape(eventId) + '</EventId></Command>'
                        );
                        return;
                    }
                }

                if (stage === 'remove') {
                    if (/CmdName="EventRemovedFromDB"/.test(text)) {
                        done(null, { deleted: eventId, via: 'websocket' });
                        return;
                    }
                    if (/CmdName="[^"]*Error[^"]*"/.test(text) ||
                        /CmdGroup="Error"/.test(text)) {
                        const m = text.match(/<Message>([\s\S]*?)<\/Message>/) ||
                            text.match(/<Description>([\s\S]*?)<\/Description>/);
                        done(new CarrotError(
                            'WS ошибка удаления: ' + (m ? m[1] : text.slice(0, 220))
                        ));
                    }
                }
            });
        });
    }

    async findEventIdByName(name) {
        const list = await this.listEvents();
        const hit = (list || []).find(function (h) { return h.name === name; });
        return hit ? hit.id : null;
    }

    getTemplate(templateId) {
        return this._request('GET', '/templates/' + encodeURIComponent(templateId));
    }

    // Разобрать ответ GET /events/{id}: иногда { event, template }, иногда плоский Event.
    _unwrapEvent(raw) {
        if (!raw) return raw;
        if (raw.event && !raw.id) {
            const event = Object.assign({}, raw.event);
            const tpl = raw.template;
            if (tpl && tpl.name && !event.templateName) event.templateName = tpl.name;
            if (tpl && tpl.id && !event.templateId) event.templateId = tpl.id;
            return event;
        }
        if (raw.template && raw.template.name && !raw.templateName) {
            raw.templateName = raw.template.name;
        }
        return raw;
    }

    // Собрать map templateId -> name из массива templates и/или отдельных GET.
    async _resolveTemplateNames(templateIds, seedTemplates) {
        const map = Object.create(null);
        (seedTemplates || []).forEach(function (t) {
            if (t && t.id) map[t.id] = t.name || '';
        });
        const missing = [];
        for (let i = 0; i < templateIds.length; i++) {
            const tid = templateIds[i];
            if (!tid || map[tid] !== undefined) continue;
            missing.push(tid);
        }
        for (let i = 0; i < missing.length; i++) {
            const tid = missing[i];
            try {
                const t = await this.getTemplate(tid);
                map[tid] = (t && t.name) ? t.name : '';
            } catch (err) {
                map[tid] = '';
            }
        }
        return map;
    }

    // События, на которые ссылаются элементы сценария внутри плейлиста.
    // Возвращает плоский список { event, item, story } (уникальность по event.id).
    // У события в API обычно только templateId — имя шаблона дописываем сюда.
    async listPlaylistEvents(playlistId) {
        const pl = await this.getPlaylist(playlistId);
        const stories = (pl && (pl.stories || pl.scenarios)) ? (pl.stories || pl.scenarios) : [];
        const seedTemplates = (pl && pl.templates) ? pl.templates : [];
        const seen = Object.create(null);
        const out = [];
        const templateIds = [];

        for (let s = 0; s < stories.length; s++) {
            const st = stories[s];
            let items = st.items;
            if (!items) {
                const full = await this.getStory(st.id);
                items = full ? full.items : [];
            }
            for (let i = 0; i < (items || []).length; i++) {
                const item = items[i];
                const eventId = item && item.eventId;
                if (!eventId || seen[eventId]) continue;
                seen[eventId] = true;
                var event = null;
                try {
                    event = this._unwrapEvent(await this.getEvent(eventId));
                } catch (err) {
                    event = {
                        id: eventId,
                        name: item.eventName || eventId,
                        _fetchError: err && err.message ? err.message : String(err)
                    };
                }
                if (event && event.templateId) templateIds.push(event.templateId);
                out.push({
                    event: event,
                    item: item,
                    story: { id: st.id, name: st.name }
                });
            }
        }

        // Если плейлист уже отдал events на верхнем уровне — добавим те, кого нет в items.
        const topEvents = (pl && pl.events) ? pl.events : [];
        for (let i = 0; i < topEvents.length; i++) {
            const ev = topEvents[i];
            if (!ev || !ev.id || seen[ev.id]) continue;
            seen[ev.id] = true;
            if (ev.templateId) templateIds.push(ev.templateId);
            out.push({
                event: ev,
                item: {},
                story: { id: '', name: '' }
            });
        }

        const nameById = await this._resolveTemplateNames(templateIds, seedTemplates);
        out.forEach(function (row) {
            const ev = row.event;
            if (!ev) return;
            if (!ev.templateName && ev.templateId && nameById[ev.templateId]) {
                ev.templateName = nameById[ev.templateId];
            }
        });
        return out;
    }

    // Все события из БД (GET /events), без привязки к плейлисту.
    // Формат строк тот же, что у listPlaylistEvents: { event, item, story }.
    async listAllEvents() {
        const headers = await this.listEvents() || [];
        const out = [];
        const templateIds = [];
        const concurrency = 8;

        async function fetchOne(self, h) {
            var event = null;
            try {
                event = self._unwrapEvent(await self.getEvent(h.id));
            } catch (err) {
                event = {
                    id: h.id,
                    name: h.name || h.id,
                    changed: h.changed,
                    externalId: h.externalId,
                    _fetchError: err && err.message ? err.message : String(err)
                };
            }
            // Заголовки списка иногда содержат поля, которых нет в полном ответе.
            if (event) {
                if (!event.name && h.name) event.name = h.name;
                if (event.changed == null && h.changed != null) event.changed = h.changed;
                if (!event.externalId && h.externalId) event.externalId = h.externalId;
                if (!event.templateName && h.templateName) event.templateName = h.templateName;
                if (!event.templateId && h.templateId) event.templateId = h.templateId;
            }
            return event;
        }

        for (let i = 0; i < headers.length; i += concurrency) {
            const chunk = headers.slice(i, i + concurrency);
            const events = await Promise.all(chunk.map((h) => fetchOne(this, h)));
            for (let j = 0; j < events.length; j++) {
                const event = events[j];
                if (event && event.templateId) templateIds.push(event.templateId);
                out.push({ event: event, item: {}, story: { id: '', name: '' } });
            }
        }

        const nameById = await this._resolveTemplateNames(templateIds, []);
        out.forEach(function (row) {
            const ev = row.event;
            if (!ev) return;
            if (!ev.templateName && ev.templateId && nameById[ev.templateId]) {
                ev.templateName = nameById[ev.templateId];
            }
        });
        return out;
    }

    /* ---------------- Плейлисты / истории (для поиска элемента) ---------------- */

    listPlaylists() {
        return this._request('GET', '/playlists');
    }

    getPlaylist(playlistId) {
        return this._request('GET', '/playlists/' + encodeURIComponent(playlistId));
    }

    getStory(storyId) {
        return this._request('GET', '/stories/' + encodeURIComponent(storyId));
    }

    /* ---------------- Элемент сценария (проигрывание) ---------------- */

    getItem(itemId) {
        return this._request('GET', '/items/' + encodeURIComponent(itemId));
    }

    // Прогрузить элемент (готовит шаблон к эфиру: Unloaded -> Loading -> Ready).
    loadItem(itemId) {
        return this._request('POST', '/items/' + encodeURIComponent(itemId) + '/load');
    }

    // Выдать в эфир. body: { timeStamp?, duration? } — можно не передавать.
    takeInItem(itemId, body) {
        return this._request('POST',
            '/items/' + encodeURIComponent(itemId) + '/takeIn', body || {});
    }

    // Снять с эфира (Closing State). body: { timeStamp? } — можно не передавать.
    takeOutItem(itemId, body) {
        return this._request('POST',
            '/items/' + encodeURIComponent(itemId) + '/takeOut', body || {});
    }

    // Выгрузить элемент (освобождает память).
    unloadItem(itemId) {
        return this._request('POST', '/items/' + encodeURIComponent(itemId) + '/unload');
    }
}

module.exports = { CarrotClient, CarrotError, ERROR_NAMES };
