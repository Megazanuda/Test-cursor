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
const EDITOR_FOLD_KEY = 'carrot-web-editor-folded';
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function loadHiddenColumns() {
  try {
    const raw = localStorage.getItem(HIDDEN_COLS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function loadEditorFolded() {
  try {
    return localStorage.getItem(EDITOR_FOLD_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function newCreateFormId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function blankCreateForm() {
  return {
    localId: newCreateFormId(),
    name: '',
    templateId: '',
    contentId: '',
    templateTypeInt: 1,
    state: 'IN',
    states: ['IN'],
    comment: '',
    variables: [],
    loadingTemplate: false
  };
}

const state = {
  connected: false,
  playlists: [],
  view: null,
  playlistId: null,
  playlistName: '',
  rows: [],
  sortKey: 'changed',
  sortDir: -1,
  filter: '',
  selectedIds: [],
  anchorId: null,
  allEventsCache: null,
  allEventsLoading: false,
  // 'recent' = last 2 weeks; 'all' = no date filter
  allEventsScope: 'recent',
  hiddenColumns: loadHiddenColumns(),
  eventDetails: Object.create(null),
  editorLoadToken: 0,
  varFilter: '',
  editorFolded: loadEditorFolded(),
  // Создание событий (оверлей поверх таблицы)
  createOpen: false,
  templates: [],
  templatesLoaded: false,
  templateDetails: Object.create(null),
  createForms: [blankCreateForm()],
  createSelectedIds: [],
  createAnchorId: null
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
  loadAllBtn: document.getElementById('loadAllBtn'),
  loadRecentBtn: document.getElementById('loadRecentBtn'),
  filterInput: document.getElementById('filterInput'),
  deleteBtn: document.getElementById('deleteBtn'),
  eventsTable: document.getElementById('eventsTable'),
  eventsHead: document.getElementById('eventsHead'),
  eventsBody: document.getElementById('eventsBody'),
  eventsEmpty: document.getElementById('eventsEmpty'),
  colsMenuBody: document.getElementById('colsMenuBody'),
  eventsPane: document.querySelector('.events-pane'),
  createPane: document.getElementById('createPane'),
  createOpenBtn: document.getElementById('createOpenBtn'),
  createCloseBtn: document.getElementById('createCloseBtn'),
  createHint: document.getElementById('createHint'),
  createList: document.getElementById('createList'),
  createAddBtn: document.getElementById('createAddBtn'),
  createRemoveBtn: document.getElementById('createRemoveBtn'),
  createSubmitBtn: document.getElementById('createSubmitBtn'),
  editorPanel: document.getElementById('editorPanel'),
  editorTitle: document.getElementById('editorTitle'),
  editorSub: document.getElementById('editorSub'),
  editorTabs: document.getElementById('editorTabs'),
  editorBody: document.getElementById('editorBody'),
  editorContent: document.getElementById('editorContent'),
  editorFoldBtn: document.getElementById('editorFoldBtn'),
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

function isRecentRow(row) {
  if (!row || row.changedRaw == null || row.changedRaw === '') return false;
  const t = new Date(row.changedRaw).getTime();
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) <= TWO_WEEKS_MS;
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
    const row = document.createElement('label');
    row.className = 'cols-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !state.hiddenColumns[c.key];

    const text = document.createElement('span');
    text.className = 'cols-label';
    text.textContent = c.label;

    cb.addEventListener('change', function () {
      if (cb.checked) {
        delete state.hiddenColumns[c.key];
      } else {
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

    row.appendChild(cb);
    row.appendChild(text);
    el.colsMenuBody.appendChild(row);
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

function scopedRows() {
  var list = state.rows.slice();
  if (state.view === 'all' && state.allEventsScope === 'recent') {
    list = list.filter(isRecentRow);
  }
  return list;
}

function sortedFilteredRows() {
  var list = scopedRows();
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

function updateScopeButtons() {
  const onAll = state.view === 'all';
  el.loadAllBtn.hidden = !(onAll && state.allEventsScope === 'recent');
  el.loadRecentBtn.hidden = !(onAll && state.allEventsScope === 'all');
}

function setCreateOverlayOpen(open) {
  state.createOpen = !!open;
  if (el.createPane) el.createPane.hidden = !state.createOpen;
  if (el.createOpenBtn) {
    el.createOpenBtn.hidden = state.createOpen;
  }
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

function applyEditorFoldClass() {
  el.editorPanel.classList.toggle('folded', !!state.editorFolded);
  el.editorFoldBtn.textContent = state.editorFolded ? '+' : '−';
  el.editorFoldBtn.title = state.editorFolded ? 'Развернуть панель' : 'Свернуть панель';
  el.editorFoldBtn.setAttribute('aria-label', el.editorFoldBtn.title);
}

function setEditorFolded(folded) {
  state.editorFolded = !!folded;
  try {
    localStorage.setItem(EDITOR_FOLD_KEY, state.editorFolded ? '1' : '0');
  } catch (e) { /* ignore */ }
  applyEditorFoldClass();
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
  applyEditorFoldClass();
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
      : ('Выбрано событий: ' + n);
    el.editorCollapseAll.hidden = false;
  }
  return true;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function allEventsHint(flat) {
  const total = flat.length;
  if (state.allEventsScope === 'recent') {
    const recent = flat.filter(isRecentRow).length;
    return recent + ' событ' + plural(recent) + ' за 2 недели · всего в базе ' + total;
  }
  return total + ' событ' + plural(total) + ' · вся база';
}

function allEventsStatus(flat) {
  if (state.allEventsScope === 'recent') {
    return 'все события · за 2 недели · ' + flat.filter(isRecentRow).length + '/' + flat.length;
  }
  return 'все события · ' + flat.length;
}

function applyEventRows(flat, title, statusText, opts) {
  opts = opts || {};
  state.rows = flat;
  if (!opts.keepSelection) clearSelection();
  if (!COLUMNS.some(function (c) { return c.key === state.sortKey; })) {
    state.sortKey = 'changed';
    state.sortDir = -1;
  }
  el.eventsTitle.textContent = title;
  if (state.view === 'all') {
    el.eventsHint.textContent = allEventsHint(flat);
    setStatus(allEventsStatus(flat), 'ok');
  } else {
    el.eventsHint.textContent = flat.length + ' событ' + plural(flat.length);
    setStatus(statusText, 'ok');
  }
  updateScopeButtons();
  renderTable();
}

function renderTable() {
  const rows = sortedFilteredRows();
  const hasRowsSource = hasView() && state.rows.length;
  el.eventsTable.hidden = !(hasRowsSource && rows.length);
  el.eventsEmpty.hidden = !el.eventsTable.hidden;
  updateScopeButtons();

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
    setEditorChrome(0);
    return;
  }

  if (!rows.length) {
    el.eventsTable.hidden = true;
    el.eventsEmpty.hidden = false;
    if (state.view === 'all' && state.allEventsScope === 'recent') {
      el.eventsEmpty.textContent = state.filter
        ? 'Ничего не найдено по фильтру'
        : 'За последние 2 недели изменений нет — нажми «Подгрузить все»';
    } else {
      el.eventsEmpty.textContent = 'Ничего не найдено по фильтру';
    }
    updateSelectionUi();
    return;
  }

  const cols = visibleColumns();
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
  if (opts.scope) state.allEventsScope = opts.scope;
  state.view = 'all';
  state.playlistId = null;
  state.playlistName = '';
  clearSelection();
  setCreateOverlayOpen(false);
  renderPlaylists();
  el.eventsTitle.textContent = 'Все события';
  el.deleteBtn.disabled = true;
  el.deleteBtn.textContent = 'Удалить';
  el.editorPanel.hidden = true;
  updateScopeButtons();

  if (!force && state.allEventsCache) {
    applyEventRows(state.allEventsCache, 'Все события');
    if (!state.allEventsLoading) {
      state.allEventsLoading = true;
      fetchAllEvents(false)
        .then(function (flat) {
          if (state.view !== 'all') return;
          applyEventRows(flat, 'Все события');
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
    applyEventRows(flat, 'Все события');
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
  setCreateOverlayOpen(false);
  renderPlaylists();
  el.eventsTitle.textContent = state.playlistName;
  el.eventsHint.textContent = 'Загрузка событий…';
  el.deleteBtn.disabled = true;
  el.deleteBtn.textContent = 'Удалить';
  el.editorPanel.hidden = true;
  updateScopeButtons();
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
  if (state.createOpen) {
    state.templatesLoaded = false;
    await ensureTemplatesLoaded(true);
    renderCreateForms();
    return;
  }
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

/* ---------------- Создание событий ---------------- */

function createSelectedCount() {
  return state.createSelectedIds.length;
}

function isCreateSelected(id) {
  return state.createSelectedIds.indexOf(id) !== -1;
}

function setCreateSelection(ids, anchorId) {
  const uniq = [];
  const seen = Object.create(null);
  (ids || []).forEach(function (id) {
    if (!id || seen[id]) return;
    seen[id] = true;
    uniq.push(id);
  });
  state.createSelectedIds = uniq;
  state.createAnchorId = anchorId != null
    ? anchorId
    : (uniq.length ? uniq[uniq.length - 1] : null);
}

function targetCreateForms(localId) {
  if (isCreateSelected(localId) && state.createSelectedIds.length > 1) {
    return state.createForms.filter(function (f) {
      return isCreateSelected(f.localId);
    });
  }
  return state.createForms.filter(function (f) { return f.localId === localId; });
}

function updateCreateActions() {
  const n = createSelectedCount();
  const total = state.createForms.length;
  el.createRemoveBtn.disabled = n === 0;
  el.createRemoveBtn.textContent = n > 1 ? ('Удалить выбранные (' + n + ')') : 'Удалить выбранные';
  const ready = state.createForms.filter(function (f) {
    return f.templateId && String(f.name || '').trim();
  }).length;
  el.createSubmitBtn.disabled = ready === 0;
  el.createSubmitBtn.textContent = ready > 1
    ? ('Создать (' + ready + ')')
    : 'Создать';
  if (n > 1) {
    el.createHint.textContent =
      'Выбрано полей: ' + n + ' — изменения имени, шаблона и переменных применяются ко всем выбранным.';
  } else {
    el.createHint.textContent =
      'Добавь поля, выбери шаблон — переменные подгрузятся сами. Выдели несколько полей (Shift/Ctrl), чтобы править сразу все.';
  }
  void total;
}

async function ensureTemplatesLoaded(force) {
  if (state.templatesLoaded && !force) return state.templates;
  const data = await api('GET', '/api/templates');
  state.templates = data.templates || [];
  state.templatesLoaded = true;
  return state.templates;
}

async function loadTemplateDetail(templateId) {
  if (state.templateDetails[templateId]) return state.templateDetails[templateId];
  const data = await api('GET', '/api/templates/' + encodeURIComponent(templateId));
  const tpl = data.template;
  state.templateDetails[templateId] = tpl;
  return tpl;
}

function applyTemplateToForm(form, tpl) {
  form.templateId = tpl.id;
  form.contentId = tpl.contentId || '';
  form.templateTypeInt = (tpl.templateTypeInt != null) ? tpl.templateTypeInt : 1;
  form.states = (tpl.states && tpl.states.length) ? tpl.states.slice() : ['IN'];
  form.state = tpl.defaultInState || form.states[0] || 'IN';
  form.variables = (tpl.variables || []).map(function (v) {
    return {
      id: v.id || '',
      name: v.name || '',
      type: v.type || 'Text',
      value: (v.defaultValue != null && v.defaultValue !== '')
        ? String(v.defaultValue)
        : (v.value != null ? String(v.value) : ''),
      fieldId: v.fieldId || '',
      defaultValue: v.defaultValue != null ? v.defaultValue : '',
      resetMedia: v.resetMedia,
      useTimecode: v.useTimecode,
      loop: v.loop,
      locked: v.locked,
      minValue: v.minValue,
      maxValue: v.maxValue,
      useDataVars: v.useDataVars
    };
  });
  form.loadingTemplate = false;
}

async function openCreateOverlay() {
  setCreateOverlayOpen(true);
  setStatus('создание событий', 'ok');
  renderCreateForms();
  try {
    await ensureTemplatesLoaded(false);
    renderCreateForms();
  } catch (err) {
    toast(err.message, 'err');
    setStatus(err.message, 'err');
  }
}

function closeCreateOverlay() {
  setCreateOverlayOpen(false);
  if (state.view === 'all') {
    setStatus(allEventsStatus(state.rows), 'ok');
  } else if (state.view === 'playlist') {
    setStatus(
      'плейлист: ' + state.playlistName + ' · ' + state.rows.length + ' событий',
      'ok'
    );
  }
}

function selectCreateForm(localId, ev) {
  ev = ev || {};
  const ids = state.createForms.map(function (f) { return f.localId; });
  const shift = !!ev.shiftKey;
  const toggle = !!(ev.ctrlKey || ev.metaKey);

  if (shift && state.createAnchorId && ids.indexOf(state.createAnchorId) !== -1 &&
      ids.indexOf(localId) !== -1) {
    const a = ids.indexOf(state.createAnchorId);
    const b = ids.indexOf(localId);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const range = ids.slice(from, to + 1);
    if (toggle) {
      const merged = state.createSelectedIds.slice();
      range.forEach(function (id) {
        if (merged.indexOf(id) === -1) merged.push(id);
      });
      setCreateSelection(merged, state.createAnchorId);
    } else {
      setCreateSelection(range, state.createAnchorId);
    }
  } else if (toggle) {
    const next = state.createSelectedIds.slice();
    const idx = next.indexOf(localId);
    if (idx === -1) next.push(localId);
    else next.splice(idx, 1);
    setCreateSelection(next, localId);
  } else {
    setCreateSelection([localId], localId);
  }
  renderCreateForms();
}

async function onCreateTemplateChange(localId, templateId) {
  const targets = targetCreateForms(localId);
  targets.forEach(function (f) {
    f.loadingTemplate = true;
    f.templateId = templateId || '';
    if (!templateId) {
      f.variables = [];
      f.contentId = '';
      f.states = ['IN'];
      f.state = 'IN';
      f.loadingTemplate = false;
    }
  });
  renderCreateForms();
  if (!templateId) return;

  try {
    const tpl = await loadTemplateDetail(templateId);
    targets.forEach(function (f) { applyTemplateToForm(f, tpl); });
    renderCreateForms();
  } catch (err) {
    targets.forEach(function (f) {
      f.loadingTemplate = false;
      f.variables = [];
    });
    renderCreateForms();
    toast(err.message, 'err');
  }
}

function onCreateNameChange(localId, name) {
  targetCreateForms(localId).forEach(function (f) { f.name = name; });
  updateCreateActions();
  if (createSelectedCount() > 1) {
    el.createList.querySelectorAll('.create-card').forEach(function (card) {
      const id = card.dataset.localId;
      if (!isCreateSelected(id) || id === localId) return;
      const input = card.querySelector('.create-card-top input[type="text"]:not([readonly])');
      if (input && input.value !== name) input.value = name;
    });
  }
}

function onCreateStateChange(localId, st) {
  targetCreateForms(localId).forEach(function (f) {
    f.state = st;
    if (f.states.indexOf(st) === -1) f.states.push(st);
  });
  updateCreateActions();
  if (createSelectedCount() > 1) {
    el.createList.querySelectorAll('.create-card').forEach(function (card) {
      const id = card.dataset.localId;
      if (!isCreateSelected(id) || id === localId) return;
      const selects = card.querySelectorAll('.create-card-top select');
      const stateSelect = selects[1];
      if (stateSelect && stateSelect.value !== st) stateSelect.value = st;
    });
  }
}

function onCreateVarChange(localId, varName, value) {
  targetCreateForms(localId).forEach(function (f) {
    const hit = f.variables.find(function (v) { return v.name === varName; });
    if (hit) hit.value = value;
  });
  // Не перерисовываем всё на каждый символ — обновляем только actions.
  updateCreateActions();
  // Синхронизируем значения в DOM у других выбранных карточек.
  if (createSelectedCount() > 1) {
    el.createList.querySelectorAll('.create-card').forEach(function (card) {
      const id = card.dataset.localId;
      if (!isCreateSelected(id) || id === localId) return;
      const input = card.querySelector('[data-var-name="' + cssAttrEscape(varName) + '"]');
      if (input && input.value !== value) input.value = value;
    });
  }
}

function cssAttrEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderCreateForms() {
  if (!state.createOpen) return;
  if (!el.createList) return;
  const existing = Object.create(null);
  state.createForms.forEach(function (f) { existing[f.localId] = true; });
  state.createSelectedIds = state.createSelectedIds.filter(function (id) {
    return existing[id];
  });
  if (state.createAnchorId && !existing[state.createAnchorId]) {
    state.createAnchorId = null;
  }

  el.createList.innerHTML = '';
  if (!state.createForms.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Нет полей — нажми «Добавить поле»';
    el.createList.appendChild(p);
    updateCreateActions();
    return;
  }

  state.createForms.forEach(function (form, idx) {
    const card = document.createElement('article');
    card.className = 'create-card' + (isCreateSelected(form.localId) ? ' selected' : '');
    card.dataset.localId = form.localId;

    const top = document.createElement('div');
    top.className = 'create-card-top';

    const checkWrap = document.createElement('div');
    checkWrap.className = 'create-card-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = isCreateSelected(form.localId);
    check.title = 'Выбрать поле';
    check.addEventListener('click', function (ev) {
      ev.stopPropagation();
      selectCreateForm(form.localId, {
        shiftKey: ev.shiftKey,
        ctrlKey: true,
        metaKey: ev.metaKey
      });
    });
    checkWrap.appendChild(check);

    const nameLab = document.createElement('label');
    nameLab.innerHTML = '<span>Имя события</span>';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = form.name || '';
    nameInput.placeholder = 'Event ' + (idx + 1);
    nameInput.addEventListener('click', function (ev) { ev.stopPropagation(); });
    nameInput.addEventListener('input', function () {
      onCreateNameChange(form.localId, nameInput.value);
    });
    nameLab.appendChild(nameInput);

    const tplLab = document.createElement('label');
    tplLab.innerHTML = '<span>Шаблон</span>';
    const tplSelect = document.createElement('select');
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = state.templatesLoaded ? '— выбери шаблон —' : 'Загрузка шаблонов…';
    tplSelect.appendChild(emptyOpt);
    state.templates.forEach(function (t) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name || t.id;
      if (t.id === form.templateId) opt.selected = true;
      tplSelect.appendChild(opt);
    });
    if (form.templateId && !state.templates.some(function (t) { return t.id === form.templateId; })) {
      const opt = document.createElement('option');
      opt.value = form.templateId;
      opt.textContent = form.templateId;
      opt.selected = true;
      tplSelect.appendChild(opt);
    }
    tplSelect.addEventListener('click', function (ev) { ev.stopPropagation(); });
    tplSelect.addEventListener('change', function () {
      onCreateTemplateChange(form.localId, tplSelect.value);
    });
    tplLab.appendChild(tplSelect);

    const stateLab = document.createElement('label');
    stateLab.innerHTML = '<span>State</span>';
    const stateSelect = document.createElement('select');
    (form.states || ['IN']).forEach(function (st) {
      const opt = document.createElement('option');
      opt.value = st;
      opt.textContent = st;
      if (st === form.state) opt.selected = true;
      stateSelect.appendChild(opt);
    });
    stateSelect.disabled = !form.templateId;
    stateSelect.addEventListener('click', function (ev) { ev.stopPropagation(); });
    stateSelect.addEventListener('change', function () {
      onCreateStateChange(form.localId, stateSelect.value);
    });
    stateLab.appendChild(stateSelect);

    const idxLab = document.createElement('label');
    idxLab.innerHTML = '<span>№</span>';
    const idxBox = document.createElement('input');
    idxBox.type = 'text';
    idxBox.value = String(idx + 1);
    idxBox.readOnly = true;
    idxBox.tabIndex = -1;
    idxLab.appendChild(idxBox);

    top.appendChild(checkWrap);
    top.appendChild(nameLab);
    top.appendChild(tplLab);
    top.appendChild(stateLab);
    top.appendChild(idxLab);
    card.appendChild(top);

    const varsWrap = document.createElement('div');
    varsWrap.className = 'create-vars';
    if (form.loadingTemplate) {
      varsWrap.innerHTML = '<p class="create-vars-empty">Загрузка переменных шаблона…</p>';
    } else if (!form.templateId) {
      varsWrap.innerHTML = '<p class="create-vars-empty">Выбери шаблон, чтобы увидеть переменные</p>';
    } else if (!form.variables.length) {
      varsWrap.innerHTML = '<p class="create-vars-empty">У шаблона нет переменных</p>';
    } else {
      const meta = document.createElement('p');
      meta.className = 'create-card-meta';
      meta.textContent = 'Переменные шаблона: ' + form.variables.length;
      varsWrap.appendChild(meta);

      const grid = document.createElement('div');
      grid.className = 'var-grid' + (form.variables.length > 10 ? ' var-grid-compact' : '');
      form.variables.forEach(function (v) {
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
        if (useArea) input.rows = Math.min(5, Math.max(2, val.split('\n').length));
        input.value = val;
        input.dataset.varName = v.name || '';
        input.addEventListener('click', function (ev) { ev.stopPropagation(); });
        input.addEventListener('input', function () {
          onCreateVarChange(form.localId, v.name, input.value);
        });
        row.appendChild(lab);
        row.appendChild(input);
        grid.appendChild(row);
      });
      varsWrap.appendChild(grid);
    }
    card.appendChild(varsWrap);

    card.addEventListener('click', function (ev) {
      if (ev.target.closest('input, select, textarea, label, button')) return;
      selectCreateForm(form.localId, ev);
    });

    el.createList.appendChild(card);
  });

  updateCreateActions();
}

function addCreateForm() {
  if (!state.createOpen) {
    openCreateOverlay();
  }
  const form = blankCreateForm();
  state.createForms.push(form);
  setCreateSelection([form.localId], form.localId);
  // Гарантируем отрисовку даже если оверлей только что открыли.
  state.createOpen = true;
  if (el.createPane) el.createPane.hidden = false;
  renderCreateForms();
  // Прокрутить к новому полю.
  requestAnimationFrame(function () {
    const cards = el.createList && el.createList.querySelectorAll('.create-card');
    if (cards && cards.length) {
      cards[cards.length - 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

function removeSelectedCreateForms() {
  const drop = Object.create(null);
  state.createSelectedIds.forEach(function (id) { drop[id] = true; });
  if (!Object.keys(drop).length) return;
  state.createForms = state.createForms.filter(function (f) { return !drop[f.localId]; });
  if (!state.createForms.length) state.createForms.push(blankCreateForm());
  setCreateSelection([], null);
  renderCreateForms();
}

async function submitCreateForms() {
  const payload = state.createForms
    .filter(function (f) { return f.templateId && String(f.name || '').trim(); })
    .map(function (f) {
      return {
        name: String(f.name).trim(),
        templateId: f.templateId,
        contentId: f.contentId,
        templateTypeInt: f.templateTypeInt,
        state: f.state || 'IN',
        comment: f.comment || '',
        variables: (f.variables || []).map(function (v) {
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
    });

  if (!payload.length) {
    toast('Заполни имя и шаблон хотя бы у одного поля', 'err');
    return;
  }

  el.createSubmitBtn.disabled = true;
  try {
    const data = await api('POST', '/api/events/create', { events: payload });
    const created = (data && data.created) ? data.created : [];
    toast('Создано событий: ' + created.length, 'ok');
    state.allEventsCache = null;
    state.createForms = [blankCreateForm()];
    setCreateSelection([], null);
    renderCreateForms();
  } catch (err) {
    toast(err.message, 'err');
    setStatus(err.message, 'err');
    updateCreateActions();
  }
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
    state.allEventsScope = 'recent';
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
      '«' + label + '» (' + ids[0] + ') будет удалено на сервере. Это необратимо.';
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
      applyEventRows(state.rows, 'Все события');
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

el.loadAllBtn.addEventListener('click', function () {
  state.allEventsScope = 'all';
  if (state.allEventsCache) {
    applyEventRows(state.allEventsCache, 'Все события');
  } else {
    selectAllEvents({ force: true, scope: 'all' });
  }
});

el.loadRecentBtn.addEventListener('click', function () {
  state.allEventsScope = 'recent';
  if (state.allEventsCache) {
    applyEventRows(state.allEventsCache, 'Все события');
  } else {
    selectAllEvents({ force: true, scope: 'recent' });
  }
});

el.filterInput.addEventListener('input', function () {
  state.filter = el.filterInput.value;
  renderTable();
});

el.varFilter.addEventListener('input', function () {
  state.varFilter = el.varFilter.value;
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

el.editorFoldBtn.addEventListener('click', function () {
  setEditorFolded(!state.editorFolded);
});

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

if (el.createOpenBtn) {
  el.createOpenBtn.addEventListener('click', function () {
    openCreateOverlay();
  });
}

if (el.createCloseBtn) {
  el.createCloseBtn.addEventListener('click', function () {
    closeCreateOverlay();
  });
}

if (el.createAddBtn) {
  el.createAddBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    addCreateForm();
  });
}

if (el.createRemoveBtn) {
  el.createRemoveBtn.addEventListener('click', function () {
    removeSelectedCreateForms();
  });
}

if (el.createSubmitBtn) {
  el.createSubmitBtn.addEventListener('click', function () {
    submitCreateForms();
  });
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && state.createOpen && !el.confirmDialog.open) {
    e.preventDefault();
    closeCreateOverlay();
    return;
  }
  if (e.key === 'Delete' && selectedCount() && !el.confirmDialog.open &&
      !state.createOpen &&
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
applyEditorFoldClass();

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
