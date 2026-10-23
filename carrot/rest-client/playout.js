'use strict';

/* =====================================================================
   PlayoutClient — выдача/снятие бегущей строки в эфир поверх CarrotClient
   ---------------------------------------------------------------------
   В Carrot проигрывается ЭЛЕМЕНТ СЦЕНАРИЯ (item), а не событие напрямую.
   Элемент ссылается на событие. Жизненный цикл:

     load    Unloaded(0) -> Loading(1) -> Ready(2)   готовим к эфиру
     takeIn  Ready(2)     -> Active(3)                выдаём в эфир
     takeOut Active(3)    -> Ready(2)                 снимаем (Closing State)
     unload  Ready(2)     -> Unloaded(0)              освобождаем память

   Элемент можно задать напрямую (itemId) или найти по событию внутри
   плейлиста (playlistId + eventId/eventName).
   ===================================================================== */

const STATUS = { UNLOADED: 0, LOADING: 1, READY: 2, ACTIVE: 3 };
const STATUS_NAME = { 0: 'Unloaded', 1: 'Loading', 2: 'Ready', 3: 'Active' };

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

class PlayoutClient {
    constructor(client, opts) {
        opts = opts || {};
        this.client = client;
        this.itemId = opts.itemId || null;
        this.playlistId = opts.playlistId || null;
        this.eventId = opts.eventId || null;
        this.eventName = opts.eventName || null;
    }

    async _resolveItemId() {
        if (this.itemId) return this.itemId;
        if (!this.playlistId) {
            throw new Error('нужен itemId (CARROT_ITEM_ID/--item) ' +
                'или playlistId (CARROT_PLAYLIST_ID) + событие для поиска элемента');
        }
        const id = await this.findItemId();
        if (!id) throw new Error('Элемент, ссылающийся на событие, в плейлисте не найден');
        this.itemId = id;
        return id;
    }

    // Найти элемент, ссылающийся на наше событие, в пределах плейлиста.
    async findItemId() {
        const pl = await this.client.getPlaylist(this.playlistId);
        const stories = (pl && pl.stories) ? pl.stories : [];
        for (const st of stories) {
            let items = st.items;
            if (!items) {
                const full = await this.client.getStory(st.id);
                items = full ? full.items : [];
            }
            const hit = (items || []).find((i) =>
                (this.eventId && i.eventId === this.eventId) ||
                (this.eventName && i.eventName === this.eventName));
            if (hit) return hit.id;
        }
        return null;
    }

    async status() {
        const id = await this._resolveItemId();
        const it = await this.client.getItem(id);
        return it ? it.status : null;
    }

    async load() { return this.client.loadItem(await this._resolveItemId()); }
    async takeIn(opts) { return this.client.takeInItem(await this._resolveItemId(), opts || {}); }
    async takeOut(opts) { return this.client.takeOutItem(await this._resolveItemId(), opts || {}); }
    async unload() { return this.client.unloadItem(await this._resolveItemId()); }

    // Дождаться готовности элемента (после load статус меняется асинхронно).
    async waitReady(timeoutMs, intervalMs) {
        timeoutMs = timeoutMs || 15000;
        intervalMs = intervalMs || 300;
        const id = await this._resolveItemId();
        const t0 = Date.now();
        for (;;) {
            const it = await this.client.getItem(id);
            const s = it ? it.status : null;
            if (s === STATUS.READY || s === STATUS.ACTIVE) return s;
            if (Date.now() - t0 > timeoutMs) {
                throw new Error('Таймаут ожидания готовности элемента (status=' +
                    (STATUS_NAME[s] || s) + ')');
            }
            await sleep(intervalMs);
        }
    }

    // Удобно: прогрузить (если нужно), дождаться Ready и выдать в эфир.
    async airOn(opts) {
        let s = await this.status();
        if (s === STATUS.ACTIVE) return; // уже в эфире
        if (s === STATUS.UNLOADED || s == null) {
            await this.load();
            s = await this.waitReady();
        } else if (s === STATUS.LOADING) {
            s = await this.waitReady();
        }
        return this.takeIn(opts || {});
    }

    // Удобно: снять с эфира.
    async airOff(opts) {
        return this.takeOut(opts || {});
    }
}

module.exports = { PlayoutClient, STATUS, STATUS_NAME };
