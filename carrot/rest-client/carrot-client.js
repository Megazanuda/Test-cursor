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
    }
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

class CarrotClient {
    constructor(opts) {
        opts = opts || {};
        if (!opts.baseUrl) throw new Error('baseUrl обязателен (напр. http://host:port/api)');

        this.baseUrl = String(opts.baseUrl).replace(/\/+$/, ''); // без хвостовых слэшей
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
                const res = await fetch(url, {
                    method: method,
                    headers: headers,
                    body: (body !== undefined) ? JSON.stringify(body) : undefined
                });

                // Токен протух — обновим и повторим ровно один раз.
                if (res.status === 401 && needAuth && !opts._retriedAuth) {
                    this.token = null;
                    await this._ensureToken();
                    return this._request(method, path, body,
                        Object.assign({}, opts, { _retriedAuth: true }));
                }

                const text = await res.text();
                const json = text ? JSON.parse(text) : null;

                if (!res.ok) {
                    throw new CarrotError('HTTP ' + res.status + ' ' + res.statusText,
                        { httpStatus: res.status });
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
                lastErr = err;
                if (err instanceof CarrotError) throw err;   // доменные/HTTP не ретраим
                if (attempt < this.maxRetries) {             // сетевые — ретрай с backoff
                    await sleep(1000 * Math.pow(2, attempt));
                    continue;
                }
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
}

module.exports = { CarrotClient, CarrotError, ERROR_NAMES };
