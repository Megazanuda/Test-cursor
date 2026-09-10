'use strict';

/* =====================================================================
   CarrotClient — минимальный REST-клиент Carrot Broadcast
   ---------------------------------------------------------------------
   Без внешних зависимостей. Требует Node.js >= 18 (глобальный fetch).

   Берёт на себя:
     - авторизацию (POST /auth/generate) и автообновление токена;
     - обязательные query-параметры конверта (MessageId/Time/SenderId/ReceiverId);
     - разбор обёртки Message<T> и доменных ошибок ResponseData.errorCode;
     - ретраи на сетевых сбоях с экспоненциальной задержкой;
     - повтор запроса один раз при 401 (протух токен).
   ===================================================================== */

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

    async findEventIdByName(name) {
        const list = await this.listEvents();
        const hit = (list || []).find(function (h) { return h.name === name; });
        return hit ? hit.id : null;
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
