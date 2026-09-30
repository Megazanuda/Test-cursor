'use strict';

/* Carrot playlist / event browser (front-end) */

const COLUMNS = [
  { key: 'name', label: 'Event name', cls: 'col-name' },
  { key: 'templateName', label: 'Template name', cls: 'col-template' },
  { key: 'changed', label: 'Last modified', cls: 'col-changed' },
  { key: 'id', label: 'Id', cls: 'col-id' },
  { key: 'externalId', label: 'External id', cls: 'col-ext' }
];

const HIDDEN_COLS_KEY = 'carrot-web-hidden-columns';

function loadHiddenColumns() {
  try {
    const raw = localStorage.getItem(HIDDEN_COLS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

const state = {
  connected: false,
  playlists: [],
  view: null,
  playlistId: null,
  playlistName: '',
  rows: [],
  sortKey: 'name',
  sortDir: 1,
  filter: '',
  selectedIds: [],
  anchorId: null,
  allEventsCache: null,
  allEventsLoading: false,
  hiddenColumns: loadHiddenColumns(),
  // Кэш полных событий (с variables) для редактора
  eventDetails: Object.create(null),
  editorLoadToken: 0,
  varFilter: ''
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
  colsMenuBody: document.getElementById('colsMenuBody'),
  editorPanel: document.getElementById('editorPanel'),
  editorTitle: document.getElementById('editorTitle'),
  editorSub: document.getElementById('editorSub'),
  editorTabs: document.getElementById('editorTabs'),
  editorBody: document.getElementById('editorBody'),
  editorCollapseAll: document.getElementById('editorCollapseAll'),
  varFilter: document.getElementById('varFilter'),
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

function visibleColumns() {
  const vis = COLUMNS.filter(function (c) { return !state.hiddenColumns[c.key]; });
  return vis.length ? vis : COLUMNS.slice(0, 1);
}

function saveHiddenColumns() {
  try {
    localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(state.hiddenColumns));
  } catch (e) { /* ignore */ }
}

function renderColsMenu() {
  el.colsMenuBody.innerHTML = '';
  COLUMNS.forEach(function (c) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !state.hiddenColumns[c.key];
    cb.addEventListener('change', function () {
      if (cb.checked) delete state.hiddenColumns[c.key];
      else {
        // Нельзя спрятать все колонки.
        const left = COLUMNS.filter(function (x) {
          return x.key !== c.key && !state.hiddenColumns[x.key];
        });
        if (!left.length) {
          cb.checked = true;
          toast('Нужна хотя бы одна колонка', 'err');
          return;
        }
        state.hiddenColumns[c.key] = true;
      }
      saveHiddenColumns();
      renderTable();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + c.label));
    el.colsMenuBody.appendChild(label);
  });
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
      return COLUMNS.some(function (c) {
        return preview(r[c.key]).toLowerCase().indexOf(q) !== -1;
      });
    });
  }
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

  const allLi = document.createElement('li');
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  if (state.view === 'all') allBtn.classList.add('active');
  allBtn.innerHTML =
    '<span class="pl-name">Все события</span>' +
    '<span class="pl-id">вся база</span>';
  allBtn.addEventListener('click', function () { selectAllEvents(); });
  allLi.appendChild(allBtn);
  el.playlistList.appendChild(allLi);

  if (!state.playlists.length) {
    el.playlistEmpty.hidden = false;
    return;
  }
  el.playlistEmpty.hidden = true;
  state.playlists.forEach(function (pl) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    if (state.view === 'playlist' && pl.id === state.playlistId) {
      btn.classList.add('active');
    }
    btn.innerHTML =
      '<span class="pl-name"></span><span class="pl-id"></span>';
    btn.querySelector('.pl-name').textContent = pl.name || '(без имени)';
    btn.querySelector('.pl-id').textContent = pl.id || '';
    btn.addEventListener('click', function () { selectPlaylist(pl); });
    li.appendChild(btn);
    el.playlistList.appendChild(li);
  });
}

function hasView() {
  return state.view === 'all' || state.view === 'playlist';
}

function clearSelection() {
  state.selectedIds = [];
  state.anchorId = null;
}

function selectedCount() {
  return state.selectedIds.length;
}

function isSelected(id) {
  return state.selectedIds.indexOf(id) !== -1;
}

function setSelection(ids, anchorId) {
  const uniq = [];
  const seen = Object.create(null);
  (ids || []).forEach(function (id) {
    if (!id || seen[id]) return;
    seen[id] = true;
    uniq.push(id);
  });
  state.selectedIds = uniq;
  state.anchorId = anchorId != null ? anchorId : (uniq.length ? uniq[uniq.length - 1] : null);
}

function unwrapEvent(raw) {
  if (!raw) return raw;
  if (raw.event && !raw.id) {
    const event = Object.assign({}, raw.event);
    if (raw.template && raw.template.name && !event.templateName) {
      event.templateName = raw.template.name;
    }
    return event;
  }
  return raw;
}

async function loadEventDetail(eventId) {
  if (state.eventDetails[eventId] && state.eventDetails[eventId].variables) {
    return state.eventDetails[eventId];
  }
  const data = await api('GET', '/api/events/' + encodeURIComponent(eventId));
  const event = unwrapEvent(data.event);
  state.eventDetails[eventId] = event;
  return event;
}

function matchesVarFilter(v) {
  const q = state.varFilter.trim().toLowerCase();
  if (!q) return true;
  return String(v.name || '').toLowerCase().indexOf(q) !== -1 ||
    String(v.value == null ? '' : v.value).toLowerCase().indexOf(q) !== -1 ||
    String(v.type || '').toLowerCase().indexOf(q) !== -1;
}

function buildVarEditor(eventId, variables, opts) {
  opts = opts || {};
  const wrap = document.createElement('div');
  wrap.className = opts.bare ? 'var-editor' : 'event-card-body var-editor';

  const all = variables || [];
  const filtered = all.filter(matchesVarFilter);
  if (!all.length) {
    const p = document.createElement('p');
    p.className = 'editor-empty';
    p.textContent = 'У события нет переменных';
    wrap.appendChild(p);
    return wrap;
  }

  if (state.varFilter && !filtered.length) {
    const p = document.createElement('p');
    p.className = 'editor-empty';
    p.textContent = 'Нет переменных по фильтру';
    wrap.appendChild(p);
    return wrap;
  }

  const many = all.length > 10;
  if (many || state.varFilter) {
    const hint = document.createElement('p');
    hint.className = 'var-count-hint';
    hint.textContent = 'Показано ' + filtered.length + ' из ' + all.length +
      (state.varFilter ? '' : ' — сузь список фильтром сверху');
    wrap.appendChild(hint);
  }

  const grid = document.createElement('div');
  grid.className = 'var-grid' + (many ? ' var-grid-compact' : '');
  const inputs = [];

  filtered.forEach(function (v) {
    const row = document.createElement('div');
    row.className = 'var-row';

    const lab = document.createElement('label');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'var-name';
    nameSpan.textContent = v.name || '(без имени)';
    lab.appendChild(nameSpan);
    if (v.type && v.type !== 'Text') {
      const type = document.createElement('span');
      type.className = 'var-type';
      type.textContent = v.type;
      lab.appendChild(type);
    }

    const val = v.value == null ? '' : String(v.value);
    const useArea = val.indexOf('\n') !== -1 || val.length > 80;
    const input = useArea
      ? document.createElement('textarea')
      : document.createElement('input');
    if (!useArea) input.type = 'text';
    if (useArea) input.rows = Math.min(6, Math.max(2, val.split('\n').length));
    input.value = val;
    input.dataset.varName = v.name || '';
    input.setAttribute('aria-label', v.name || 'variable');
    inputs.push(input);

    row.appendChild(lab);
    row.appendChild(input);
    grid.appendChild(row);
  });

  wrap.appendChild(grid);

  const actions = document.createElement('div');
  actions.className = 'var-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn primary sm';
  saveBtn.textContent = 'Сохранить переменные';
  saveBtn.addEventListener('click', async function () {
    const byName = Object.create(null);
    all.forEach(function (v) {
      byName[v.name] = v.value == null ? '' : String(v.value);
    });
    inputs.forEach(function (inp) {
      byName[inp.dataset.varName] = inp.value;
    });
    const full = Object.keys(byName).map(function (name) {
      return { name: name, value: byName[name] };
    });

    saveBtn.disabled = true;
    try {
      await api('PATCH', '/api/events/' + encodeURIComponent(eventId) + '/variables', full);
      if (state.eventDetails[eventId]) {
        state.eventDetails[eventId].variables = full.map(function (p) {
          const prev = all.find(function (v) { return v.name === p.name; });
          return {
            name: p.name,
            value: p.value,
            type: prev ? prev.type : undefined,
            lengthLimit: prev ? prev.lengthLimit : undefined
          };
        });
      }
      toast('Переменные сохранены', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      saveBtn.disabled = false;
    }
  });
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);
  return wrap;
}

function setEditorChrome(n, loading) {
  el.deleteBtn.disabled = n === 0;
  el.deleteBtn.textContent = n > 1 ? ('Удалить (' + n + ')') : 'Удалить';

  if (n === 0) {
    el.editorPanel.hidden = true;
    el.varFilter.hidden = true;
    el.editorCollapseAll.hidden = true;
    el.editorTabs.hidden = true;
    el.editorTabs.innerHTML = '';
    el.editorSub.hidden = true;
    el.editorSub.textContent = '';
    el.editorBody.innerHTML = '';
    return false;
  }

  el.editorPanel.hidden = false;
  el.varFilter.hidden = false;
  el.editorTitle.textContent = 'Переменные';
  if (n === 1) {
    el.editorSub.hidden = true;
    el.editorSub.textContent = '';
    el.editorCollapseAll.hidden = true;
    el.editorTabs.hidden = true;
    el.editorTabs.innerHTML = '';
  } else {
    el.editorSub.hidden = false;
    el.editorSub.textContent = loading
      ? ('Загрузка · выбрано ' + n)
      : ('Выбрано событий: ' + n + ' — переключайся вкладками или раскрой нужные');
    el.editorCollapseAll.hidden = false;
  }
  return true;
}

function paintEditorItems(loaded) {
  el.editorBody.innerHTML = '';
  el.editorTabs.innerHTML = '';

  if (loaded.length === 1) {
    const item = loaded[0];
    el.editorTabs.hidden = true;
    if (item.error) {
      el.editorBody.innerHTML = '<p class="editor-empty">' + escapeHtml(item.error) + '</p>';
      return;
    }
    const vars = (item.event && item.event.variables) || [];
    el.editorBody.appendChild(buildVarEditor(item.id, vars, { bare: true }));
    return;
  }

  // Несколько событий: вкладки + аккордеон (без id/template — они уже в таблице).
  el.editorTabs.hidden = false;
  const collapseByDefault = true;

  loaded.forEach(function (item, idx) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'editor-tab' + (idx === 0 ? ' active' : '');
    tab.textContent = item.name || ('Событие ' + (idx + 1));
    tab.title = item.name || '';
    tab.addEventListener('click', function () {
      let card = null;
      el.editorBody.querySelectorAll('details.event-card').forEach(function (d) {
        if (d.dataset.eventId === item.id) card = d;
        d.open = d.dataset.eventId === item.id;
      });
      el.editorTabs.querySelectorAll('.editor-tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    el.editorTabs.appendChild(tab);

    const card = document.createElement('details');
    card.className = 'event-card';
    card.dataset.eventId = item.id;
    card.open = !collapseByDefault || idx === 0;

    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.className = 'ev-title';
    title.textContent = item.name || item.id;
    const meta = document.createElement('span');
    meta.className = 'ev-meta';
    meta.textContent = (item.event && item.event.variables)
      ? (item.event.variables.length + ' пер.')
      : (item.error ? 'ошибка' : '…');
    summary.appendChild(title);
    summary.appendChild(meta);
    card.appendChild(summary);

    if (item.error) {
      const body = document.createElement('div');
      body.className = 'event-card-body';
      const p = document.createElement('p');
      p.className = 'editor-empty';
      p.textContent = item.error;
      body.appendChild(p);
      card.appendChild(body);
    } else {
      const vars = (item.event && item.event.variables) || [];
      card.appendChild(buildVarEditor(item.id, vars));
    }

    if (loaded.length > 3) {
      card.addEventListener('toggle', function () {
        if (!card.open) return;
        el.editorBody.querySelectorAll('details.event-card').forEach(function (d) {
          if (d !== card) d.open = false;
        });
        el.editorTabs.querySelectorAll('.editor-tab').forEach(function (t, i) {
          t.classList.toggle('active', loaded[i] && loaded[i].id === item.id);
        });
      });
    }

    el.editorBody.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderEditor() {
  const n = selectedCount();
  if (!setEditorChrome(n, true)) return;

  const token = ++state.editorLoadToken;
  el.editorBody.innerHTML = '<p class="editor-loading">Загрузка переменных…</p>';
  el.editorTabs.hidden = true;
  el.editorTabs.innerHTML = '';

  const ids = state.selectedIds.slice();
  const loaded = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const row = state.rows.find(function (r) { return r.id === id; });
    try {
      const ev = await loadEventDetail(id);
      loaded.push({ id: id, name: (ev && ev.name) || (row && row.name) || id, event: ev });
    } catch (err) {
      loaded.push({
        id: id,
        name: (row && row.name) || id,
        error: err.message
      });
    }
    if (token !== state.editorLoadToken) return;
  }

  if (token !== state.editorLoadToken) return;
  setEditorChrome(n, false);
  paintEditorItems(loaded);
}

function updateSelectionUi() {
  renderEditor();
}

function applyEventRows(flat, title, statusText, opts) {
  opts = opts || {};
  state.rows = flat;
  if (!opts.keepSelection) clearSelection();
  if (!COLUMNS.some(function (c) { return c.key === state.sortKey; })) {
    state.sortKey = 'name';
    state.sortDir = 1;
  }
  el.eventsTitle.textContent = title;
  el.eventsHint.textContent = flat.length + ' событ' + plural(flat.length);
  setStatus(statusText, 'ok');
  renderTable();
}

function renderTable() {
  const cols = visibleColumns();
  const rows = sortedFilteredRows();
  el.eventsTable.hidden = !(hasView() && state.rows.length);
  el.eventsEmpty.hidden = !el.eventsTable.hidden;

  if (!hasView()) {
    el.eventsEmpty.textContent = 'Выбери «Все события» или плейлист слева';
    setEditorChrome(0);
    el.filterInput.disabled = true;
    return;
  }

  el.filterInput.disabled = false;

  const existing = Object.create(null);
  state.rows.forEach(function (r) { if (r.id) existing[r.id] = true; });
  state.selectedIds = state.selectedIds.filter(function (id) { return existing[id]; });
  if (state.anchorId && !existing[state.anchorId]) state.anchorId = null;

  if (!state.rows.length) {
    el.eventsEmpty.textContent = state.view === 'all'
      ? 'Событий в базе нет'
      : 'В этом плейлисте нет событий';
    el.editorPanel.hidden = true;
    el.deleteBtn.disabled = true;
    el.deleteBtn.textContent = 'Удалить';
    return;
  }

  if (!rows.length) {
    el.eventsTable.hidden = true;
    el.eventsEmpty.hidden = false;
    el.eventsEmpty.textContent = 'Ничего не найдено по фильтру';
    updateSelectionUi();
    return;
  }

  const head = document.createElement('tr');
  cols.forEach(function (c) {
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
    if (isSelected(r.id)) tr.classList.add('selected');
    cols.forEach(function (c) {
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
    tr.addEventListener('click', function (ev) { selectEvent(r.id, ev); });
    el.eventsBody.appendChild(tr);
  });

  updateSelectionUi();
}

async function fetchAllEvents(force) {
  const q = force ? '?force=1' : '';
  const data = await api('GET', '/api/events' + q);
  const flat = (data.events || []).map(flattenRow);
  state.allEventsCache = flat;
  return flat;
}

async function selectAllEvents(opts) {
  opts = opts || {};
  const force = !!opts.force;
  state.view = 'all';
  state.playlistId = null;
  state.playlistName = '';
  clearSelection();
  renderPlaylists();
  el.eventsTitle.textContent = 'Все события';
  el.deleteBtn.disabled = true;
  el.deleteBtn.textContent = 'Удалить';
  el.editorPanel.hidden = true;

  if (!force && state.allEventsCache) {
    applyEventRows(
      state.allEventsCache,
      'Все события',
      'все события · ' + state.allEventsCache.length + ' (кэш)'
    );
    if (!state.allEventsLoading) {
      state.allEventsLoading = true;
      fetchAllEvents(false)
        .then(function (flat) {
          if (state.view !== 'all') return;
          applyEventRows(flat, 'Все события', 'все события · ' + flat.length);
        })
        .catch(function () { /* оставляем кэш */ })
        .finally(function () { state.allEventsLoading = false; });
    }
    return;
  }

  state.rows = [];
  el.eventsHint.textContent = 'Загрузка…';
  renderTable();

  try {
    state.allEventsLoading = true;
    const flat = await fetchAllEvents(force);
    applyEventRows(flat, 'Все события', 'все события · ' + flat.length);
  } catch (err) {
    el.eventsHint.textContent = 'Ошибка загрузки';
    toast(err.message, 'err');
    setStatus(err.message, 'err');
  } finally {
    state.allEventsLoading = false;
  }
}

async function selectPlaylist(pl) {
  state.view = 'playlist';
  state.playlistId = pl.id;
  state.playlistName = pl.name || pl.id;
  clearSelection();
  state.rows = [];
  renderPlaylists();
  el.eventsTitle.textContent = state.playlistName;
  el.eventsHint.textContent = 'Загрузка событий…';
  el.deleteBtn.disabled = true;
  el.deleteBtn.textContent = 'Удалить';
  el.editorPanel.hidden = true;
  renderTable();

  try {
    const data = await api('GET', '/api/playlists/' + encodeURIComponent(pl.id) + '/events');
    const flat = (data.events || []).map(flattenRow);
    applyEventRows(
      flat,
      state.playlistName,
      'плейлист: ' + state.playlistName + ' · ' + flat.length + ' событий'
    );
  } catch (err) {
    el.eventsHint.textContent = 'Ошибка загрузки';
    toast(err.message, 'err');
    setStatus(err.message, 'err');
  }
}

async function reloadCurrentView(opts) {
  opts = opts || {};
  if (state.view === 'all') {
    await selectAllEvents({ force: !!opts.force });
    return;
  }
  if (state.view === 'playlist' && state.playlistId) {
    const pl = state.playlists.find(function (p) { return p.id === state.playlistId; }) ||
      { id: state.playlistId, name: state.playlistName };
    await selectPlaylist(pl);
    return;
  }
  await loadPlaylists();
}

function removeRowsByIds(ids) {
  const drop = Object.create(null);
  (ids || []).forEach(function (id) {
    drop[id] = true;
    delete state.eventDetails[id];
  });
  state.rows = state.rows.filter(function (r) { return !drop[r.id]; });
  if (state.allEventsCache) {
    state.allEventsCache = state.allEventsCache.filter(function (r) {
      return !drop[r.id];
    });
  }
}

function plural(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ие';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'ия';
  return 'ий';
}

function selectEvent(eventId, ev) {
  ev = ev || {};
  const rows = sortedFilteredRows();
  const ids = rows.map(function (r) { return r.id; });
  const shift = !!ev.shiftKey;
  const toggle = !!(ev.ctrlKey || ev.metaKey);

  if (shift && state.anchorId && ids.indexOf(state.anchorId) !== -1 &&
      ids.indexOf(eventId) !== -1) {
    const a = ids.indexOf(state.anchorId);
    const b = ids.indexOf(eventId);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const range = ids.slice(from, to + 1);
    if (toggle) {
      const merged = state.selectedIds.slice();
      range.forEach(function (id) {
        if (merged.indexOf(id) === -1) merged.push(id);
      });
      setSelection(merged, state.anchorId);
    } else {
      setSelection(range, state.anchorId);
    }
  } else if (toggle) {
    const next = state.selectedIds.slice();
    const idx = next.indexOf(eventId);
    if (idx === -1) next.push(eventId);
    else next.splice(idx, 1);
    setSelection(next, eventId);
  } else {
    setSelection([eventId], eventId);
  }

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
    await selectAllEvents();
  } catch (err) {
    setStatus(err.message, 'err');
    toast(err.message, 'err');
    throw err;
  } finally {
    el.connectBtn.disabled = false;
  }
}

async function deleteSelected() {
  const ids = state.selectedIds.slice();
  if (!ids.length) return;

  if (ids.length === 1) {
    const row = state.rows.find(function (r) { return r.id === ids[0]; });
    const label = (row && row.name) ? row.name : ids[0];
    el.confirmText.textContent =
      '«' + label + '» (' + ids[0] + ') будет удалено на сервере Carrot. Это необратимо.';
  } else {
    el.confirmText.textContent =
      'Будет удалено событий: ' + ids.length + '. Это необратимо.';
  }

  el.confirmDialog.showModal();
  const result = await new Promise(function (resolve) {
    el.confirmDialog.addEventListener('close', function onClose() {
      el.confirmDialog.removeEventListener('close', onClose);
      resolve(el.confirmDialog.returnValue);
    });
  });
  if (result !== 'ok') return;

  el.deleteBtn.disabled = true;
  try {
    const data = await api('POST', '/api/events/delete', { ids: ids });
    const deleted = (data && data.deleted) ? data.deleted : [];
    const failed = (data && data.failed) ? data.failed : [];
    if (failed.length && deleted.length) {
      toast('Удалено: ' + deleted.length + ', ошибок: ' + failed.length, 'err');
    } else if (failed.length) {
      const first = failed[0];
      toast('Не удалено: ' + (first.error || failed.length + ' ошибок'), 'err');
    } else {
      toast('Удалено: ' + deleted.length, 'ok');
    }
    if (deleted.length) removeRowsByIds(deleted);
    clearSelection();
    if (state.view === 'all') {
      applyEventRows(state.rows, 'Все события', 'все события · ' + state.rows.length);
    } else if (state.view === 'playlist') {
      applyEventRows(
        state.rows,
        state.playlistName,
        'плейлист: ' + state.playlistName + ' · ' + state.rows.length + ' событий'
      );
    } else {
      renderTable();
    }
  } catch (err) {
    toast(err.message, 'err');
    setStatus(err.message, 'err');
    updateSelectionUi();
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
  loadPlaylists()
    .then(function () { return reloadCurrentView({ force: true }); })
    .catch(function (err) { toast(err.message, 'err'); });
});

el.filterInput.addEventListener('input', function () {
  state.filter = el.filterInput.value;
  renderTable();
});

el.varFilter.addEventListener('input', function () {
  state.varFilter = el.varFilter.value;
  // Перерисовать редактор без повторной загрузки с сервера.
  if (selectedCount()) {
    state.editorLoadToken++;
    renderEditorFromCache();
  }
});

function renderEditorFromCache() {
  const n = selectedCount();
  if (!setEditorChrome(n, false)) return;
  const ids = state.selectedIds.slice();
  const loaded = ids.map(function (id) {
    const row = state.rows.find(function (r) { return r.id === id; });
    const ev = state.eventDetails[id];
    if (!ev) {
      return { id: id, name: (row && row.name) || id, error: 'Нет данных — выбери строку снова' };
    }
    return { id: id, name: ev.name || (row && row.name) || id, event: ev };
  });
  paintEditorItems(loaded);
}

el.editorCollapseAll.addEventListener('click', function () {
  el.editorBody.querySelectorAll('details.event-card').forEach(function (d) {
    d.open = false;
  });
  el.editorTabs.querySelectorAll('.editor-tab').forEach(function (t) {
    t.classList.remove('active');
  });
});

el.deleteBtn.addEventListener('click', function () {
  deleteSelected();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Delete' && selectedCount() && !el.confirmDialog.open &&
      document.activeElement &&
      document.activeElement.tagName !== 'INPUT' &&
      document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    deleteSelected();
  }
  if (e.key === 'Escape' && selectedCount() && !el.confirmDialog.open) {
    clearSelection();
    renderTable();
  }
});

renderColsMenu();

(async function boot() {
  try {
    const health = await api('GET', '/api/health');
    if (health.defaults) {
      if (health.defaults.baseUrl) el.baseUrl.value = health.defaults.baseUrl;
      if (health.defaults.login) el.login.value = health.defaults.login;
    }
    if (health.hasEnv) {
      await connect({});
    } else {
      setStatus('заполни .env или форму подключения');
    }
  } catch (err) {
    setStatus(err.message, 'err');
  }
})();
