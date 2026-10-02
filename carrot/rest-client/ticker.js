'use strict';

/* =====================================================================
   TickerClient — операции над строками бегущей строки поверх CarrotClient
   ---------------------------------------------------------------------
   Строки бегущей строки хранятся в ОДНОЙ многострочной текстовой
   переменной события (по умолчанию "inputext") — так же, как их читает
   скрипт шаблона (split по /\r?\n/). Клиент читает значение, меняет
   набор строк и пишет обратно через editVariables.

   Пустые строки игнорируются (для бегущей строки они не нужны) — это
   держит индексацию list/add/rm предсказуемой.
   ===================================================================== */

const SPLIT_RE = /\r?\n/;

// Разбить значение переменной на непустые строки.
function parseLines(value) {
    if (!value) return [];
    return value.split(SPLIT_RE).filter(function (s) { return s.trim() !== ''; });
}

class TickerClient {
    constructor(client, opts) {
        opts = opts || {};
        this.client = client;
        this.eventId = opts.eventId || null;
        this.eventName = opts.eventName || null;
        this.varName = opts.varName || 'inputext';
    }

    async _resolveEventId() {
        if (this.eventId) return this.eventId;
        if (!this.eventName) throw new Error('нужен eventId или eventName');
        const id = await this.client.findEventIdByName(this.eventName);
        if (!id) throw new Error('Событие не найдено по имени: ' + this.eventName);
        this.eventId = id;
        return id;
    }

    // Текущие строки бегущей строки.
    async getLines() {
        const id = await this._resolveEventId();
        const ev = await this.client.getEvent(id);
        const vars = ev && ev.variables ? ev.variables : [];
        const v = vars.find((x) => x.name === this.varName);
        if (!v) {
            const names = vars.map((x) => x.name).join(', ');
            throw new Error('Переменная "' + this.varName + '" не найдена. Есть: ' + (names || '—'));
        }
        return parseLines(v.value);
    }

    // Полностью заменить набор строк.
    async setLines(lines) {
        const id = await this._resolveEventId();
        const clean = (lines || []).filter(function (s) { return String(s).trim() !== ''; });
        const value = clean.join('\n');
        await this.client.editVariables(id, [{ name: this.varName, value: value }]);
        return clean;
    }

    // Добавить строку: в конец (position null) или на позицию position.
    async addLine(text, position) {
        const lines = await this.getLines();
        if (position == null || position < 0 || position > lines.length) lines.push(text);
        else lines.splice(position, 0, text);
        return this.setLines(lines);
    }

    // Удалить строку по индексу.
    async removeAt(index) {
        const lines = await this.getLines();
        if (index < 0 || index >= lines.length) {
            throw new Error('Нет строки с индексом ' + index + ' (всего ' + lines.length + ')');
        }
        lines.splice(index, 1);
        return this.setLines(lines);
    }

    // Удалить все строки, содержащие подстроку.
    async removeMatching(substr) {
        const lines = await this.getLines();
        const kept = lines.filter(function (l) { return l.indexOf(substr) === -1; });
        return this.setLines(kept);
    }

    // Очистить все строки.
    async clear() {
        return this.setLines([]);
    }
}

module.exports = { TickerClient, parseLines };
