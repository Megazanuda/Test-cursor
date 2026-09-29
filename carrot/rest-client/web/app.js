'use strict';

/* Carrot playlist / event browser (front-end) */

const state = {
  connected: false,
  playlists: [],
  playlistId: null,
  playlistName: '',
  rows: [],          // flattened rows for table
  columns: [],       // [{key, label}]
  sortKey: 'name',
  sortDir: 1,
  filter: '',
  selectedEventId: null
};

const el = {
  statusLine: document.getElementById('statusLine'),
  connectPanel: document.getElementById('connectPanel'),
  connectForm: document.getElementById('connectForm'),
  connectBtn: document.getElementById('connectBtn'),
  baseUrl: document.getElementById('baseUrl'),
  login: document.getElementById('login'),
  password: document.getElementById('password'),
  workspace: document.getElementById('workspace'),
  playlistList: document.getElementById('playlistList'),
  playlistEmpty: document.getElementById('playlistEmpty'),
  reloadPlaylists: document.getElementById('reloadPlaylists'),
  eventsTitle: document.getElementById('eventsTitle'),
  eventsHint: document.getElementById('eventsHint'),
  filterInput: document.getElementById('filterInput'),
  deleteBtn: document.getElementById('deleteBtn'),
  eventsTable: document.getElementById('eventsTable'),
  eventsHead: document.getElementById('eventsHead'),
  eventsBody: document.getElementById('eventsBody'),
  eventsEmpty: document.getElementById('eventsEmpty'),
  detailPanel: document.getElementById('detailPanel'),
  detailTitle: document.getElementById('detailTitle'),
  detailList: document.getElementById('detailList'),
  toast: document.getElementById('toast'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmText: document.getElementById('confirmText')
};

let toastTimer = null;

function setStatus(text, kind) {
  el.statusLine.textContent = text;
  el.statusLine.classList.remove('ok', 'err');
  if (kind) el.statusLine.classList.add(kind);
}

function toast(message, kind) {
  el.toast.hidden = false;
  el.toast.textContent = message;
  el.toast.classList.remove('ok', 'err');
  if (kind) el.toast.classList.add(kind);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.toast.hidden = true; }, 4200);
}

async function api(method, path, body) {
  const opts = {
    method: method,
    headers: { 'Accept': 'application/json' }
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  var json = null;
  try { json = text ? JSON.parse(text) : null; }
  catch (e) {
    throw new Error('Ответ сервера не JSON (HTTP ' + res.status + ')');
  }
  if (!res.ok || (json && json.ok === false)) {
    throw new Error((json && json.error) || ('HTTP ' + res.status));
  }
  return json;
}

function preview(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  return String(value);
}

function pick(obj, keys) {
  if (!obj) return '';
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v != null && v !== '') return v;
  }
  return '';
}

function formatChanged(value) {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function flattenRow(entry) {
  const event = entry.event || {};
  const item = entry.item || {};
  const template = event.template || item.template || {};

  return {
    name: pick(event, ['name']) || pick(item, ['eventName', 'name']),
    templateName: pick(event, ['templateName']) ||
      pick(template, ['name']) ||
      pick(item, ['templateName']),
    changed: formatChanged(pick(event, ['changed', 'modified', 'updated', 'changeDate'])),
    changedRaw: pick(event, ['changed', 'modified', 'updated', 'changeDate']),
    id: pick(event, ['id']) || pick(item, ['eventId']),
    externalId: pick(event, ['externalId']) || pick(item, ['externalId', 'eventExternalId']),
    _event: event,
    _item: item,
    _fetchError: event._fetchError || ''
  };
}

const COLUMNS = [
  { key: 'name', label: 'Event name', cls: 'col-name' },
  { key: 'templateName', label: 'Template name', cls: 'col-template' },
  { key: 'changed', label: 'Last modified', cls: 'col-changed' },
  { key: 'id', label: 'Id', cls: 'col-id' },
  { key: 'externalId', label: 'External id', cls: 'col-ext' }
];

function collectColumns() {
  return COLUMNS.slice();
}

function compareValues(a, b) {
  const aEmpty = a === '' || a == null;
  const bEmpty = b === '' || b == null;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const an = Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && String(a).trim() !== '' && String(b).trim() !== '') {
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  }

  const as = String(a).toLowerCase();
  const bs = String(b).toLowerCase();
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

function sortedFilteredRows() {
  var list = state.rows.slice();
  const q = state.filter.trim().toLowerCase();
  if (q) {
    list = list.filter(function (r) {
      return state.columns.some(function (c) {
        return preview(r[c.key]).toLowerCase().indexOf(q) !== -1;
      });
    });
  }
  // Для даты сортируем по сырому значению, а не по отформатированной строке.
  const key = state.sortKey === 'changed' ? 'changedRaw' : state.sortKey;
  const dir = state.sortDir;
  list.sort(function (a, b) {
    const cmp = compareValues(a[key], b[key]);
    if (cmp !== 0) return cmp * dir;
    return compareValues(a.name, b.name) * dir;
  });
  return list;
}

function renderPlaylists() {
  el.playlistList.innerHTML = '';
  if (!state.playlists.length) {
    el.playlistEmpty.hidden = false;
    return;
  }
  el.playlistEmpty.hidden = true;
  state.playlists.forEach(function (pl) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    if (pl.id === state.playlistId) btn.classList.add('active');
    btn.innerHTML =
      '<span class="pl-name"></span><span class="pl-id"></span>';
    btn.querySelector('.pl-name').textContent = pl.name || '(без имени)';
    btn.querySelector('.pl-id').textContent = pl.id || '';
    btn.addEventListener('click', function () { selectPlaylist(pl); });
    li.appendChild(btn);
    el.playlistList.appendChild(li);
  });
}

function renderTable() {
  const rows = sortedFilteredRows();
  el.eventsTable.hidden = !(state.playlistId && state.rows.length);
  el.eventsEmpty.hidden = !el.eventsTable.hidden;

  if (!state.playlistId) {
    el.eventsEmpty.textContent = 'Сначала выбери плейлист';
    el.detailPanel.hidden = true;
    el.deleteBtn.disabled = true;
    el.filterInput.disabled = true;
    return;
  }

  el.filterInput.disabled = false;

  if (!state.rows.length) {
    el.eventsEmpty.textContent = 'В этом плейлисте нет событий';
    el.detailPanel.hidden = true;
    el.deleteBtn.disabled = true;
    return;
  }

  if (!rows.length) {
    el.eventsTable.hidden = true;
    el.eventsEmpty.hidden = false;
    el.eventsEmpty.textContent = 'Ничего не найдено по фильтру';
    el.deleteBtn.disabled = !state.selectedEventId;
    return;
  }

  const head = document.createElement('tr');
  state.columns.forEach(function (c) {
    const th = document.createElement('th');
    th.dataset.key = c.key;
    if (c.cls) th.className = c.cls;
    th.textContent = c.label;
    if (c.key === state.sortKey) {
      const ind = document.createElement('span');
      ind.className = 'sort-ind';
      ind.textContent = state.sortDir > 0 ? '▲' : '▼';
      th.appendChild(ind);
    }
    th.addEventListener('click', function () {
      if (state.sortKey === c.key) state.sortDir = -state.sortDir;
      else { state.sortKey = c.key; state.sortDir = 1; }
      renderTable();
    });
    head.appendChild(th);
  });
  el.eventsHead.innerHTML = '';
  el.eventsHead.appendChild(head);

  el.eventsBody.innerHTML = '';
  rows.forEach(function (r) {
    const tr = document.createElement('tr');
    if (r.id === state.selectedEventId) tr.classList.add('selected');
    state.columns.forEach(function (c) {
      const td = document.createElement('td');
      const classes = [];
      if (c.key === 'name') classes.push('cell-name');
      if (c.cls) classes.push(c.cls);
      if (classes.length) td.className = classes.join(' ');
      const text = preview(r[c.key]).replace(/\s+/g, ' ');
      td.textContent = text;
      td.title = text;
      tr.appendChild(td);
    });
    tr.addEventListener('click', function () { selectEvent(r.id); });
    el.eventsBody.appendChild(tr);
  });

  el.deleteBtn.disabled = !state.selectedEventId;
  if (state.selectedEventId) {
    const sel = state.rows.find(function (r) { return r.id === state.selectedEventId; });
    if (sel) renderDetail(sel);
    else {
      el.detailPanel.hidden = true;
      state.selectedEventId = null;
      el.deleteBtn.disabled = true;
    }
  }
}

function renderDetail(row) {
  el.detailPanel.hidden = false;
  el.detailTitle.textContent = row.name || row.id || 'Событие';
  el.detailList.innerHTML = '';

  function add(term, value) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = preview(value);
    el.detailList.appendChild(dt);
    el.detailList.appendChild(dd);
  }

  COLUMNS.forEach(function (c) {
    add(c.label, row[c.key]);
  });
  if (row._fetchError) add('ошибка', row._fetchError);
}

async function selectPlaylist(pl) {
  state.playlistId = pl.id;
  state.playlistName = pl.name || pl.id;
  state.selectedEventId = null;
  state.rows = [];
  state.columns = [];
  renderPlaylists();
  el.eventsTitle.textContent = state.playlistName;
  el.eventsHint.textContent = 'Загрузка событий…';
  el.deleteBtn.disabled = true;
  el.detailPanel.hidden = true;
  renderTable();

  try {
    const data = await api('GET', '/api/playlists/' + encodeURIComponent(pl.id) + '/events');
    const flat = (data.events || []).map(flattenRow);
    state.rows = flat;
    state.columns = collectColumns();
    if (!state.columns.some(function (c) { return c.key === state.sortKey; })) {
      state.sortKey = 'name';
      state.sortDir = 1;
    }
    el.eventsHint.textContent = flat.length + ' событ' + plural(flat.length);
    setStatus('плейлист: ' + state.playlistName + ' · ' + flat.length + ' событий', 'ok');
    renderTable();
  } catch (err) {
    el.eventsHint.textContent = 'Ошибка загрузки';
    toast(err.message, 'err');
    setStatus(err.message, 'err');
  }
}

function plural(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ие';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'ия';
  return 'ий';
}

function selectEvent(eventId) {
  state.selectedEventId = eventId;
  renderTable();
}

async function loadPlaylists() {
  const data = await api('GET', '/api/playlists');
  state.playlists = data.playlists || [];
  renderPlaylists();
  setStatus('плейлистов: ' + state.playlists.length, 'ok');
}

async function connect(creds) {
  el.connectBtn.disabled = true;
  setStatus('подключение…');
  try {
    const data = await api('POST', '/api/connect', creds);
    state.connected = true;
    el.connectPanel.hidden = true;
    el.workspace.hidden = false;
    setStatus('онлайн · ' + data.baseUrl, 'ok');
    toast('Подключено к ' + data.baseUrl, 'ok');
    await loadPlaylists();
  } catch (err) {
    setStatus(err.message, 'err');
    toast(err.message, 'err');
    throw err;
  } finally {
    el.connectBtn.disabled = false;
  }
}

async function deleteSelected() {
  const id = state.selectedEventId;
  if (!id) return;
  const row = state.rows.find(function (r) { return r.id === id; });
  const label = (row && row.name) ? row.name : id;
  el.confirmText.textContent = '«' + label + '» (' + id + ') будет удалено на сервере Carrot. Это необратимо.';
  el.confirmDialog.showModal();
  const result = await new Promise(function (resolve) {
    el.confirmDialog.addEventListener('close', function onClose() {
      el.confirmDialog.removeEventListener('close', onClose);
      resolve(el.confirmDialog.returnValue);
    });
  });
  if (result !== 'ok') return;

  try {
    await api('DELETE', '/api/events/' + encodeURIComponent(id));
    toast('Удалено: ' + label, 'ok');
    state.selectedEventId = null;
    if (state.playlistId) {
      const pl = state.playlists.find(function (p) { return p.id === state.playlistId; });
      if (pl) await selectPlaylist(pl);
      else await loadPlaylists();
    }
  } catch (err) {
    toast(err.message, 'err');
    setStatus(err.message, 'err');
  }
}

el.connectForm.addEventListener('submit', function (e) {
  e.preventDefault();
  const creds = {
    baseUrl: el.baseUrl.value.trim() || undefined,
    login: el.login.value.trim() || undefined,
    password: el.password.value || undefined
  };
  connect(creds).catch(function () { /* toast already shown */ });
});

el.reloadPlaylists.addEventListener('click', function () {
  loadPlaylists().catch(function (err) { toast(err.message, 'err'); });
});

el.filterInput.addEventListener('input', function () {
  state.filter = el.filterInput.value;
  renderTable();
});

el.deleteBtn.addEventListener('click', function () {
  deleteSelected();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Delete' && state.selectedEventId && !el.confirmDialog.open) {
    e.preventDefault();
    deleteSelected();
  }
});

(async function boot() {
  try {
    const health = await api('GET', '/api/health');
    if (health.defaults) {
      if (health.defaults.baseUrl) el.baseUrl.value = health.defaults.baseUrl;
      if (health.defaults.login) el.login.value = health.defaults.login;
    }
    if (health.hasEnv) {
      // Автоподключение из .env — форма остаётся на случай смены сервера.
      await connect({});
    } else {
      setStatus('заполни .env или форму подключения');
    }
  } catch (err) {
    setStatus(err.message, 'err');
  }
})();
