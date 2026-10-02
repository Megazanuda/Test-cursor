'use strict';

/* Carrot playlist / event browser (front-end) */

const COLUMNS = [
  { key: 'name', label: 'Event name', cls: 'col-name' },
  { key: 'templateName', label: 'Template name', cls: 'col-template' },
  { key: 'created', label: 'Created', cls: 'col-created' },
  { key: 'changed', label: 'Last modified', cls: 'col-changed' },
  { key: 'id', label: 'Id', cls: 'col-id' },
  { key: 'externalId', label: 'External id', cls: 'col-ext' }
];

const HIDDEN_COLS_KEY = 'carrot-web-hidden-columns';
const EDITOR_FOLD_KEY = 'carrot-web-editor-folded';
const PLAYLISTS_OPEN_KEY = 'carrot-web-playlists-open';
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

function loadEditorUserCollapsed() {
  try {
    return localStorage.getItem(EDITOR_FOLD_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function loadPlaylistsOpen() {
  try {
    return localStorage.getItem(PLAYLISTS_OPEN_KEY) === '1';
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
    externalId: '',
    templateId: '',
    contentId: '',
    templateTypeInt: 1,
    state: 'IN',
    comment: '',
    variables: [],
    loadingTemplate: false
  };
}

const state = {
  connected: false,
  section: 'events', // events | create
  playlists: [],
  playlistsOpen: loadPlaylistsOpen(),
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
  allEventsScope: 'recent',
  hiddenColumns: loadHiddenColumns(),
  eventDetails: Object.create(null),
  editorLoadToken: 0,
  varFilter: '',
  // true только если пользователь сам свернул панель
  editorUserCollapsed: loadEditorUserCollapsed(),
  editorFolded: loadEditorUserCollapsed(),
  templates: [],
  templatesLoaded: false,
  templateDetails: Object.create(null),
  mediaAssets: [],
  mediaLoaded: false,
  mediaLoading: null,
  createForms: [blankCreateForm()],
  createSelectedIds: [],
  createAnchorId: null
};

const el = {
  statusLine: document.getElementById('statusLine'),
  sectionTabs: document.getElementById('sectionTabs'),
  tabEvents: document.getElementById('tabEvents'),
  tabCreate: document.getElementById('tabCreate'),
  connectPanel: document.getElementById('connectPanel'),
  connectForm: document.getElementById('connectForm'),
  connectBtn: document.getElementById('connectBtn'),
  baseUrl: document.getElementById('baseUrl'),
  login: document.getElementById('login'),
  password: document.getElementById('password'),
  workspace: document.getElementById('workspace'),
  sectionEvents: document.getElementById('sectionEvents'),
  sectionCreate: document.getElementById('sectionCreate'),
  allEventsBtn: document.getElementById('allEventsBtn'),
  playlistsToggle: document.getElementById('playlistsToggle'),
  playlistsToggleInd: document.getElementById('playlistsToggleInd'),
  playlistsBody: document.getElementById('playlistsBody'),
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
  createHint: document.getElementById('createHint'),
  createList: document.getElementById('createList'),
  createAddBtn: document.getElementById('createAddBtn'),
  createRemoveBtn: document.getElementById('createRemoveBtn'),
  createClearBtn: document.getElementById('createClearBtn'),
  createSubmitBtn: document.getElementById('createSubmitBtn'),
  editorPanel: document.getElementById('editorPanel'),
  editorTitle: document.getElementById('editorTitle'),
  editorSub: document.getElementById('editorSub'),
  editorTabs: document.getElementById('editorTabs'),
  editorBody: document.getElementById('editorBody'),
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
  toastTimer = setTimeout(function () { el.toast.hidden = true; }, 5200);
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

function formatDateTime(value) {
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
  const createdRaw = pick(event, ['created', 'Created', 'createDate']);
  const changedRaw = pick(event, ['changed', 'modified', 'updated', 'changeDate']);

  return {
    name: pick(event, ['name']) || pick(item, ['eventName', 'name']),
    templateName: pick(event, ['templateName']) ||
      pick(template, ['name']) ||
      pick(item, ['templateName']),
    created: formatDateTime(createdRaw),
    createdRaw: createdRaw,
    changed: formatDateTime(changedRaw),
    changedRaw: changedRaw,
    id: pick(event, ['id']) || pick(item, ['eventId']),
    externalId: pick(event, ['externalId']) || pick(item, ['externalId', 'eventExternalId']),
    _event: event,
    _item: item
  };
}

function isRecentRow(row) {
  if (!row || row.changedRaw == null || row.changedRaw === '') return false;
  const t = new Date(row.changedRaw).getTime();
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) <= TWO_WEEKS_MS;
}

function isMediaType(type) {
  return String(type || '').toLowerCase() === 'media';
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
      if (cb.checked) delete state.hiddenColumns[c.key];
      else {
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
  const key = (state.sortKey === 'changed') ? 'changedRaw'
    : (state.sortKey === 'created' ? 'createdRaw' : state.sortKey);
  const dir = state.sortDir;
  list.sort(function (a, b) {
    const cmp = compareValues(a[key], b[key]);
    if (cmp !== 0) return cmp * dir;
    return compareValues(a.name, b.name) * dir;
  });
  return list;
}

function setSection(section) {
  state.section = section === 'create' ? 'create' : 'events';
  el.sectionEvents.hidden = state.section !== 'events';
  el.sectionCreate.hidden = state.section !== 'create';
  el.tabEvents.classList.toggle('active', state.section === 'events');
  el.tabCreate.classList.toggle('active', state.section === 'create');
  if (state.section === 'create') {
    renderCreateForms();
    ensureTemplatesLoaded(false).then(function () {
      return ensureMediaLoaded();
    }).then(function () {
      renderCreateForms();
    }).catch(function (err) {
      toast(err.message, 'err');
    });
  }
}

function updatePlaylistsToggleUi() {
  el.playlistsBody.hidden = !state.playlistsOpen;
  el.playlistsToggle.setAttribute('aria-expanded', state.playlistsOpen ? 'true' : 'false');
  el.playlistsToggleInd.textContent = state.playlistsOpen ? '▾' : '▸';
}

function setPlaylistsOpen(open) {
  state.playlistsOpen = !!open;
  try {
    localStorage.setItem(PLAYLISTS_OPEN_KEY, state.playlistsOpen ? '1' : '0');
  } catch (e) { /* ignore */ }
  updatePlaylistsToggleUi();
}

function updateScopeButtons() {
  const onAll = state.view === 'all' && state.section === 'events';
  el.loadAllBtn.hidden = !(onAll && state.allEventsScope === 'recent');
  el.loadRecentBtn.hidden = !(onAll && state.allEventsScope === 'all');
}

function renderPlaylists() {
  el.playlistList.innerHTML = '';
  el.allEventsBtn.classList.toggle('active', state.view === 'all');

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
    btn.innerHTML = '<span class="pl-name"></span><span class="pl-id"></span>';
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

async function ensureMediaLoaded(force) {
  if (state.mediaLoaded && !force) return state.mediaAssets;
  if (state.mediaLoading) return state.mediaLoading;
  state.mediaLoading = api('GET', '/api/media')
    .then(function (data) {
      state.mediaAssets = data.media || [];
      state.mediaLoaded = true;
      return state.mediaAssets;
    })
    .catch(function (err) {
      state.mediaLoaded = false;
      throw err;
    })
    .finally(function () {
      state.mediaLoading = null;
    });
  return state.mediaLoading;
}

function fillMediaSelect(select, currentValue) {
  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = state.mediaLoaded
    ? (state.mediaAssets.length ? '— медиа —' : 'Медиа не найдены')
    : 'Загрузка медиа…';
  select.appendChild(empty);
  state.mediaAssets.forEach(function (m) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name || m.id;
    if (String(m.id) === String(currentValue)) opt.selected = true;
    select.appendChild(opt);
  });
  if (currentValue && !state.mediaAssets.some(function (m) {
    return String(m.id) === String(currentValue);
  })) {
    const opt = document.createElement('option');
    opt.value = currentValue;
    opt.textContent = currentValue;
    opt.selected = true;
    select.appendChild(opt);
  }
}

function makeVarInput(v, onChange) {
  const val = v.value == null ? '' : String(v.value);
  if (isMediaType(v.type)) {
    const select = document.createElement('select');
    fillMediaSelect(select, val);
    select.addEventListener('click', function (ev) { ev.stopPropagation(); });
    select.addEventListener('change', function () { onChange(select.value); });
    if (!state.mediaLoaded) {
      ensureMediaLoaded(false).then(function () {
        fillMediaSelect(select, select.value || val);
      }).catch(function (err) {
        toast('Медиа: ' + err.message, 'err');
      });
    }
    return select;
  }
  const useArea = val.indexOf('\n') !== -1 || val.length > 80;
  const input = useArea ? document.createElement('textarea') : document.createElement('input');
  if (!useArea) input.type = 'text';
  if (useArea) input.rows = Math.min(6, Math.max(2, val.split('\n').length));
  input.value = val;
  input.addEventListener('click', function (ev) { ev.stopPropagation(); });
  input.addEventListener('input', function () { onChange(input.value); });
  return input;
}

function buildVarEditor(eventId, variables, opts) {
  opts = opts || {};
  const wrap = document.createElement('div');
  wrap.className = opts.bare ? 'var-editor' : 'event-card-body var-editor';
  const all = variables || [];
  const filtered = all.filter(matchesVarFilter);

  if (!all.length) {
    wrap.innerHTML = '<p class="editor-empty">У события нет переменных</p>';
    return wrap;
  }
  if (state.varFilter && !filtered.length) {
    wrap.innerHTML = '<p class="editor-empty">Нет переменных по фильтру</p>';
    return wrap;
  }
  if (all.length > 10 || state.varFilter) {
    const hint = document.createElement('p');
    hint.className = 'var-count-hint';
    hint.textContent = 'Показано ' + filtered.length + ' из ' + all.length;
    wrap.appendChild(hint);
  }

  const grid = document.createElement('div');
  grid.className = 'var-grid' + (all.length > 10 ? ' var-grid-compact' : '');
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
    const input = makeVarInput(v, function (value) {
      input._currentValue = value;
    });
    input.dataset.varName = v.name || '';
    input._currentValue = v.value == null ? '' : String(v.value);
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
      byName[inp.dataset.varName] =
        inp._currentValue != null ? inp._currentValue : inp.value;
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
}

function setEditorFolded(folded, fromUser) {
  state.editorFolded = !!folded;
  if (fromUser) {
    state.editorUserCollapsed = !!folded;
    try {
      localStorage.setItem(EDITOR_FOLD_KEY, state.editorUserCollapsed ? '1' : '0');
    } catch (e) { /* ignore */ }
  }
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
    el.editorBody.innerHTML = '';
    return false;
  }

  el.editorPanel.hidden = false;
  // Автооткрытие, если пользователь сам не сворачивал.
  if (!state.editorUserCollapsed) state.editorFolded = false;
  applyEditorFoldClass();
  el.varFilter.hidden = false;
  el.editorTitle.textContent = 'Переменные';
  if (n === 1) {
    el.editorSub.hidden = true;
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
    el.editorBody.appendChild(buildVarEditor(item.id, (item.event && item.event.variables) || [], { bare: true }));
    return;
  }

  el.editorTabs.hidden = false;
  loaded.forEach(function (item, idx) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'editor-tab' + (idx === 0 ? ' active' : '');
    tab.textContent = item.name || ('Событие ' + (idx + 1));
    tab.addEventListener('click', function () {
      el.editorBody.querySelectorAll('details.event-card').forEach(function (d) {
        d.open = d.dataset.eventId === item.id;
      });
      el.editorTabs.querySelectorAll('.editor-tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
    });
    el.editorTabs.appendChild(tab);

    const card = document.createElement('details');
    card.className = 'event-card';
    card.dataset.eventId = item.id;
    card.open = idx === 0;
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
      body.innerHTML = '<p class="editor-empty">' + escapeHtml(item.error) + '</p>';
      card.appendChild(body);
    } else {
      card.appendChild(buildVarEditor(item.id, (item.event && item.event.variables) || []));
    }
    if (loaded.length > 3) {
      card.addEventListener('toggle', function () {
        if (!card.open) return;
        el.editorBody.querySelectorAll('details.event-card').forEach(function (d) {
          if (d !== card) d.open = false;
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

  const hasMedia = [];
  const ids = state.selectedIds.slice();
  const loaded = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const row = state.rows.find(function (r) { return r.id === id; });
    try {
      const ev = await loadEventDetail(id);
      const vars = (ev && ev.variables) || [];
      if (vars.some(function (v) { return isMediaType(v.type); })) hasMedia.push(1);
      loaded.push({ id: id, name: (ev && ev.name) || (row && row.name) || id, event: ev });
    } catch (err) {
      loaded.push({ id: id, name: (row && row.name) || id, error: err.message });
    }
    if (token !== state.editorLoadToken) return;
  }
  if (token !== state.editorLoadToken) return;

  if (hasMedia.length) {
    try { await ensureMediaLoaded(false); } catch (e) { /* toast later in selects */ }
  }
  setEditorChrome(n, false);
  paintEditorItems(loaded);
}

function updateSelectionUi() {
  renderEditor();
}

function plural(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ие';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'ия';
  return 'ий';
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
    el.eventsEmpty.textContent = (state.view === 'all' && state.allEventsScope === 'recent' && !state.filter)
      ? 'За последние 2 недели изменений нет — нажми «Подгрузить все»'
      : 'Ничего не найдено по фильтру';
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
  setSection('events');
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
        .catch(function () { /* cache */ })
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
  setSection('events');
  if (!state.playlistsOpen) setPlaylistsOpen(true);
  renderPlaylists();
  el.eventsTitle.textContent = state.playlistName;
  el.eventsHint.textContent = 'Загрузка событий…';
  el.deleteBtn.disabled = true;
  el.editorPanel.hidden = true;
  updateScopeButtons();
  renderTable();
  try {
    const data = await api('GET', '/api/playlists/' + encodeURIComponent(pl.id) + '/events');
    applyEventRows(
      (data.events || []).map(flattenRow),
      state.playlistName,
      'плейлист: ' + state.playlistName + ' · ' + (data.events || []).length + ' событий'
    );
  } catch (err) {
    el.eventsHint.textContent = 'Ошибка загрузки';
    toast(err.message, 'err');
    setStatus(err.message, 'err');
  }
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
    const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
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
}

async function connect(creds) {
  el.connectBtn.disabled = true;
  setStatus('подключение…');
  try {
    const data = await api('POST', '/api/connect', creds);
    state.connected = true;
    el.connectPanel.hidden = true;
    el.workspace.hidden = false;
    el.sectionTabs.hidden = false;
    setStatus('онлайн · ' + data.baseUrl, 'ok');
    toast('Подключено к ' + data.baseUrl, 'ok');
    updatePlaylistsToggleUi();
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
    el.confirmText.textContent =
      '«' + ((row && row.name) || ids[0]) + '» будет удалено на сервере. Это необратимо.';
  } else {
    el.confirmText.textContent = 'Будет удалено событий: ' + ids.length + '. Это необратимо.';
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
    if (failed.length) toast('Удалено: ' + deleted.length + ', ошибок: ' + failed.length, 'err');
    else toast('Удалено: ' + deleted.length, 'ok');
    if (deleted.length) {
      const drop = Object.create(null);
      deleted.forEach(function (id) {
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
    clearSelection();
    if (state.view === 'all') applyEventRows(state.rows, 'Все события');
    else if (state.view === 'playlist') {
      applyEventRows(
        state.rows,
        state.playlistName,
        'плейлист: ' + state.playlistName + ' · ' + state.rows.length + ' событий'
      );
    } else renderTable();
  } catch (err) {
    toast(err.message, 'err');
    updateSelectionUi();
  }
}

/* ---------------- Создание ---------------- */

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
    return state.createForms.filter(function (f) { return isCreateSelected(f.localId); });
  }
  return state.createForms.filter(function (f) { return f.localId === localId; });
}

function updateCreateActions() {
  const n = createSelectedCount();
  const ready = state.createForms.filter(function (f) {
    return f.templateId && String(f.name || '').trim();
  }).length;
  el.createRemoveBtn.disabled = n === 0;
  el.createRemoveBtn.textContent = n > 1 ? ('Удалить выбранные (' + n + ')') : 'Удалить выбранные';
  el.createClearBtn.disabled = state.createForms.length === 0;
  el.createSubmitBtn.disabled = ready === 0;
  el.createSubmitBtn.textContent = ready > 1 ? ('Создать (' + ready + ')') : 'Создать';
  el.createHint.textContent = n > 1
    ? ('Выбрано полей: ' + n + ' — имя, External id, шаблон и переменные применяются ко всем выбранным.')
    : 'Добавь поля, выбери шаблон — переменные подгрузятся сами. Клик по карточке выделяет её; Shift/Ctrl — несколько.';
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
  state.templateDetails[templateId] = data.template;
  return data.template;
}

function applyTemplateToForm(form, tpl) {
  form.templateId = tpl.id;
  form.contentId = tpl.contentId || '';
  form.templateTypeInt = (tpl.templateTypeInt != null) ? tpl.templateTypeInt : 1;
  form.state = tpl.defaultInState || 'IN';
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

function selectCreateForm(localId, ev) {
  ev = ev || {};
  const ids = state.createForms.map(function (f) { return f.localId; });
  const shift = !!ev.shiftKey;
  const toggle = !!(ev.ctrlKey || ev.metaKey);

  if (shift && state.createAnchorId && ids.indexOf(state.createAnchorId) !== -1 &&
      ids.indexOf(localId) !== -1) {
    const a = ids.indexOf(state.createAnchorId);
    const b = ids.indexOf(localId);
    const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    setCreateSelection(toggle
      ? state.createSelectedIds.concat(range.filter(function (id) {
        return state.createSelectedIds.indexOf(id) === -1;
      }))
      : range, state.createAnchorId);
  } else if (toggle) {
    const next = state.createSelectedIds.slice();
    const idx = next.indexOf(localId);
    if (idx === -1) next.push(localId);
    else next.splice(idx, 1);
    setCreateSelection(next, localId);
  } else if (isCreateSelected(localId) && state.createSelectedIds.length === 1) {
    setCreateSelection([], null);
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
      f.loadingTemplate = false;
    }
  });
  renderCreateForms();
  if (!templateId) return;
  try {
    const tpl = await loadTemplateDetail(templateId);
    if ((tpl.variables || []).some(function (v) { return isMediaType(v.type); })) {
      try { await ensureMediaLoaded(false); } catch (e) { /* selects handle */ }
    }
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

function syncFieldToSelected(localId, selector, value) {
  if (createSelectedCount() <= 1) return;
  el.createList.querySelectorAll('.create-card').forEach(function (card) {
    const id = card.dataset.localId;
    if (!isCreateSelected(id) || id === localId) return;
    const node = card.querySelector(selector);
    if (node && node.value !== value) node.value = value;
  });
}

function onCreateNameChange(localId, name) {
  targetCreateForms(localId).forEach(function (f) { f.name = name; });
  updateCreateActions();
  syncFieldToSelected(localId, '[data-field="name"]', name);
}

function onCreateExternalIdChange(localId, externalId) {
  targetCreateForms(localId).forEach(function (f) { f.externalId = externalId; });
  updateCreateActions();
  syncFieldToSelected(localId, '[data-field="externalId"]', externalId);
}

function onCreateVarChange(localId, varName, value) {
  targetCreateForms(localId).forEach(function (f) {
    const hit = f.variables.find(function (v) { return v.name === varName; });
    if (hit) hit.value = value;
  });
  updateCreateActions();
  if (createSelectedCount() > 1) {
    el.createList.querySelectorAll('.create-card').forEach(function (card) {
      const id = card.dataset.localId;
      if (!isCreateSelected(id) || id === localId) return;
      const input = card.querySelector('[data-var-name="' +
        String(varName).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
      if (input && input.value !== value) {
        input.value = value;
        input._currentValue = value;
      }
    });
  }
}

function renderCreateForms() {
  if (state.section !== 'create' || !el.createList) return;
  const existing = Object.create(null);
  state.createForms.forEach(function (f) { existing[f.localId] = true; });
  state.createSelectedIds = state.createSelectedIds.filter(function (id) {
    return existing[id];
  });
  if (state.createAnchorId && !existing[state.createAnchorId]) state.createAnchorId = null;

  el.createList.innerHTML = '';
  if (!state.createForms.length) {
    el.createList.innerHTML = '<p class="empty">Нет полей — нажми «Добавить поле»</p>';
    updateCreateActions();
    return;
  }

  state.createForms.forEach(function (form) {
    const card = document.createElement('article');
    card.className = 'create-card' + (isCreateSelected(form.localId) ? ' selected' : '');
    card.dataset.localId = form.localId;

    const top = document.createElement('div');
    top.className = 'create-card-top';

    function field(labelText, fieldKey, maker) {
      const lab = document.createElement('label');
      lab.innerHTML = '<span></span>';
      lab.querySelector('span').textContent = labelText;
      const node = maker();
      node.dataset.field = fieldKey;
      node.addEventListener('click', function (ev) { ev.stopPropagation(); });
      lab.appendChild(node);
      lab.addEventListener('click', function (ev) { ev.stopPropagation(); });
      top.appendChild(lab);
      return node;
    }

    const nameInput = field('Имя события', 'name', function () {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = form.name || '';
      input.placeholder = 'Имя';
      input.addEventListener('input', function () {
        onCreateNameChange(form.localId, nameInput.value);
      });
      return input;
    });
    void nameInput;

    field('Шаблон', 'template', function () {
      const select = document.createElement('select');
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = state.templatesLoaded ? '— выбери шаблон —' : 'Загрузка…';
      select.appendChild(emptyOpt);
      state.templates.forEach(function (t) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name || t.id;
        if (t.id === form.templateId) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', function () {
        onCreateTemplateChange(form.localId, select.value);
      });
      return select;
    });

    field('External id', 'externalId', function () {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = form.externalId || '';
      input.placeholder = 'пусто = новый GUID';
      input.addEventListener('input', function () {
        onCreateExternalIdChange(form.localId, input.value);
      });
      return input;
    });

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
        const input = makeVarInput(v, function (value) {
          onCreateVarChange(form.localId, v.name, value);
        });
        input.dataset.varName = v.name || '';
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
  const form = blankCreateForm();
  state.createForms.push(form);
  setCreateSelection([form.localId], form.localId);
  renderCreateForms();
  requestAnimationFrame(function () {
    const cards = el.createList.querySelectorAll('.create-card');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

function clearAllCreateForms() {
  state.createForms = [blankCreateForm()];
  setCreateSelection([], null);
  renderCreateForms();
}

async function submitCreateForms() {
  const payload = state.createForms
    .filter(function (f) { return f.templateId && String(f.name || '').trim(); })
    .map(function (f) {
      return {
        name: String(f.name).trim(),
        externalId: String(f.externalId || '').trim(),
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

/* ---------------- Events wiring ---------------- */

el.connectForm.addEventListener('submit', function (e) {
  e.preventDefault();
  connect({
    baseUrl: el.baseUrl.value.trim() || undefined,
    login: el.login.value.trim() || undefined,
    password: el.password.value || undefined
  }).catch(function () { /* toasted */ });
});

el.tabEvents.addEventListener('click', function () { setSection('events'); });
el.tabCreate.addEventListener('click', function () { setSection('create'); });

el.allEventsBtn.addEventListener('click', function () { selectAllEvents(); });
el.playlistsToggle.addEventListener('click', function () {
  setPlaylistsOpen(!state.playlistsOpen);
});

el.reloadPlaylists.addEventListener('click', function () {
  loadPlaylists()
    .then(function () {
      if (state.view === 'all') return selectAllEvents({ force: true });
      if (state.view === 'playlist' && state.playlistId) {
        return selectPlaylist({ id: state.playlistId, name: state.playlistName });
      }
    })
    .catch(function (err) { toast(err.message, 'err'); });
});

el.loadAllBtn.addEventListener('click', function () {
  state.allEventsScope = 'all';
  if (state.allEventsCache) applyEventRows(state.allEventsCache, 'Все события');
  else selectAllEvents({ force: true, scope: 'all' });
});

el.loadRecentBtn.addEventListener('click', function () {
  state.allEventsScope = 'recent';
  if (state.allEventsCache) applyEventRows(state.allEventsCache, 'Все события');
  else selectAllEvents({ force: true, scope: 'recent' });
});

el.filterInput.addEventListener('input', function () {
  state.filter = el.filterInput.value;
  renderTable();
});

el.varFilter.addEventListener('input', function () {
  state.varFilter = el.varFilter.value;
  if (selectedCount()) {
    state.editorLoadToken++;
    const ids = state.selectedIds.slice();
    const loaded = ids.map(function (id) {
      const row = state.rows.find(function (r) { return r.id === id; });
      const ev = state.eventDetails[id];
      if (!ev) {
        return { id: id, name: (row && row.name) || id, error: 'Нет данных — выбери строку снова' };
      }
      return { id: id, name: ev.name || (row && row.name) || id, event: ev };
    });
    setEditorChrome(selectedCount(), false);
    paintEditorItems(loaded);
  }
});

el.editorFoldBtn.addEventListener('click', function () {
  setEditorFolded(!state.editorFolded, true);
});

el.editorCollapseAll.addEventListener('click', function () {
  el.editorBody.querySelectorAll('details.event-card').forEach(function (d) {
    d.open = false;
  });
});

el.deleteBtn.addEventListener('click', function () { deleteSelected(); });

el.createAddBtn.addEventListener('click', function (ev) {
  ev.preventDefault();
  addCreateForm();
});
el.createRemoveBtn.addEventListener('click', function () { removeSelectedCreateForms(); });
el.createClearBtn.addEventListener('click', function () { clearAllCreateForms(); });
el.createSubmitBtn.addEventListener('click', function () { submitCreateForms(); });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Delete' && state.section === 'events' && selectedCount() &&
      !el.confirmDialog.open &&
      document.activeElement &&
      document.activeElement.tagName !== 'INPUT' &&
      document.activeElement.tagName !== 'TEXTAREA' &&
      document.activeElement.tagName !== 'SELECT') {
    e.preventDefault();
    deleteSelected();
  }
  if (e.key === 'Escape' && selectedCount() && !el.confirmDialog.open &&
      state.section === 'events') {
    clearSelection();
    renderTable();
  }
});

renderColsMenu();
updatePlaylistsToggleUi();
applyEditorFoldClass();

(async function boot() {
  try {
    const health = await api('GET', '/api/health');
    if (health.defaults) {
      if (health.defaults.baseUrl) el.baseUrl.value = health.defaults.baseUrl;
      if (health.defaults.login) el.login.value = health.defaults.login;
    }
    if (health.hasEnv) await connect({});
    else setStatus('заполни .env или форму подключения');
  } catch (err) {
    setStatus(err.message, 'err');
  }
})();
