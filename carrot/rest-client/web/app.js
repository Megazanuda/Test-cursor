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

function flattenRow(entry) {
  const event = entry.event || {};
  const item = entry.item || {};
  const story = entry.story || {};
  const row = {
    id: event.id || item.eventId || '',
    name: event.name || item.eventName || '',
    externalId: event.externalId != null ? event.externalId : '',
    changed: event.changed != null ? event.changed : '',
    allowRuntimeChange: event.allowRuntimeChange != null ? event.allowRuntimeChange : '',
    templateId: event.templateId != null ? event.templateId : '',
    templateName: event.templateName != null ? event.templateName : '',
    storyName: story.name || '',
    storyId: story.id || '',
    itemId: item.id || '',
    itemStatus: item.status != null ? item.status : '',
    itemName: item.name || '',
    _event: event,
    _item: item,
    _story: story,
    _fetchError: event._fetchError || ''
  };

  // Прочие скалярные поля события, которых нет в базовом наборе.
  Object.keys(event).forEach(function (k) {
    if (k === 'variables' || k === '_fetchError' || k.charAt(0) === '_') return;
    if (row[k] !== undefined) return;
    const v = event[k];
    if (v == null || typeof v === 'object') return;
    row[k] = v;
  });

  (event.variables || []).forEach(function (v) {
    if (!v || !v.name) return;
    row['var:' + v.name] = v.value != null ? v.value : '';
    row['varType:' + v.name] = v.type != null ? v.type : '';
  });

  return row;
}

function collectColumns(rows) {
  const base = [
    { key: 'name', label: 'name' },
    { key: 'id', label: 'id' },
    { key: 'allowRuntimeChange', label: 'allowRuntimeChange' },
    { key: 'externalId', label: 'externalId' },
    { key: 'changed', label: 'changed' },
    { key: 'templateName', label: 'templateName' },
    { key: 'templateId', label: 'templateId' },
    { key: 'storyName', label: 'story' },
    { key: 'itemId', label: 'itemId' },
    { key: 'itemStatus', label: 'itemStatus' }
  ];

  const seen = Object.create(null);
  base.forEach(function (c) { seen[c.key] = true; });
  const extras = [];

  rows.forEach(function (r) {
    Object.keys(r).forEach(function (k) {
      if (seen[k] || k.charAt(0) === '_') return;
      if (typeof r[k] === 'object') return;
      seen[k] = true;
      extras.push({
        key: k,
        label: k.indexOf('var:') === 0 ? k.slice(4) : k
      });
    });
  });

  extras.sort(function (a, b) {
    const av = a.key.indexOf('var:') === 0 ? 1 : 0;
    const bv = b.key.indexOf('var:') === 0 ? 1 : 0;
    if (av !== bv) return av - bv;
    return a.label.localeCompare(b.label, 'ru');
  });

  // Убираем пустые колонки (кроме name/id).
  const used = base.concat(extras).filter(function (c) {
    if (c.key === 'name' || c.key === 'id') return true;
    return rows.some(function (r) {
      const v = r[c.key];
      return v !== '' && v != null && v !== undefined;
    });
  });
  return used;
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
  const key = state.sortKey;
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
      if (c.key === 'name') td.className = 'cell-name';
      td.textContent = preview(r[c.key]);
      td.title = preview(r[c.key]);
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

  state.columns.forEach(function (c) {
    if (c.key.indexOf('var:') === 0 || c.key.indexOf('varType:') === 0) return;
    if (row[c.key] === '' || row[c.key] == null) return;
    add(c.label, row[c.key]);
  });

  const vars = (row._event && row._event.variables) || [];
  vars.forEach(function (v) {
    add((v.name || '?') + ' (' + (v.type || '?') + ')', v.value);
  });
  if (row._fetchError) add('ошибка загрузки', row._fetchError);
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
    state.columns = collectColumns(flat);
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
