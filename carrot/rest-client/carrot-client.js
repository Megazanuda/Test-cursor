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

// Carrot иногда кодирует пробелы/символы как _x0020_ в текстах ошибок.
function decodeCarrotText(s) {
    return String(s == null ? '' : s).replace(/_x([0-9A-Fa-f]{4})_/g, function (_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
    });
}

// Корневая папка медиабиблиотеки Carrot (типичный GUID инсталляции).
const MEDIA_ROOT_FOLDER_ID = '5535E4A7-94EE-45AD-A27B-9AFC737597B2';
const MEDIA_EMPTY_FOLDER_ID = '00000000-0000-0000-0000-000000000000';
const MEDIA_MAX_FOLDERS = 250;

function xmlField(block, name) {
    const tag = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const el = block.match(new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>', 'i'));
    if (el) return el[1];
    const attr = block.match(new RegExp('\\b' + tag + '\\s*=\\s*"([^"]*)"', 'i'));
    return attr ? attr[1] : null;
}

function defaultWsUrlFromBase(baseUrl, port) {
    try {
        const u = new URL(baseUrl);
        const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
        return proto + '//' + u.hostname + ':' + (port || 24710);
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
        // 24710 — команды/плейлисты; 24712 — файлы/медиа (MediaAssetLibrary).
        this.wsUrl = opts.wsUrl || defaultWsUrlFromBase(this.baseUrl, 24710);
        this.wsFileUrl = opts.wsFileUrl || defaultWsUrlFromBase(this.baseUrl, 24712);

        this.token = null;
        this.tokenAcquiredAt = 0;
        this.tokenTtlMs = 55 * 60 * 1000; // токен живёт 1 час — обновляем заранее
        this.maxRetries = (opts.maxRetries != null) ? opts.maxRetries : 3;

        this._messageId = 0;
        // Кэш списка всех событий и имён шаблонов — иначе «Все события» делает N×GET.
        this._allEventsCache = null;
        this._allEventsCacheAt = 0;
        this._allEventsCacheTtlMs = (opts.allEventsCacheTtlMs != null)
            ? opts.allEventsCacheTtlMs : 120000;
        this._templateNameCache = Object.create(null);
    }

    invalidateEventsCache() {
        this._allEventsCache = null;
        this._allEventsCacheAt = 0;
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
            if (r.ok) {
                this.invalidateEventsCache();
                return r.data;
            }
            // Доменные ошибки (InUse и т.п.) — не маскируем перебором.
            if (r.error instanceof CarrotError && r.error.errorCode) throw r.error;
            if (r.httpStatus && r.httpStatus !== 404 && r.httpStatus !== 405) {
                throw r.error;
            }
        }

        try {
            const wsResult = await this.deleteEventViaWebSocket(eventId);
            this.invalidateEventsCache();
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

    // Список шаблонов (если REST отдаёт). Нужен, чтобы не ходить GET /events/{id} на каждый ивент.
    listTemplates() {
        return this._request('GET', '/templates');
    }

    // Нормализовать шаблон из REST (camelCase / PascalCase / обёртки).
    normalizeTemplate(raw) {
        if (!raw) return null;
        const t = (raw.template && !raw.id && !raw.Id) ? raw.template : raw;
        const id = t.id || t.Id || '';
        const name = t.name || t.Name || '';
        const contentId = t.contentId || t.ContentId || '';
        const templateTypeInt = (t.templateTypeInt != null) ? t.templateTypeInt
            : ((t.TemplateTypeInt != null) ? t.TemplateTypeInt : 1);
        const defaultInState = t.defaultInState || t.DefaultInState || '';
        const closingState = t.closingState || t.ClosingState || '';
        const stateInfos = t.stateInfos || t.StateInfos || [];
        const states = [];
        (Array.isArray(stateInfos) ? stateInfos : []).forEach(function (s) {
            const st = (s && (s.state || s.State)) || '';
            if (st && states.indexOf(st) === -1) states.push(st);
        });
        if (defaultInState && states.indexOf(defaultInState) === -1) {
            states.unshift(defaultInState);
        }
        if (!states.length) states.push('IN');

        const linkVars = t.linkVars || t.LinkVars || t.variables || t.Variables || [];
        const variables = (Array.isArray(linkVars) ? linkVars : []).map(function (v) {
            if (!v) return null;
            return {
                id: v.id || v.Id || '',
                name: v.name || v.Name || '',
                type: v.type || v.Type || 'Text',
                value: (v.value != null) ? v.value
                    : ((v.Value != null) ? v.Value
                        : ((v.defaultValue != null) ? v.defaultValue
                            : ((v.DefaultValue != null) ? v.DefaultValue : ''))),
                fieldId: v.fieldId || v.FieldId || '',
                defaultValue: (v.defaultValue != null) ? v.defaultValue
                    : ((v.DefaultValue != null) ? v.DefaultValue : ''),
                resetMedia: (v.resetMedia != null) ? v.resetMedia
                    : ((v.ResetMedia != null) ? v.ResetMedia : true),
                useTimecode: (v.useTimecode != null) ? v.useTimecode
                    : ((v.UseTimecode != null) ? v.UseTimecode : false),
                loop: (v.loop != null) ? v.loop : ((v.Loop != null) ? v.Loop : false),
                locked: (v.locked != null) ? v.locked : ((v.Locked != null) ? v.Locked : false),
                minValue: (v.minValue != null) ? v.minValue
                    : ((v.MinValue != null) ? v.MinValue : ''),
                maxValue: (v.maxValue != null) ? v.maxValue
                    : ((v.MaxValue != null) ? v.MaxValue : ''),
                useDataVars: (v.useDataVars != null) ? v.useDataVars
                    : ((v.UseDataVars != null) ? v.UseDataVars : false)
            };
        }).filter(function (v) { return v && v.name; });

        return {
            id: id,
            name: name,
            contentId: contentId,
            templateTypeInt: templateTypeInt,
            defaultInState: defaultInState || states[0],
            closingState: closingState,
            states: states,
            variables: variables,
            raw: t
        };
    }

    async getNormalizedTemplate(templateId) {
        const raw = await this.getTemplate(templateId);
        const tpl = this.normalizeTemplate(raw);
        if (!tpl || !tpl.id) {
            throw new CarrotError('Шаблон не найден или пустой ответ: ' + templateId);
        }
        if (tpl.name) this._templateNameCache[tpl.id] = tpl.name;
        return tpl;
    }

    async listNormalizedTemplates() {
        const raw = await this.listTemplates();
        const flat = this._flattenTemplates(raw);
        const self = this;
        return flat.map(function (t) {
            const n = self.normalizeTemplate(t);
            if (n && n.id && n.name) self._templateNameCache[n.id] = n.name;
            return n;
        }).filter(function (t) { return t && t.id; })
            .sort(function (a, b) {
                return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
            });
    }

    _boolAttr(v) {
        if (v === true || v === 'true' || v === 'True') return 'true';
        if (v === false || v === 'false' || v === 'False') return 'false';
        return v ? 'true' : 'false';
    }

    _variableToXml(v) {
        return '<Variable' +
            ' Id="' + xmlEscape(v.id || '') + '"' +
            ' Name="' + xmlEscape(v.name || '') + '"' +
            ' Type="' + xmlEscape(v.type || 'Text') + '"' +
            ' Value="' + xmlEscape(v.value == null ? '' : v.value) + '"' +
            ' FieldId="' + xmlEscape(v.fieldId || '') + '"' +
            ' ResetMedia="' + this._boolAttr(v.resetMedia != null ? v.resetMedia : true) + '"' +
            ' UseTimecode="' + this._boolAttr(v.useTimecode != null ? v.useTimecode : false) + '"' +
            ' Loop="' + this._boolAttr(v.loop != null ? v.loop : false) + '"' +
            ' Locked="' + this._boolAttr(v.locked != null ? v.locked : false) + '"' +
            ' DefaultValue="' + xmlEscape(v.defaultValue == null ? '' : v.defaultValue) + '"' +
            ' MinValue="' + xmlEscape(v.minValue == null ? '' : v.minValue) + '"' +
            ' MaxValue="' + xmlEscape(v.maxValue == null ? '' : v.maxValue) + '"' +
            ' UseDataVars="' + this._boolAttr(v.useDataVars != null ? v.useDataVars : false) + '"' +
            ' />';
    }

    _eventCreateToXml(event, messageId) {
        const vars = event.variables || [];
        const self = this;
        const varsXml = vars.map(function (v) { return self._variableToXml(v); }).join('');
        // Пустой ExternalId у Carrot часто даёт AlreadyExists — по умолчанию = Id.
        const externalId = (event.externalId != null && String(event.externalId).trim() !== '')
            ? String(event.externalId).trim()
            : event.id;
        return '<Command CmdGroup="Playlists" CmdName="CreateEventInDB" MessageId="' +
            messageId + '">' +
            '<Event>' +
            '<Id>' + xmlEscape(event.id) + '</Id>' +
            '<Name>' + xmlEscape(event.name || '') + '</Name>' +
            '<Created>01.01.0001 0:00:00</Created>' +
            '<Changed>01.01.0001 0:00:00</Changed>' +
            '<ExternalId>' + xmlEscape(externalId) + '</ExternalId>' +
            '<TemplateId>' + xmlEscape(event.templateId) + '</TemplateId>' +
            '<ContentId>' + xmlEscape(event.contentId || '') + '</ContentId>' +
            '<TemplateTypeInt>' + xmlEscape(
                event.templateTypeInt != null ? event.templateTypeInt : 1
            ) + '</TemplateTypeInt>' +
            '<State>' + xmlEscape(event.state || 'IN') + '</State>' +
            '<Comment>' + xmlEscape(event.comment || '') + '</Comment>' +
            '<Variables>' + varsXml + '</Variables>' +
            '</Event></Command>';
    }

    // Создать одно или несколько событий (REST, затем WS CreateEventInDB).
    // entries: [{ name, templateId, contentId?, templateTypeInt?, state?, comment?, variables? }]
    async createEvents(entries) {
        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) throw new Error('Нужен непустой массив событий');

        const prepared = [];
        for (let i = 0; i < list.length; i++) {
            const e = list[i] || {};
            if (!e.templateId) {
                throw new Error('Событие #' + (i + 1) + ': нужен templateId');
            }
            if (!e.name || !String(e.name).trim()) {
                throw new Error('Событие #' + (i + 1) + ': нужно имя');
            }
            let contentId = e.contentId || '';
            let templateTypeInt = e.templateTypeInt;
            let variables = Array.isArray(e.variables) ? e.variables : [];
            let state = e.state || 'IN';

            if (!contentId || templateTypeInt == null || !variables.length) {
                const tpl = await this.getNormalizedTemplate(e.templateId);
                if (!contentId) contentId = tpl.contentId;
                if (templateTypeInt == null) templateTypeInt = tpl.templateTypeInt;
                if (!e.state) state = tpl.defaultInState || state;
                if (!variables.length) {
                    variables = tpl.variables.map(function (v) {
                        return Object.assign({}, v, {
                            value: (v.value != null && v.value !== '')
                                ? v.value
                                : (v.defaultValue || '')
                        });
                    });
                } else {
                    // Подмешать метаданные LinkVar к значениям с UI.
                    const byName = Object.create(null);
                    tpl.variables.forEach(function (v) { byName[v.name] = v; });
                    variables = variables.map(function (v) {
                        const meta = byName[v.name] || {};
                        return Object.assign({}, meta, v, {
                            value: v.value == null ? (meta.defaultValue || '') : v.value
                        });
                    });
                }
            }

            if (!contentId) {
                throw new Error(
                    'Событие «' + String(e.name).trim() +
                    '»: у шаблона нет ContentId — создание невозможно'
                );
            }

            const id = e.id || crypto.randomUUID();
            const externalId = (e.externalId != null && String(e.externalId).trim() !== '')
                ? String(e.externalId).trim()
                : id;
            prepared.push({
                id: id,
                name: String(e.name).trim(),
                externalId: externalId,
                templateId: e.templateId,
                contentId: contentId,
                templateTypeInt: (templateTypeInt != null) ? templateTypeInt : 1,
                state: state || 'IN',
                comment: e.comment || '',
                variables: variables
            });
        }

        // Имя и ExternalId в Carrot могут повторяться у разных событий.
        // Пустой ExternalId по-прежнему подменяется на Id (см. выше).

        // REST: иногда есть POST /events.
        const created = [];
        const needWs = [];
        for (let i = 0; i < prepared.length; i++) {
            const ev = prepared[i];
            const restBody = {
                id: ev.id,
                name: ev.name,
                externalId: ev.externalId,
                templateId: ev.templateId,
                contentId: ev.contentId,
                templateTypeInt: ev.templateTypeInt,
                state: ev.state,
                comment: ev.comment,
                variables: ev.variables.map(function (v) {
                    return {
                        id: v.id,
                        name: v.name,
                        type: v.type,
                        value: v.value == null ? '' : String(v.value),
                        fieldId: v.fieldId,
                        defaultValue: v.defaultValue,
                        resetMedia: v.resetMedia,
                        useTimecode: v.useTimecode,
                        loop: v.loop,
                        locked: v.locked,
                        minValue: v.minValue,
                        maxValue: v.maxValue,
                        useDataVars: v.useDataVars
                    };
                })
            };
            const r = await this._tryOnce('POST', '/events', restBody);
            if (r.ok) {
                created.push({ id: ev.id, name: ev.name, via: 'rest' });
                continue;
            }
            if (r.error instanceof CarrotError && r.error.errorCode) throw r.error;
            if (r.httpStatus && r.httpStatus !== 404 && r.httpStatus !== 405) {
                throw r.error || new CarrotError('HTTP ' + r.httpStatus);
            }
            needWs.push(ev);
        }

        if (needWs.length) {
            const wsCreated = await this.createEventsViaWebSocket(needWs);
            created.push.apply(created, wsCreated);
        }

        this.invalidateEventsCache();
        return { created: created };
    }

    // Создание через WS API: Playlists / CreateEventInDB (см. carrotsoftware/api).
    createEventsViaWebSocket(events) {
        const self = this;
        const list = Array.isArray(events) ? events.slice() : [];
        const wsUrl = this.wsUrl;
        if (!list.length) {
            return Promise.resolve([]);
        }
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
            return Promise.reject(new Error('login/password обязательны для WS-создания'));
        }

        const sessionId = crypto.randomUUID();
        const timeoutMs = Math.max(this.timeoutMs * list.length, 20000);

        return new Promise(function (resolve, reject) {
            var ws;
            var msgId = 1;
            var stage = 'wait-client-id';
            var settled = false;
            var index = 0;
            const created = [];

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

            function sendNext() {
                if (index >= list.length) {
                    done(null, created);
                    return;
                }
                stage = 'create';
                const ev = list[index];
                send(self._eventCreateToXml(ev, msgId++));
            }

            const timer = setTimeout(function () {
                done(new CarrotError(
                    'Таймаут WebSocket при создании события (stage=' + stage +
                    ', index=' + index + ', url=' + wsUrl + ')'
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
                        'WebSocket закрыт до завершения создания (stage=' + stage + ')'
                    ));
                }
            });

            ws.addEventListener('message', function (ev) {
                const text = String(ev.data || '');

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
                        sendNext();
                        return;
                    }
                }

                if (stage === 'create') {
                    if (/CmdName="EventAdded"/.test(text)) {
                        const cur = list[index];
                        created.push({
                            id: cur.id,
                            name: cur.name,
                            via: 'websocket'
                        });
                        index++;
                        sendNext();
                        return;
                    }
                    if (/CmdName="[^"]*Error[^"]*"/.test(text) ||
                        /CmdGroup="Error"/.test(text) ||
                        /already_x0020_exists|already exists/i.test(text)) {
                        const m = text.match(/<Message>([\s\S]*?)<\/Message>/) ||
                            text.match(/<Description>([\s\S]*?)<\/Description>/) ||
                            text.match(/CmdName="([^"]+)"/);
                        const cur = list[index] || {};
                        const rawMsg = m ? m[1] : text.slice(0, 260);
                        const msg = decodeCarrotText(rawMsg);
                        done(new CarrotError(
                            'Не удалось создать «' + (cur.name || cur.id || '?') + '»: ' +
                            msg +
                            ( /already exists/i.test(msg)
                                ? ' — сервер отклонил как уже существующее'
                                : ''),
                            { errorCode: /already exists/i.test(msg) ? 42 : undefined }
                        ));
                    }
                }
            });
        });
    }

    // Список медиа: REST GET /assets/folder/{folderId} (swagger), затем WS 24712.
    async listMediaAssets(opts) {
        opts = opts || {};
        const deep = opts.deep !== false;
        const preferredRoot = opts.folderId || MEDIA_ROOT_FOLDER_ID;

        const viaRest = await this.listMediaAssetsViaRestFolder({
            folderId: preferredRoot,
            deep: deep
        });
        if (viaRest.assets.length) {
            console.log('[media] REST /assets/folder: ' + viaRest.assets.length +
                ' активов, папок=' + viaRest.foldersOk);
            return viaRest.assets;
        }

        const restPaths = ['/media', '/assets', '/mediaAssets', '/media/assets'];
        for (let i = 0; i < restPaths.length; i++) {
            const r = await this._tryOnce('GET', restPaths[i]);
            if (r.ok) {
                const flat = this._flattenMedia(r.data);
                if (flat.length) {
                    console.log('[media] REST ' + restPaths[i] + ': ' + flat.length);
                    return flat;
                }
            }
        }

        try {
            const viaWs = await this.listMediaAssetsViaWebSocket({
                folderId: preferredRoot,
                deep: deep
            });
            if (viaWs && viaWs.length) {
                console.log('[media] WS 24712: ' + viaWs.length + ' активов');
                return viaWs;
            }
        } catch (err) {
            const hint = viaRest.lastErr || (err && err.message) || 'пустой ответ';
            throw new CarrotError(
                'Медиа не загрузились. REST /assets/folder пуст' +
                (viaRest.foldersOk ? '' : ' (папки не открылись)') +
                '; WS: ' + hint,
                { code: err && err.code, url: err && err.url }
            );
        }

        throw new CarrotError(
            'Медиа не найдены: REST /assets/folder/{id} вернул 0 активов' +
            (viaRest.foldersOk
                ? ' (папок просмотрено: ' + viaRest.foldersOk + ')'
                : ' (не удалось открыть ни одну папку' +
                    (viaRest.lastErr ? ': ' + viaRest.lastErr : '') + ')') +
            '. Проверь GUID корня и доступ к REST/WS 24712.'
        );
    }

    // Swagger: GET /assets/folder/{folderId} — обход дерева папок.
    async listMediaAssetsViaRestFolder(opts) {
        opts = opts || {};
        const deep = opts.deep !== false;
        const preferredRoot = opts.folderId || MEDIA_ROOT_FOLDER_ID;
        const pending = [];
        [preferredRoot, MEDIA_EMPTY_FOLDER_ID, MEDIA_ROOT_FOLDER_ID].forEach(function (id) {
            if (id && pending.indexOf(id) === -1) pending.push(id);
        });
        const fetched = Object.create(null);
        const assets = [];
        const seen = Object.create(null);
        var foldersOk = 0;
        var lastErr = null;
        var scanned = 0;

        while (pending.length && scanned < MEDIA_MAX_FOLDERS) {
            const fid = pending.shift();
            if (!fid || fetched[fid]) continue;
            fetched[fid] = true;
            scanned++;
            const r = await this._tryOnce(
                'GET',
                '/assets/folder/' + encodeURIComponent(fid)
            );
            if (!r.ok) {
                lastErr = r.message || ('HTTP ' + (r.httpStatus || '?'));
                continue;
            }
            foldersOk++;
            const parsed = this._parseMediaFolderPayload(r.data);
            for (let i = 0; i < parsed.assets.length; i++) {
                const a = parsed.assets[i];
                if (!a.id || seen[a.id]) continue;
                seen[a.id] = true;
                assets.push(a);
            }
            if (deep) {
                for (let i = 0; i < parsed.folderIds.length; i++) {
                    const child = parsed.folderIds[i];
                    if (child && !fetched[child] && pending.indexOf(child) === -1 &&
                        pending.length + scanned < MEDIA_MAX_FOLDERS) {
                        pending.push(child);
                    }
                }
            }
        }

        assets.sort(function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });
        return { assets: assets, foldersOk: foldersOk, lastErr: lastErr, scanned: scanned };
    }

    _parseMediaFolderPayload(raw) {
        const assets = [];
        const folderIds = [];
        const seenA = Object.create(null);
        const seenF = Object.create(null);
        function addFolder(id) {
            if (!id || seenF[id]) return;
            seenF[id] = true;
            folderIds.push(id);
        }
        function addAsset(node) {
            const id = node.id || node.ID || node.assetId || node.AssetId;
            if (!id || seenA[id]) return;
            const name = node.name || node.Name;
            seenA[id] = true;
            assets.push({
                id: id,
                name: (name != null && String(name) !== '') ? name : id,
                assetTypeInt: (node.assetTypeInt != null) ? node.assetTypeInt
                    : node.AssetTypeInt,
                parentId: node.parentId || node.ParentID || node.ParentId || ''
            });
        }
        function walk(node, under) {
            if (!node) return;
            if (Array.isArray(node)) {
                node.forEach(function (n) { walk(n, under); });
                return;
            }
            if (typeof node !== 'object') return;

            const id = node.id || node.ID || node.assetId || node.AssetId;
            const name = node.name || node.Name;
            const hasType = node.assetTypeInt != null || node.AssetTypeInt != null;
            const typeStr = String(node.type || node.kind || '').toLowerCase();
            const isAsset = !!(id && (
                hasType || typeStr === 'asset' || under === 'assets'
            ));
            const isFolder = !!(id && !isAsset && (
                typeStr === 'folder' || under === 'folders' ||
                (name != null && (node.parentId != null || node.ParentID != null ||
                    node.ParentId != null) && !hasType)
            ));

            if (isAsset) addAsset(node);
            else if (isFolder) addFolder(id);

            walk(node.assets || node.Assets, 'assets');
            walk(node.items || node.Items, under);
            walk(node.folders || node.Folders, 'folders');
            walk(node.folderStructure || node.FolderStructure, under);
            walk(node.children, under);
        }
        walk(raw, '');
        return { assets: assets, folderIds: folderIds };
    }

    _flattenMedia(raw) {
        return this._parseMediaFolderPayload(raw).assets.sort(function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });
    }

    listMediaAssetsViaWebSocket(opts) {
        opts = opts || {};
        const preferredRoot = opts.folderId || MEDIA_ROOT_FOLDER_ID;
        const deep = opts.deep !== false;
        // Медиа ходит по WS обмена файлами (порт 24712), не 24710.
        const wsUrl = opts.wsUrl || this.wsFileUrl || this.wsUrl;
        if (!wsUrl) {
            return Promise.reject(new CarrotError(
                'Не задан WebSocket URL для медиа (CARROT_WS_FILE_URL, порт 24712)'
            ));
        }
        if (typeof WebSocket === 'undefined') {
            return Promise.reject(new CarrotError(
                'WebSocket недоступен в этой версии Node.js (нужен Node >= 21/22)'
            ));
        }
        if (!this.login || !this.password) {
            return Promise.reject(new Error('login/password обязательны для WS-медиа'));
        }

        const sessionId = crypto.randomUUID();
        const timeoutMs = Math.max(this.timeoutMs, 45000);
        const seedRoots = [];
        [preferredRoot, MEDIA_EMPTY_FOLDER_ID, MEDIA_ROOT_FOLDER_ID].forEach(function (id) {
            if (id && seedRoots.indexOf(id) === -1) seedRoots.push(id);
        });

        return new Promise(function (resolve, reject) {
            var ws;
            var msgId = 1;
            var stage = 'wait-client-id';
            var settled = false;
            const assets = [];
            const seen = Object.create(null);
            const pendingFolders = seedRoots.slice();
            const fetchedFolders = Object.create(null);
            var foldersQueued = seedRoots.length;

            function done(err, value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { ws.close(); } catch (e) { /* ignore */ }
                if (err) reject(err);
                else resolve(value);
            }

            function send(xml) { ws.send(xml); }

            function finishOk() {
                assets.sort(function (a, b) {
                    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
                });
                done(null, assets);
            }

            function requestNextFolder() {
                while (pendingFolders.length) {
                    const fid = pendingFolders.shift();
                    if (!fid || fetchedFolders[fid]) continue;
                    fetchedFolders[fid] = true;
                    stage = 'media';
                    send(
                        '<Command CmdGroup="MediaAssetLibrary" CmdName="GetAssetFolder" MessageId="' +
                        (msgId++) + '">' +
                        '<FolderID>' + xmlEscape(fid) + '</FolderID></Command>'
                    );
                    return;
                }
                finishOk();
            }

            function queueFolder(id) {
                if (!id || !deep || fetchedFolders[id] || pendingFolders.indexOf(id) !== -1) {
                    return;
                }
                if (foldersQueued >= MEDIA_MAX_FOLDERS) return;
                foldersQueued++;
                pendingFolders.push(id);
            }

            function parseFolderXml(text) {
                // <Folder>...</Folder> или <Folder ID="..." Name="..."/>
                const folderRe = /<Folder(\s[^>]*)?\/>|<Folder(\s[^>]*)?>([\s\S]*?)<\/Folder>/gi;
                const assetRe = /<Asset(\s[^>]*)?\/>|<Asset(\s[^>]*)?>([\s\S]*?)<\/Asset>/gi;
                var m;
                while ((m = folderRe.exec(text))) {
                    const block = (m[1] || '') + (m[2] || '') + (m[3] || '');
                    const id = xmlField(block, 'ID') || xmlField(block, 'FolderID') ||
                        xmlField(block, 'FolderId');
                    if (id) queueFolder(id);
                }
                while ((m = assetRe.exec(text))) {
                    const block = (m[1] || '') + (m[2] || '') + (m[3] || '');
                    const id = xmlField(block, 'ID') || xmlField(block, 'AssetId') ||
                        xmlField(block, 'AssetID');
                    if (!id || seen[id]) continue;
                    const name = xmlField(block, 'Name');
                    const typeRaw = xmlField(block, 'AssetTypeInt');
                    const parentId = xmlField(block, 'ParentID') || xmlField(block, 'ParentId') || '';
                    seen[id] = true;
                    assets.push({
                        id: id,
                        name: decodeCarrotText(name != null && name !== '' ? name : id),
                        assetTypeInt: typeRaw != null && typeRaw !== ''
                            ? parseInt(typeRaw, 10) : undefined,
                        parentId: parentId || ''
                    });
                }
            }

            const timer = setTimeout(function () {
                done(new CarrotError(
                    'Таймаут WebSocket при загрузке медиа (stage=' + stage + ')'
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
                    'Ошибка WebSocket медиа [' + wsUrl + ']. Нужен порт 24712 (обмен файлами).',
                    { url: wsUrl }
                ));
            });
            ws.addEventListener('close', function () {
                if (!settled) {
                    done(new CarrotError(
                        'WebSocket медиа закрыт до завершения (stage=' + stage + ', url=' + wsUrl + ')'
                    ));
                }
            });

            ws.addEventListener('message', function (ev) {
                const text = String(ev.data || '');
                if (/CmdGroup="HeartBeat"/.test(text) && !/MessageId=/.test(text)) {
                    send(
                        '<Command CmdGroup="HeartBeat" MessageId="-1">' +
                        '<SessionId>' + sessionId + '</SessionId></Command>'
                    );
                    return;
                }
                if (stage === 'wait-client-id' && /CmdGroup="ClientID"/.test(text)) {
                    // Файловый канал (24712): HandShake, ждём ответ, потом GetAssetFolder.
                    // Users/LoginUnsecure здесь даёт Unknown Command Group.
                    stage = 'handshake';
                    send(
                        '<Command CmdGroup="HandShake" MessageId="' + (msgId++) + '">' +
                        '<AppName>ticker-web</AppName>' +
                        '<SessionID>' + sessionId + '</SessionID></Command>'
                    );
                    return;
                }
                if (stage === 'handshake') {
                    // Любой ответ после HandShake (кроме heartbeat) — можно запрашивать папки.
                    if (/Unknown Command Group/i.test(text)) {
                        done(new CarrotError(
                            'WS ошибка медиа: Unknown Command Group на ' + wsUrl +
                            '. Нужен порт 24712 (CARROT_WS_FILE_URL), не 24710.'
                        ));
                        return;
                    }
                    stage = 'media';
                    // Если HandShake-ответ уже содержит структуру — разберём.
                    if (/CmdGroup="MediaAssetLibrary"/.test(text) ||
                        /FolderStructure|<Asset[\s>]|<Folder[\s>]/i.test(text)) {
                        parseFolderXml(text);
                    }
                    requestNextFolder();
                    return;
                }
                if (stage === 'media') {
                    if (/Unknown Command Group/i.test(text)) {
                        done(new CarrotError(
                            'WS ошибка медиа: Unknown Command Group на ' + wsUrl +
                            '. Нужен порт 24712 (CARROT_WS_FILE_URL), не 24710.'
                        ));
                        return;
                    }
                    // HandShake / служебные ответы — пропускаем.
                    if (/CmdGroup="HandShake"/i.test(text) &&
                        !/MediaAssetLibrary|FolderStructure|<Asset[\s>]/i.test(text)) {
                        return;
                    }
                    if (/CmdGroup="MediaAssetLibrary"/.test(text) ||
                        /FolderStructure|<Asset[\s>/]|<\/Asset>|<Folder[\s>/]/i.test(text)) {
                        parseFolderXml(text);
                        requestNextFolder();
                        return;
                    }
                    if (/CmdName="[^"]*Error[^"]*"/.test(text) || /CmdGroup="Error"/.test(text)) {
                        // Несуществующий корень/папка — пробуем следующую, не валим весь список.
                        const soft = /not\s*found|не\s*найд|invalid|неверн/i.test(text);
                        if (soft) {
                            requestNextFolder();
                            return;
                        }
                        const m = text.match(/<Message>([\s\S]*?)<\/Message>/) ||
                            text.match(/<Description>([\s\S]*?)<\/Description>/);
                        done(new CarrotError(
                            'WS ошибка медиа: ' + decodeCarrotText(m ? m[1] : text.slice(0, 220))
                        ));
                    }
                }
            });
        });
    }

    _flattenTemplates(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) {
            const out = [];
            for (let i = 0; i < raw.length; i++) {
                const t = raw[i];
                if (!t) continue;
                if (t.id && (t.name != null || t.templateTypeInt != null)) {
                    out.push(t);
                    continue;
                }
                // Иногда приходит дерево групп.
                if (Array.isArray(t.templates)) {
                    out.push.apply(out, this._flattenTemplates(t.templates));
                }
                if (Array.isArray(t.templateGroups) || Array.isArray(t.groups)) {
                    out.push.apply(out,
                        this._flattenTemplates(t.templateGroups || t.groups));
                }
            }
            return out;
        }
        if (Array.isArray(raw.templates) || Array.isArray(raw.items)) {
            return this._flattenTemplates(raw.templates || raw.items);
        }
        return [];
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
        const map = Object.assign(Object.create(null), this._templateNameCache);
        (seedTemplates || []).forEach(function (t) {
            if (t && t.id) map[t.id] = t.name || '';
        });
        const missing = [];
        const seen = Object.create(null);
        for (let i = 0; i < templateIds.length; i++) {
            const tid = templateIds[i];
            if (!tid || seen[tid]) continue;
            seen[tid] = true;
            if (map[tid] !== undefined) continue;
            missing.push(tid);
        }
        const concurrency = 12;
        for (let i = 0; i < missing.length; i += concurrency) {
            const chunk = missing.slice(i, i + concurrency);
            const self = this;
            await Promise.all(chunk.map(async function (tid) {
                try {
                    const t = await self.getTemplate(tid);
                    map[tid] = (t && t.name) ? t.name : '';
                } catch (err) {
                    map[tid] = '';
                }
            }));
        }
        Object.keys(map).forEach((k) => { this._templateNameCache[k] = map[k]; });
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
    // Быстрый путь: берём заголовки списка + имена шаблонов (без N×GET /events/{id}).
    // Формат строк тот же, что у listPlaylistEvents: { event, item, story }.
    async listAllEvents(opts) {
        opts = opts || {};
        const force = !!opts.force;
        const now = Date.now();
        if (!force && this._allEventsCache &&
            (now - this._allEventsCacheAt) < this._allEventsCacheTtlMs) {
            return this._allEventsCache;
        }

        const headers = await this.listEvents() || [];

        var seedTemplates = [];
        try {
            seedTemplates = this._flattenTemplates(await this.listTemplates());
        } catch (err) {
            seedTemplates = [];
        }

        const out = [];
        const templateIds = [];
        const needDetail = [];

        for (let i = 0; i < headers.length; i++) {
            const h = headers[i] || {};
            const event = {
                id: h.id,
                name: h.name || h.id,
                created: h.created != null ? h.created : h.Created,
                changed: h.changed != null ? h.changed : h.Changed,
                externalId: h.externalId != null ? h.externalId : h.ExternalId,
                templateId: h.templateId ||
                    (h.template && h.template.id) || '',
                templateName: h.templateName ||
                    (h.template && h.template.name) || ''
            };
            if (event.templateId) templateIds.push(event.templateId);
            else if (!event.templateName) needDetail.push(event);
            out.push({ event: event, item: {}, story: { id: '', name: '' } });
        }

        // Догружаем детали ТОЛЬКО если в заголовке нет templateId/templateName.
        // Раньше это делалось для всех событий — отсюда минуты ожидания.
        if (needDetail.length) {
            const concurrency = 16;
            for (let i = 0; i < needDetail.length; i += concurrency) {
                const chunk = needDetail.slice(i, i + concurrency);
                const self = this;
                await Promise.all(chunk.map(async function (event) {
                    try {
                        const full = self._unwrapEvent(await self.getEvent(event.id));
                        if (!full) return;
                        if (full.name) event.name = full.name;
                        if (full.created != null) event.created = full.created;
                        if (full.changed != null) event.changed = full.changed;
                        if (full.externalId) event.externalId = full.externalId;
                        if (full.templateId) event.templateId = full.templateId;
                        if (full.templateName) event.templateName = full.templateName;
                        if (event.templateId) templateIds.push(event.templateId);
                    } catch (err) {
                        event._fetchError = err && err.message ? err.message : String(err);
                    }
                }));
            }
        }

        const nameById = await this._resolveTemplateNames(templateIds, seedTemplates);
        out.forEach(function (row) {
            const ev = row.event;
            if (!ev) return;
            if (!ev.templateName && ev.templateId && nameById[ev.templateId]) {
                ev.templateName = nameById[ev.templateId];
            }
        });

        this._allEventsCache = out;
        this._allEventsCacheAt = Date.now();
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

module.exports = {
    CarrotClient,
    CarrotError,
    ERROR_NAMES,
    decodeCarrotText,
    MEDIA_ROOT_FOLDER_ID
};
