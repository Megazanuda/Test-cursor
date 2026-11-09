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
const SIDE_OPEN_KEY = 'carrot-web-side-open';
const MEDIA_FOLDER_KEY = 'carrot-media-folder';
const THEME_KEY = 'site-theme';
const AUTO_NAME_KEY = 'carrot-auto-name';
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

function loadSideOpen() {
  try {
    return localStorage.getItem(SIDE_OPEN_KEY) === '1';
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
  sideOpen: loadSideOpen(), // боковое меню источников — по умолчанию скрыто
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
  mediaHint: '',
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
  sidePane: document.getElementById('sidePane'),
  sideToggleBtn: document.getElementById('sideToggleBtn'),
  allEventsBtn: document.getElementById('allEventsBtn'),
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
  mediaUploadBtn: document.getElementById('mediaUploadBtn'),
  mediaUploadInput: document.getElementById('mediaUploadInput'),
  excelImportBtn: document.getElementById('excelImportBtn'),
  excelImportDialog: document.getElementById('excelImportDialog'),
  excelImportForm: document.getElementById('excelImportForm'),
  excelTemplateSelect: document.getElementById('excelTemplateSelect'),
  excelPickFileBtn: document.getElementById('excelPickFileBtn'),
  excelImportInput: document.getElementById('excelImportInput'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  autoNameToggle: document.getElementById('autoNameToggle'),
  settingsBaseUrl: document.getElementById('settingsBaseUrl'),
  settingsLogin: document.getElementById('settingsLogin'),
  settingsPassword: document.getElementById('settingsPassword'),
  settingsConnectionSaveBtn: document.getElementById('settingsConnectionSaveBtn'),
  mediaFolderPath: document.getElementById('mediaFolderPath'),
  mediaFolderPickBtn: document.getElementById('mediaFolderPickBtn'),
  mediaFolderClearBtn: document.getElementById('mediaFolderClearBtn'),
  mediaFolderFallbackInput: document.getElementById('mediaFolderFallbackInput'),
  playlistsGroup: document.getElementById('playlistsGroup'),
  settingsGroup: document.getElementById('settingsGroup'),
  editorPanel: document.getElementById('editorPanel'),
  editorTitle: document.getElementById('editorTitle'),
  editorSub: document.getElementById('editorSub'),
  editorTabs: document.getElementById('editorTabs'),
  editorBody: document.getElementById('editorBody'),
  editorFoldBtn: document.getElementById('editorFoldBtn'),
  editorCollapseAll: document.getElementById('editorCollapseAll'),
  varFilter: document.getElementById('varFilter'),
  toast: document.getElementById('toast'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingTitle: document.getElementById('loadingTitle'),
  loadingSub: document.getElementById('loadingSub'),
  feedbackDialog: document.getElementById('feedbackDialog'),
  feedbackForm: document.getElementById('feedbackForm'),
  feedbackTitle: document.getElementById('feedbackTitle'),
  feedbackMessage: document.getElementById('feedbackMessage'),
  feedbackDetailWrap: document.getElementById('feedbackDetailWrap'),
  feedbackDetail: document.getElementById('feedbackDetail'),
  feedbackOkBtn: document.getElementById('feedbackOkBtn'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmText: document.getElementById('confirmText')
};

let toastTimer = null;
let loadingDepth = 0;

function setStatus(text, kind) {
  el.statusLine.textContent = text;
  el.statusLine.classList.remove('ok', 'err');
  if (kind) el.statusLine.classList.add(kind);
}

function toast(message, kind) {
  // Короткие успехи — toast; ошибки/важное — диалог через showError/showFeedback.
  if (kind === 'err') {
    showError(message);
    return;
  }
  if (!el.toast) return;
  el.toast.hidden = false;
  el.toast.textContent = message;
  el.toast.classList.remove('ok', 'err');
  if (kind) el.toast.classList.add(kind);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.toast.hidden = true; }, 4200);
}

function humanizeError(err) {
  const raw = err && err.message ? String(err.message) : String(err || 'Неизвестная ошибка');
  const lower = raw.toLowerCase();
  var title = 'Не удалось выполнить действие';
  var message = raw;
  var hint = '';

  if (/econnrefused|connection refused|никто не слушает|10061|actively refused/.test(lower)) {
    title = 'Нет связи с Carrot';
    message = 'По этому Base URL TCP-соединение отклонено — REST не слушает адрес.';
    hint = 'На машине Carrot проверь, что Server запущен и какой порт у REST '
      + '(часто 5001, swagger /auth/generate). Не 8088 и не WS 24710/24712. '
      + 'С Windows должен быть сетевой доступ к этому IP.';
  } else if (/timed?\s*out|timeout|etagain|etimedout/.test(lower)) {
    title = 'Превышено время ожидания';
    message = 'Carrot слишком долго не отвечает.';
    hint = 'Проверь сеть и доступность сервера, затем повтори.';
  } else if (/401|неавториз|unauthorized|login|password|парол|логин/.test(lower) && /auth|token|jwt|подключ/.test(lower)) {
    title = 'Ошибка входа';
    message = 'Не удалось получить доступ к API.';
    hint = 'Проверь логин и пароль.';
  } else if (/cors|failed to fetch|networkerror|сеть:/.test(lower)) {
    title = 'Сетевая ошибка';
    message = 'Браузер не смог связаться с локальным сервером UI или с Carrot.';
    hint = 'Убедись, что web.cmd (Flask) запущен и адрес страницы верный.';
  } else if (/не json|html — веб-интерфейс|не rest/.test(lower)) {
    title = 'Неверный адрес REST API';
    message = 'По этому URL отвечает не REST Carrot (часто веб-плейлист).';
    hint = 'Укажи адрес REST (часто :5001), а не порт 8088.';
  } else if (/404|не найден|not found/.test(lower)) {
    title = 'Не найдено';
    message = 'Запрошенный объект или путь API не найден.';
  } else if (/папк|media folder|файл не найден/.test(lower)) {
    title = 'Проблема с медиа';
    message = raw;
    hint = 'Проверь папку медиа в Настройках и имена файлов в Excel.';
  } else if (/excel|openpyxl|xlsx/.test(lower)) {
    title = 'Ошибка Excel';
    message = raw;
    hint = 'Нужен файл .xlsx/.xlsm с колонками: имя | переменные | External id.';
  }

  return { title: title, message: message, detail: raw === message ? '' : raw, hint: hint };
}

function showFeedback(opts) {
  opts = opts || {};
  const kind = opts.kind || 'info';
  const title = opts.title || (kind === 'err' ? 'Ошибка' : kind === 'ok' ? 'Готово' : 'Сообщение');
  var message = opts.message || '';
  if (opts.hint) {
    message = message + (message ? '\n\n' : '') + opts.hint;
  }
  const detail = opts.detail || '';

  if (!el.feedbackDialog) {
    window.alert(title + '\n\n' + message + (detail ? '\n\n' + detail : ''));
    return;
  }

  el.feedbackForm.classList.remove('kind-err', 'kind-ok', 'kind-warn', 'kind-info');
  el.feedbackForm.classList.add('kind-' + kind);
  el.feedbackTitle.textContent = title;
  el.feedbackMessage.textContent = message;
  if (detail && detail !== message) {
    el.feedbackDetailWrap.hidden = false;
    el.feedbackDetail.textContent = detail;
  } else {
    el.feedbackDetailWrap.hidden = true;
    el.feedbackDetail.textContent = '';
  }
  if (el.feedbackOkBtn) {
    el.feedbackOkBtn.textContent = opts.okLabel || 'Понятно';
    el.feedbackOkBtn.className = 'btn ' + (kind === 'err' ? 'danger' : 'primary');
  }
  if (typeof el.feedbackDialog.showModal === 'function') {
    if (!el.feedbackDialog.open) el.feedbackDialog.showModal();
  }
}

function showError(titleOrErr, errOrMessage) {
  var title = 'Ошибка';
  var message = '';
  var detail = '';
  var hint = '';

  if (errOrMessage === undefined) {
    const h = humanizeError(titleOrErr);
    title = h.title;
    message = h.message;
    detail = h.detail;
    hint = h.hint;
  } else if (errOrMessage && typeof errOrMessage === 'object') {
    const h = humanizeError(errOrMessage);
    title = String(titleOrErr || h.title);
    message = h.message;
    detail = errOrMessage.detail || h.detail || String(errOrMessage.message || errOrMessage);
    hint = h.hint;
  } else {
    title = String(titleOrErr || 'Ошибка');
    message = String(errOrMessage || '');
  }

  showFeedback({ kind: 'err', title: title, message: message, detail: detail, hint: hint });
}

function showSuccess(title, message, detail) {
  showFeedback({ kind: 'ok', title: title || 'Готово', message: message || '', detail: detail || '' });
}

function showWarning(title, message, detail) {
  showFeedback({ kind: 'warn', title: title || 'Внимание', message: message || '', detail: detail || '' });
}

function showLoading(title, sub) {
  loadingDepth += 1;
  if (el.loadingTitle) el.loadingTitle.textContent = title || 'Загрузка…';
  if (el.loadingSub) {
    if (sub) {
      el.loadingSub.hidden = false;
      el.loadingSub.textContent = sub;
    } else {
      el.loadingSub.hidden = true;
      el.loadingSub.textContent = '';
    }
  }
  if (el.loadingOverlay) el.loadingOverlay.hidden = false;
  document.body.classList.add('is-loading');
}

function hideLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth > 0) return;
  if (el.loadingOverlay) el.loadingOverlay.hidden = true;
  document.body.classList.remove('is-loading');
}

async function withLoading(title, fn, sub) {
  showLoading(title, sub);
  try {
    return await fn();
  } finally {
    hideLoading();
  }
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

/** Имя ивента из первой переменной; для Media — имя файла. */
function nameFromFirstVariable(variables) {
  if (!variables || !variables.length) return '';
  const v = variables[0] || {};
  const raw = v.value == null ? '' : String(v.value).trim();
  if (!raw) return '';
  if (isMediaType(v.type)) {
    const parsed = parseMediaValue(raw);
    const label = (parsed.name || parsed.id || raw).trim();
    if (!label) return '';
    const parts = label.split(/[/\\]/);
    return parts[parts.length - 1] || label;
  }
  return raw;
}

function isAutoNameEnabled() {
  try {
    const raw = localStorage.getItem(AUTO_NAME_KEY);
    if (raw == null || raw === '') return true;
    return raw !== '0' && raw !== 'false';
  } catch (e) {
    return true;
  }
}

function setAutoNameEnabled(on) {
  try {
    localStorage.setItem(AUTO_NAME_KEY, on ? '1' : '0');
  } catch (e) { /* ignore */ }
  if (el.autoNameToggle) el.autoNameToggle.checked = !!on;
  updateCreateNamePlaceholders();
  updateCreateActions();
}

function updateCreateNamePlaceholders() {
  const ph = isAutoNameEnabled() ? 'пусто → первая переменная' : 'Имя';
  if (!el.createList) return;
  el.createList.querySelectorAll('[data-field="name"]').forEach(function (input) {
    input.placeholder = ph;
  });
}

async function refreshEventsView() {
  state.allEventsCache = null;
  try {
    if (state.view === 'playlist' && state.playlistId) {
      const data = await api(
        'GET',
        '/api/playlists/' + encodeURIComponent(state.playlistId) + '/events'
      );
      applyEventRows(
        (data.events || []).map(flattenRow),
        state.playlistName || 'Плейлист',
        'плейлист: ' + (state.playlistName || state.playlistId) +
          ' · ' + (data.events || []).length + ' ивентов'
      );
    } else {
      const flat = await fetchAllEvents(true);
      state.view = 'all';
      applyEventRows(flat, 'Все ивенты');
      if (el.eventsTitle) el.eventsTitle.textContent = 'Все ивенты';
      updateScopeButtons();
      renderPlaylists();
    }
  } catch (err) {
    toast(
      'Не удалось обновить список ивентов: ' + (err && err.message ? err.message : err),
      'err'
    );
  }
}

// В Carrot Media-значение хранится как «id;имя» без пробелов вокруг ';'.
function parseMediaValue(raw) {
  const s = raw == null ? '' : String(raw);
  if (!s) return { id: '', name: '' };
  const i = s.indexOf(';');
  if (i === -1) return { id: s, name: '' };
  return { id: s.slice(0, i), name: s.slice(i + 1) };
}

function encodeMediaValue(id, name) {
  if (id == null || String(id) === '') return '';
  return String(id) + ';' + String(name == null ? '' : name);
}

function normalizeMediaValue(raw) {
  const parsed = parseMediaValue(raw);
  if (!parsed.id) return '';
  if (parsed.name) return encodeMediaValue(parsed.id, parsed.name);
  const hit = state.mediaAssets.find(function (m) {
    return String(m.id) === String(parsed.id);
  });
  return hit
    ? encodeMediaValue(hit.id, hit.name || '')
    : encodeMediaValue(parsed.id, '');
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
  // Строго один раздел на экране.
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
      showError('Не удалось подготовить создание', err);
    });
  }
}

function updateSidePaneUi() {
  if (el.sidePane) el.sidePane.hidden = !state.sideOpen;
  if (el.sectionEvents) {
    el.sectionEvents.classList.toggle('with-side', !!state.sideOpen);
  }
  if (el.sideToggleBtn) {
    el.sideToggleBtn.textContent = state.sideOpen ? '‹' : '›';
    el.sideToggleBtn.title = state.sideOpen
      ? 'Скрыть источники'
      : 'Показать источники';
    el.sideToggleBtn.setAttribute('aria-label', el.sideToggleBtn.title);
    el.sideToggleBtn.setAttribute('aria-expanded', state.sideOpen ? 'true' : 'false');
  }
}

function setSideOpen(open) {
  state.sideOpen = !!open;
  try {
    localStorage.setItem(SIDE_OPEN_KEY, state.sideOpen ? '1' : '0');
  } catch (e) { /* ignore */ }
  updateSidePaneUi();
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
      state.mediaHint = data.hint || '';
      if (!state.mediaAssets.length && state.mediaHint) {
        toast('Медиа: ' + state.mediaHint, 'err');
      }
      return state.mediaAssets;
    })
    .catch(function (err) {
      state.mediaLoaded = false;
      state.mediaHint = err.message || String(err);
      throw err;
    })
    .finally(function () {
      state.mediaLoading = null;
    });
  return state.mediaLoading;
}

function fillMediaSelect(select, currentValue) {
  select.innerHTML = '';
  const currentId = parseMediaValue(currentValue).id;
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = state.mediaLoaded
    ? (state.mediaAssets.length ? '— медиа —' : 'Медиа не найдены')
    : 'Загрузка медиа…';
  select.appendChild(empty);
  var matched = false;
  state.mediaAssets.forEach(function (m) {
    const opt = document.createElement('option');
    opt.value = encodeMediaValue(m.id, m.name || '');
    opt.textContent = m.name || m.id;
    if (currentId && String(m.id) === String(currentId)) {
      opt.selected = true;
      matched = true;
    }
    select.appendChild(opt);
  });
  if (currentValue && currentId && !matched) {
    const parsed = parseMediaValue(currentValue);
    const opt = document.createElement('option');
    opt.value = normalizeMediaValue(currentValue);
    opt.textContent = parsed.name || parsed.id;
    opt.selected = true;
    select.appendChild(opt);
  }
}

async function uploadMediaFile(file) {
  if (!file) return null;
  const fd = new FormData();
  fd.append('file', file, file.name);
  const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
  const text = await res.text();
  var json = null;
  try { json = text ? JSON.parse(text) : null; }
  catch (e) { throw new Error('Ответ сервера не JSON (HTTP ' + res.status + ')'); }
  if (!res.ok || (json && json.ok === false)) {
    throw new Error((json && json.error) || ('HTTP ' + res.status));
  }
  const asset = json.asset || {};
  const mediaValue = json.mediaValue || encodeMediaValue(asset.id, asset.name || file.name);
  // Обновить кэш: force reload list, но сразу вставить новый ассет.
  state.mediaLoaded = false;
  try {
    await ensureMediaLoaded(true);
  } catch (e) {
    if (!state.mediaAssets.some(function (m) { return String(m.id) === String(asset.id); })) {
      state.mediaAssets.push({
        id: asset.id,
        name: asset.name || file.name,
        assetTypeInt: asset.assetTypeInt != null ? asset.assetTypeInt : asset.type
      });
      state.mediaLoaded = true;
    }
  }
  if (asset.id && !state.mediaAssets.some(function (m) {
    return String(m.id) === String(asset.id);
  })) {
    state.mediaAssets.push({
      id: asset.id,
      name: asset.name || file.name,
      assetTypeInt: asset.assetTypeInt != null ? asset.assetTypeInt : asset.type
    });
  }
  refreshAllMediaSelects(mediaValue);
  return { asset: asset, mediaValue: mediaValue };
}

function makeVarInput(v, onChange) {
  const val = v.value == null ? '' : String(v.value);
  if (isMediaType(v.type)) {
    const wrap = document.createElement('div');
    wrap.className = 'media-input';
    const select = document.createElement('select');
    select.className = 'media-select';
    fillMediaSelect(select, val);
    select.addEventListener('click', function (ev) { ev.stopPropagation(); });
    select.addEventListener('change', function () {
      onChange(normalizeMediaValue(select.value));
    });
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn ghost sm media-upload-btn';
    upBtn.title = 'Загрузить файл в Carrot';
    upBtn.textContent = '↑';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.hidden = true;
    fileInput.accept = 'image/*,video/*,.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.webp,.mp4,.mov,.avi,.mxf,.webm';
    upBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      fileInput.click();
    });
    fileInput.addEventListener('change', async function () {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      upBtn.disabled = true;
      try {
        const result = await withLoading(
          'Загрузка медиа в Carrot…',
          function () { return uploadMediaFile(file); },
          file.name
        );
        if (result && result.mediaValue) {
          fillMediaSelect(select, result.mediaValue);
          onChange(result.mediaValue);
          toast('Медиа загружено: ' + (result.asset.name || file.name), 'ok');
        }
      } catch (err) {
        showError('Не удалось загрузить медиа', err);
      } finally {
        upBtn.disabled = false;
      }
    });
    if (!state.mediaLoaded) {
      ensureMediaLoaded(false).then(function () {
        fillMediaSelect(select, select.value || val);
      }).catch(function (err) {
        toast('Медиа: ' + err.message, 'err');
      });
    }
    wrap.appendChild(select);
    wrap.appendChild(upBtn);
    wrap.appendChild(fileInput);
    // Совместимость с сохранением переменных: value/_currentValue на обёртке.
    Object.defineProperty(wrap, 'value', {
      get: function () { return select.value; },
      set: function (v) { fillMediaSelect(select, v || ''); },
      configurable: true
    });
    return wrap;
  }

  if (v.type === 'Boolean') {
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.className = 'var-boolean-toggle';

    const currentValStr = v.value != null ? String(v.value).toLowerCase().trim() : '';
    let isTrue = (currentValStr === '1' || currentValStr === 'true' || v.value === true);
    function updateToggleState() {
      input.value = isTrue ? 'ВКЛЮЧЕНО' : 'ВЫКЛЮЧЕНО';
      if (isTrue) {
        input.classList.add('active-true');
        input.classList.remove('active-false');
      } else {
        input.classList.add('active-false');
        input.classList.remove('active-true');
      }
    }
    updateToggleState();
    input.addEventListener('click', function (ev) {
      ev.stopPropagation();
      isTrue = !isTrue;
      updateToggleState();
      onChange(isTrue ? '1' : '0');
    });
    return input;
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
    wrap.innerHTML = '<p class="editor-empty">У ивента нет переменных</p>';
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
  saveBtn.textContent = 'Сохранить изменение';
  saveBtn.addEventListener('click', async function () {
    const byName = Object.create(null);
    const typeByName = Object.create(null);
    all.forEach(function (v) {
      byName[v.name] = v.value == null ? '' : String(v.value);
      typeByName[v.name] = v.type;
    });
    inputs.forEach(function (inp) {
      byName[inp.dataset.varName] =
        inp._currentValue != null ? inp._currentValue : inp.value;
    });
    const full = Object.keys(byName).map(function (name) {
      var value = byName[name];
      if (isMediaType(typeByName[name])) value = normalizeMediaValue(value);
      return { name: name, value: value };
    });
    saveBtn.disabled = true;
    try {
      await withLoading('Сохранение переменных…', function () {
        return api('PATCH', '/api/events/' + encodeURIComponent(eventId) + '/variables', full);
      });
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
      showError('Не удалось сохранить переменные', err);
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
  el.deleteBtn.textContent = n > 1 ? ('Удалить ивент (' + n + ')') : 'Удалить ивент';

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
      : ('Выбрано ивентов: ' + n);
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
	tab.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const targetCard = el.editorBody.querySelector(`details.event-card[data-event-id="${item.id}"]`);
      if (targetCard) {
        const summary = targetCard.querySelector('summary');
        if (summary) {
          summary.click(); 
        }
      }

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
    if (loaded.length > 1) {
      card.addEventListener('toggle', function () {
        if (!card.open) return;
        el.editorBody.querySelectorAll('details.event-card').forEach(function (d) {
          if (d !== card) d.open = false;
        });
      });
    }
    card.addEventListener('click', function () {
      const allCards = Array.from(el.editorBody.querySelectorAll('details.event-card'));
      const clickedIndex = allCards.indexOf(card);
      if (clickedIndex === -1) return;
      el.editorTabs.querySelectorAll('.editor-tab').forEach(function (t, tabIndex) {
        t.classList.toggle('active', tabIndex === clickedIndex);
      });
      document.querySelectorAll('tr.selected').forEach(function (row, rowIndex) {
        row.classList.toggle('main-table-row-selected', rowIndex === clickedIndex);
      });
    });
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
  if (m10 === 1 && m100 !== 11) return '';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'а';
  return 'ов';
}

function allEventsHint(flat) {
  const total = flat.length;
  if (state.allEventsScope === 'recent') {
    const recent = flat.filter(isRecentRow).length;
    return recent + ' ивент' + plural(recent) + ' за 2 недели · всего в базе ' + total;
  }
  return total + ' ивент' + plural(total) + ' · вся база';
}

function allEventsStatus(flat) {
  if (state.allEventsScope === 'recent') {
    return 'все ивенты · за 2 недели · ' + flat.filter(isRecentRow).length + '/' + flat.length;
  }
  return 'все ивенты · ' + flat.length;
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
    el.eventsHint.textContent = flat.length + ' ивент' + plural(flat.length);
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
    el.eventsEmpty.textContent = 'Выбери «Все ивенты» или плейлист слева';
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
      ? ''
      : 'В этом плейлисте нет ивентов';
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
  el.eventsTitle.textContent = 'Все ивенты';
  el.deleteBtn.disabled = true;
  el.deleteBtn.textContent = 'Удалить ивент';
  el.editorPanel.hidden = true;
  updateScopeButtons();

  if (!force && state.allEventsCache) {
    applyEventRows(state.allEventsCache, 'Все ивенты');
    if (!state.allEventsLoading) {
      state.allEventsLoading = true;
      fetchAllEvents(false)
        .then(function (flat) {
          if (state.view !== 'all') return;
          applyEventRows(flat, 'Все ивенты');
        })
        .catch(function () { /* cache */ })
        .finally(function () { state.allEventsLoading = false; });
    }
    return;
  }

  state.rows = [];
  el.eventsHint.textContent = 'Загрузка…';
  renderTable();
  const quiet = !!(opts && opts.quiet);
  if (!quiet) showLoading('Загрузка ивентов…', 'Вся база');
  try {
    state.allEventsLoading = true;
    const flat = await fetchAllEvents(force);
    applyEventRows(flat, 'Все ивенты');
  } catch (err) {
    el.eventsHint.textContent = 'Ошибка загрузки';
    setStatus('ошибка загрузки', 'err');
    if (!quiet) showError('Не удалось загрузить ивенты', err);
    else throw err;
  } finally {
    state.allEventsLoading = false;
    if (!quiet) hideLoading();
  }
}

async function selectPlaylist(pl) {
  state.view = 'playlist';
  state.playlistId = pl.id;
  state.playlistName = pl.name || pl.id;
  clearSelection();
  state.rows = [];
  setSection('events');
  if (!state.sideOpen) setSideOpen(true);
  renderPlaylists();
  el.eventsTitle.textContent = state.playlistName;
  el.eventsHint.textContent = 'Загрузка ивентов…';
  el.deleteBtn.disabled = true;
  el.editorPanel.hidden = true;
  updateScopeButtons();
  renderTable();
  try {
    const data = await withLoading(
      'Загрузка ивентов…',
      function () {
        return api('GET', '/api/playlists/' + encodeURIComponent(pl.id) + '/events');
      },
      state.playlistName
    );
    applyEventRows(
      (data.events || []).map(flattenRow),
      state.playlistName,
      'плейлист: ' + state.playlistName + ' · ' + (data.events || []).length + ' ивентов'
    );
  } catch (err) {
    el.eventsHint.textContent = 'Ошибка загрузки';
    setStatus('ошибка загрузки', 'err');
    showError('Не удалось загрузить плейлист', err);
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

function hostPortFromBaseUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : ('http://' + raw);
    const u = new URL(withScheme);
    if (!u.hostname) return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return u.host;
  } catch (e) {
    return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

/** Собрать Base URL для API: всегда http://IP:порт */
function baseUrlFromHostPort(hostPort) {
  let s = String(hostPort || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/.*$/, '');
  if (!s) return '';
  return 'http://' + s;
}

function syncConnectionFields(opts) {
  opts = opts || {};
  const url = opts.baseUrl != null ? String(opts.baseUrl).trim() : '';
  const login = opts.login != null ? String(opts.login).trim() : '';
  const password = opts.password != null ? String(opts.password) : null;
  const hostPort = opts.baseUrl != null ? hostPortFromBaseUrl(url) : null;

  if (hostPort != null) {
    if (el.baseUrl) el.baseUrl.value = hostPort;
    if (el.settingsBaseUrl) el.settingsBaseUrl.value = hostPort;
  }
  if (opts.login != null) {
    if (el.login) el.login.value = login;
    if (el.settingsLogin) el.settingsLogin.value = login;
  }
  if (password != null) {
    if (el.password) el.password.value = password;
    if (el.settingsPassword) el.settingsPassword.value = password;
  }
}

function clearLegacyCredentialStorage() {
  try {
    localStorage.removeItem('carrot-base-url');
    localStorage.removeItem('carrot-login');
    localStorage.removeItem('carrot-password');
  } catch (e) { /* ignore */ }
}

async function connect(creds) {
  el.connectBtn.disabled = true;
  setStatus('подключение…');
  try {
    await withLoading('Подключение к Carrot…', async function () {
      const data = await api('POST', '/api/connect', creds);
      state.connected = true;
      el.connectPanel.hidden = true;
      el.workspace.hidden = false;
      el.sectionTabs.hidden = false;
      syncConnectionFields({
        baseUrl: data.baseUrl || (creds && creds.baseUrl) || '',
        login: data.login || (creds && creds.login) || '',
        password: (creds && creds.password) != null
          ? creds.password
          : (el.password && el.password.value) || ''
      });
      clearLegacyCredentialStorage();
      setStatus('онлайн · ' + data.baseUrl, 'ok');
      updateSidePaneUi();
      if (el.loadingTitle) el.loadingTitle.textContent = 'Загрузка плейлистов и ивентов…';
      if (el.loadingSub) {
        el.loadingSub.hidden = false;
        el.loadingSub.textContent = data.baseUrl || '';
      }
      await loadPlaylists();
      state.allEventsScope = 'recent';
      await selectAllEvents({ quiet: true });
      toast('Подключено к ' + data.baseUrl, 'ok');
    }, 'Проверяем доступ к REST API');
  } catch (err) {
    setStatus('не подключено', 'err');
    showError('Не удалось подключиться', err);
    throw err;
  } finally {
    el.connectBtn.disabled = false;
  }
}

async function applyConnectionFromSettings() {
  const hostPort = el.settingsBaseUrl ? el.settingsBaseUrl.value.trim() : '';
  const url = baseUrlFromHostPort(hostPort);
  const login = el.settingsLogin ? el.settingsLogin.value.trim() : '';
  const password = el.settingsPassword ? el.settingsPassword.value : '';
  if (!url) {
    showWarning('Нет адреса', 'Укажи IP:порт, например 172.17.97.71:5001');
    return;
  }
  if (!login) {
    showWarning('Нет логина', 'Укажи логин Carrot.');
    return;
  }
  if (!password) {
    showWarning('Нет пароля', 'Укажи пароль Carrot.');
    return;
  }
  if (el.settingsConnectionSaveBtn) el.settingsConnectionSaveBtn.disabled = true;
  try {
    await withLoading('Сохранение в .env…', async function () {
      const payload = { baseUrl: url, login: login, password: password };
      const data = await api('POST', '/api/settings/connection', payload);
      syncConnectionFields({
        baseUrl: data.baseUrl || url,
        login: data.login || login,
        password: password
      });
      clearLegacyCredentialStorage();
      state.connected = true;
      el.connectPanel.hidden = true;
      el.workspace.hidden = false;
      el.sectionTabs.hidden = false;
      setStatus('онлайн · ' + data.baseUrl, 'ok');
      state.allEventsCache = null;
      state.mediaLoaded = false;
      state.templatesLoaded = false;
      state.eventDetails = Object.create(null);
      clearSelection();
      await loadPlaylists();
      state.allEventsScope = 'recent';
      await selectAllEvents({ force: true, quiet: true });
      toast('Сохранено в .env · ' + (data.login || login) + ' @ ' + data.baseUrl, 'ok');
    }, url);
  } catch (err) {
    showError('Не удалось сохранить подключение', err);
  } finally {
    if (el.settingsConnectionSaveBtn) el.settingsConnectionSaveBtn.disabled = false;
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
    el.confirmText.textContent = 'Будет удалено ивентов: ' + ids.length + '. Это необратимо.';
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
    const data = await withLoading(
      'Удаление ивентов…',
      function () { return api('POST', '/api/events/delete', { ids: ids }); },
      'Удаляется: ' + ids.length
    );
    const deleted = (data && data.deleted) ? data.deleted : [];
    const failed = (data && data.failed) ? data.failed : [];
    if (failed.length) {
      showWarning(
        'Удаление завершено с ошибками',
        'Удалено: ' + deleted.length + ', ошибок: ' + failed.length + '.',
        failed.map(function (f) { return (f.id || '') + ': ' + (f.error || ''); }).join('\n')
      );
    } else {
      toast('Удалено: ' + deleted.length, 'ok');
    }
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
    if (state.view === 'all') applyEventRows(state.rows, 'Все ивенты');
    else if (state.view === 'playlist') {
      applyEventRows(
        state.rows,
        state.playlistName,
        'плейлист: ' + state.playlistName + ' · ' + state.rows.length + ' ивентов'
      );
    } else renderTable();
  } catch (err) {
    showError('Не удалось удалить ивенты', err);
    updateSelectionUi();
  } finally {
    el.deleteBtn.disabled = false;
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

function createFormHasName(f) {
  if (String(f.name || '').trim()) return true;
  if (!isAutoNameEnabled()) return false;
  return !!nameFromFirstVariable(f.variables || []);
}

function updateCreateActions() {
  const n = createSelectedCount();
  const ready = state.createForms.filter(function (f) {
    return f.templateId && createFormHasName(f);
  }).length;
  el.createRemoveBtn.disabled = n === 0;
  el.createRemoveBtn.textContent = n > 1 ? ('Удалить выбранные (' + n + ')') : 'Удалить выбранные';
  el.createClearBtn.disabled = state.createForms.length === 0;
  el.createSubmitBtn.disabled = ready === 0;
  el.createSubmitBtn.textContent = ready > 1 ? ('Создать (' + ready + ')') : 'Создать';
  el.createHint.style.whiteSpace = 'pre-line';
  el.createHint.textContent = n > 1
    ? ('Выбрано полей: ' + n + ' — имя, External id, шаблон и переменные применяются ко всем выбранным.')
    : 'Добавь + ивент или «Импорт Excel» (шаблон выбирается в диалоге).\nExcel: 1-й столбец = имя, последний = External id, середина = переменные (Media = имя файла).\nПапка медиа — в боковом меню → Настройки.';
}

async function ensureTemplatesLoaded(force) {
  if (state.templatesLoaded && !force) return state.templates;
  const data = await api('GET', '/api/templates');
  state.templates = data.templates || [];
  state.templatesLoaded = true;
  fillExcelTemplateSelect();
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
		targets.forEach(function (f) {
		applyTemplateToForm(f, tpl);
	});

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
  targetCreateForms(localId).forEach(function (f) {
    f.name = name;
  });

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
		const hit = f.variables.find(function (v) {
			return v.name === varName;
			});

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
    el.createList.innerHTML = '<p class="empty"> </p>';
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

    const nameInput = field('Имя ивента', 'name', function () {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = form.name || '';
      input.placeholder = isAutoNameEnabled() ? 'пусто → первая переменная' : 'Имя';
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
      input.placeholder = ' ';
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
    .filter(function (f) { return !!f.templateId; })
    .map(function (f) {
      const variables = (f.variables || []).map(function (v) {
        var value = v.value == null ? '' : String(v.value);
        if (isMediaType(v.type)) value = normalizeMediaValue(value);
        return {
          id: v.id,
          name: v.name,
          type: v.type,
          value: value,
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
      });
      const autoName = isAutoNameEnabled();
      const name = String(f.name || '').trim() ||
        (autoName ? nameFromFirstVariable(variables) : '');
      return {
        name: name,
        externalId: String(f.externalId || '').trim(),
        templateId: f.templateId,
        contentId: f.contentId,
        templateTypeInt: f.templateTypeInt,
        state: f.state || 'IN',
        comment: f.comment || '',
        variables: variables
      };
    })
    .filter(function (e) { return !!e.name; });

  if (!payload.length) {
    showWarning(
      'Нечего создавать',
      isAutoNameEnabled()
        ? 'Укажи шаблон и имя (или значение первой переменной) хотя бы у одного ивента.'
        : 'Укажи шаблон и имя хотя бы у одного ивента.'
    );
    return;
  }

  el.createSubmitBtn.disabled = true;
  try {
    const data = await withLoading(
      'Создание ивентов…',
      function () {
        return api('POST', '/api/events/create', {
          events: payload,
          autoName: isAutoNameEnabled()
        });
      },
      'К созданию: ' + payload.length
    );
    const created = (data && data.created) ? data.created : [];
    showSuccess('Ивенты созданы', 'Создано: ' + created.length + '.');
    state.createForms = [blankCreateForm()];
    setCreateSelection([], null);
    renderCreateForms();
    await refreshEventsView();
  } catch (err) {
    showError('Не удалось создать ивенты', err);
    setStatus('ошибка создания', 'err');
    updateCreateActions();
  }
}

/* ---------------- Events wiring ---------------- */

el.connectForm.addEventListener('submit', function (e) {
  e.preventDefault();
  connect({
    baseUrl: baseUrlFromHostPort(el.baseUrl.value) || undefined,
    login: el.login.value.trim() || undefined,
    password: el.password.value || undefined
  }).catch(function () { /* toasted */ });
});

el.tabEvents.addEventListener('click', function () { setSection('events'); });
el.tabCreate.addEventListener('click', function () { setSection('create'); });

el.allEventsBtn.addEventListener('click', function () { selectAllEvents(); });
el.sideToggleBtn.addEventListener('click', function () {
  setSideOpen(!state.sideOpen);
});

el.reloadPlaylists.addEventListener('click', function () {
  loadPlaylists()
    .then(function () {
      if (state.view === 'all') return selectAllEvents({ force: true });
      if (state.view === 'playlist' && state.playlistId) {
        return selectPlaylist({ id: state.playlistId, name: state.playlistName });
      }
    })
    .catch(function (err) { showError('Не удалось обновить данные', err); });
});

el.loadAllBtn.addEventListener('click', function () {
  state.allEventsScope = 'all';
  if (state.allEventsCache) applyEventRows(state.allEventsCache, 'Все ивенты');
  else selectAllEvents({ force: true, scope: 'all' });
});

el.loadRecentBtn.addEventListener('click', function () {
  state.allEventsScope = 'recent';
  if (state.allEventsCache) applyEventRows(state.allEventsCache, 'Все ивенты');
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

if (el.mediaUploadBtn && el.mediaUploadInput) {
  el.mediaUploadBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    el.mediaUploadInput.click();
  });
  el.mediaUploadInput.addEventListener('change', async function () {
    const file = el.mediaUploadInput.files && el.mediaUploadInput.files[0];
    el.mediaUploadInput.value = '';
    if (!file) return;
    el.mediaUploadBtn.disabled = true;
    try {
      const result = await withLoading(
        'Загрузка медиа в Carrot…',
        function () { return uploadMediaFile(file); },
        file.name
      );
      toast('Медиа загружено: ' + ((result && result.asset && result.asset.name) || file.name), 'ok');
    } catch (err) {
      showError('Не удалось загрузить медиа', err);
    } finally {
      el.mediaUploadBtn.disabled = false;
    }
  });
}


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
updateSidePaneUi();
applyEditorFoldClass();
// На старте гарантируем, что создание скрыто.
el.sectionCreate.hidden = true;
el.sectionEvents.hidden = false;

(async function boot() {
  try {
    clearLegacyCredentialStorage();
    const health = await api('GET', '/api/health');
    const d = health.defaults || {};
    syncConnectionFields({
      baseUrl: d.baseUrl || '',
      login: d.login || '',
      password: d.password || ''
    });

    if (health.hasEnv) {
      await connect({});
    } else {
      setStatus('заполни .env или форму подключения');
    }
  } catch (err) {
    setStatus('не подключено', 'err');
    showError('Не удалось запустить интерфейс', err);
  }
})();

function addSmartNumberedPostfix() {
	  const hasSelectedCard = document.querySelector('.create-card.selected') !== null;
 
  if (hasSelectedCard) {
    alert('Нельзя нумеровать если не задан внешний ID или есть активное выделение! Сбросьте выделение двойным кликом по одной карточке.');
    return;
  }
  const allCards = Array.from(document.querySelectorAll('.create-card'));
  
  if (allCards.length === 0) {
    alert('На странице нет ни одной карточки для нумерации!');
    return;
  }
  
  const nameCounters = {};

  let updatedCount = 0;

  allCards.forEach((card) => {
const eddiInput = card.querySelector('[data-field="externalId"]');

    if (eddiInput && eddiInput.value.trim()) {
      let currentName = eddiInput.value.trim().replace(/_\d+\$/, '');
      if (!nameCounters[currentName]) {
        nameCounters[currentName] = 1;
      } else {
        nameCounters[currentName] += 1;
      }

      const currentNumber = nameCounters[currentName];
      const postfix = String(currentNumber).padStart(3, '0');
      eddiInput.value = currentName + '_' + postfix;
      eddiInput.dispatchEvent(new Event('input', { bubbles: true }));
      eddiInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      updatedCount++;
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  const myCounterButton = document.getElementById('counterExID');
  
  if (myCounterButton) {
    myCounterButton.addEventListener('click', function (ev) {
      ev.preventDefault();
      addSmartNumberedPostfix();
    });
  }
});


var mediaDirHandle = null;
var mediaPickedFiles = [];

function getMediaFolderLabel() {
  try { return localStorage.getItem(MEDIA_FOLDER_KEY) || ''; }
  catch (e) { return ''; }
}

function setMediaFolderLabel(name) {
  const v = String(name || '').trim();
  try {
    if (v) localStorage.setItem(MEDIA_FOLDER_KEY, v);
    else localStorage.removeItem(MEDIA_FOLDER_KEY);
  } catch (e) { /* ignore */ }
  if (el.mediaFolderPath) {
    el.mediaFolderPath.textContent = v ? v : 'папка не выбрана';
  }
  return v;
}

function folderLabelFromFiles(files) {
  if (!files || !files.length) return 'выбранная папка';
  const rel = files[0].webkitRelativePath || '';
  if (rel) {
    const top = String(rel).split(/[/\\]/)[0];
    if (top) return top;
  }
  return 'выбранная папка (' + files.length + ')';
}

function pickMediaFolderViaInput() {
  if (!el.mediaFolderFallbackInput) {
    showWarning(
      'Выбор папки недоступен',
      'Браузер не даёт выбрать папку. Открой UI на localhost через web.cmd или обнови Chrome/Edge.'
    );
    return;
  }
  el.mediaFolderFallbackInput.value = '';
  el.mediaFolderFallbackInput.click();
}

async function pickMediaFolder() {
  const secureOk = window.isSecureContext !== false;
  const hasPicker = typeof window.showDirectoryPicker === 'function';
  // По http://LAN-IP showDirectoryPicker отсутствует или бесполезен.
  if (hasPicker && secureOk) {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      mediaDirHandle = handle;
      mediaPickedFiles = [];
      setMediaFolderLabel(handle.name || 'выбранная папка');
      toast('Папка медиа: ' + (handle.name || 'выбрана'), 'ok');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      // Если API есть, но упал (редкий случай) — fallback на input.
      toast('Directory picker недоступен, открываю обычный выбор папки…', 'err');
    }
  }
  pickMediaFolderViaInput();
}

function onMediaFolderFallbackPicked() {
  const input = el.mediaFolderFallbackInput;
  const list = input && input.files ? Array.prototype.slice.call(input.files) : [];
  if (!list.length) return;
  mediaDirHandle = null;
  mediaPickedFiles = list;
  const label = folderLabelFromFiles(list);
  setMediaFolderLabel(label);
  toast('Папка медиа: ' + label + ' · файлов: ' + list.length, 'ok');
}

function clearMediaFolder() {
  mediaDirHandle = null;
  mediaPickedFiles = [];
  if (el.mediaFolderFallbackInput) el.mediaFolderFallbackInput.value = '';
  setMediaFolderLabel('');
  toast('Папка медиа сброшена', 'ok');
}

async function collectMediaFilesFromDir(dirHandle) {
  const out = [];
  if (!dirHandle) return out;
  async function walk(handle) {
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        out.push(file);
      } else if (entry.kind === 'directory') {
        await walk(entry);
      }
    }
  }
  await walk(dirHandle);
  return out;
}

async function collectSelectedMediaFiles() {
  if (mediaDirHandle) return collectMediaFilesFromDir(mediaDirHandle);
  if (mediaPickedFiles && mediaPickedFiles.length) return mediaPickedFiles.slice();
  return [];
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark-theme', dark);
  try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); }
  catch (e) { /* ignore */ }
  if (el.themeToggleBtn) {
    el.themeToggleBtn.textContent = dark ? 'Тема: тёмная' : 'Тема: светлая';
  }
}

function currentTheme() {
  return document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light';
}

function fillExcelTemplateSelect() {
  if (!el.excelTemplateSelect) return;
  const cur = el.excelTemplateSelect.value || '';
  el.excelTemplateSelect.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = state.templatesLoaded ? '— выбери шаблон —' : 'Загрузка шаблонов…';
  el.excelTemplateSelect.appendChild(empty);
  (state.templates || []).forEach(function (t) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name || t.id;
    if (t.id === cur) opt.selected = true;
    el.excelTemplateSelect.appendChild(opt);
  });
  if (el.excelPickFileBtn) {
    el.excelPickFileBtn.disabled = !el.excelTemplateSelect.value;
  }
}

async function openExcelImportDialog() {
  fillExcelTemplateSelect();
  if (el.excelPickFileBtn) {
    el.excelPickFileBtn.disabled = !(el.excelTemplateSelect && el.excelTemplateSelect.value);
  }
  if (el.excelImportDialog && el.excelImportDialog.showModal) {
    el.excelImportDialog.showModal();
  }
  try {
    await ensureTemplatesLoaded(false);
    fillExcelTemplateSelect();
  } catch (err) {
    toast('Шаблоны: ' + err.message, 'err');
  }
  if (el.excelPickFileBtn) {
    el.excelPickFileBtn.disabled = !(el.excelTemplateSelect && el.excelTemplateSelect.value);
  }
}

async function importEventsFromExcel(file) {
  if (!file) return;
  const templateId = el.excelTemplateSelect && el.excelTemplateSelect.value;
  if (!templateId) {
    showWarning('Нужен шаблон', 'Сначала выбери шаблон в диалоге импорта Excel.');
    return;
  }
  const folderLabel = getMediaFolderLabel();
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('templateId', templateId);
  fd.append('autoName', isAutoNameEnabled() ? '1' : '0');

  const mediaFiles = await collectSelectedMediaFiles();
  mediaFiles.forEach(function (mf) {
    fd.append('mediaFiles', mf, mf.name);
  });

  const json = await withLoading(
    'Импорт Excel…',
    async function () {
      const res = await fetch('/api/events/import-excel', { method: 'POST', body: fd });
      const text = await res.text();
      var parsed = null;
      try { parsed = text ? JSON.parse(text) : null; }
      catch (e) { throw new Error('Ответ сервера не JSON (HTTP ' + res.status + ')'); }
      if (!res.ok || (parsed && parsed.ok === false)) {
        const err = new Error((parsed && parsed.error) || ('HTTP ' + res.status));
        const missing = (parsed && parsed.media &&
          (parsed.media.missing || parsed.media.warnings)) || [];
        if (missing.length) {
          err.detail = missing.map(function (w) {
            return 'Строка ' + (w.row || '?') +
              (w.variable ? ' [' + w.variable + ']' : '') +
              ': ' + (w.file || '') + ' — ' + (w.reason || '');
          }).join('\n');
        }
        throw err;
      }
      return parsed;
    },
    file.name + (folderLabel ? '\nПапка медиа: ' + folderLabel : '')
  );

  const created = (json && json.created) ? json.created : [];
  const skipped = (json && json.skipped) ? json.skipped : [];
  const media = (json && json.media) ? json.media : {};
  state.mediaLoaded = false;

  var lines = ['Создано ивентов: ' + created.length + '.'];
  if (skipped.length) lines.push('Пропущено строк: ' + skipped.length + '.');
  if (media.uploaded) lines.push('Загружено медиа в Carrot: ' + media.uploaded + '.');
  if (media.reused) lines.push('Медиа уже было в Carrot: ' + media.reused + '.');
  var detail = '';
  if (skipped.length) {
    detail = skipped.map(function (s) {
      return 'Строка ' + (s.row || '?') + ': ' + (s.reason || '');
    }).join('\n');
  }

  if (!created.length) {
    showError('Импорт Excel не создал ивенты', lines.join(' '), detail);
  } else if (skipped.length) {
    showWarning('Импорт завершён с замечаниями', lines.join('\n'), detail);
  } else {
    showSuccess('Импорт Excel выполнен', lines.join('\n'));
  }
  if (created.length) await refreshEventsView();
  return json;
}

if (el.excelImportBtn) {
  el.excelImportBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    openExcelImportDialog().catch(function (err) {
      showError('Не удалось открыть импорт Excel', err);
    });
  });
}
if (el.excelTemplateSelect) {
  el.excelTemplateSelect.addEventListener('change', function () {
    if (el.excelPickFileBtn) {
      el.excelPickFileBtn.disabled = !el.excelTemplateSelect.value;
    }
  });
}
if (el.excelPickFileBtn && el.excelImportInput) {
  el.excelPickFileBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (!el.excelTemplateSelect || !el.excelTemplateSelect.value) {
      showWarning('Нужен шаблон', 'Сначала выбери шаблон.');
      return;
    }
    el.excelImportInput.click();
  });
  el.excelImportInput.addEventListener('change', async function () {
    const file = el.excelImportInput.files && el.excelImportInput.files[0];
    el.excelImportInput.value = '';
    if (!file) return;
    el.excelPickFileBtn.disabled = true;
    try {
      await importEventsFromExcel(file);
      if (el.excelImportDialog && el.excelImportDialog.open) {
        el.excelImportDialog.close();
      }
    } catch (err) {
      showError('Не удалось импортировать Excel', err);
    } finally {
      el.excelPickFileBtn.disabled = !(el.excelTemplateSelect && el.excelTemplateSelect.value);
    }
  });
}
if (el.excelImportForm) {
  el.excelImportForm.addEventListener('submit', function () {
    /* method=dialog cancel */
  });
}

setMediaFolderLabel(getMediaFolderLabel());
if (el.mediaFolderPickBtn) {
  el.mediaFolderPickBtn.addEventListener('click', function () {
    pickMediaFolder();
  });
}
if (el.mediaFolderClearBtn) {
  el.mediaFolderClearBtn.addEventListener('click', function () {
    clearMediaFolder();
  });
}
if (el.mediaFolderFallbackInput) {
  el.mediaFolderFallbackInput.addEventListener('change', function () {
    onMediaFolderFallbackPicked();
  });
}
if (el.settingsConnectionSaveBtn) {
  el.settingsConnectionSaveBtn.addEventListener('click', function () {
    applyConnectionFromSettings();
  });
}
['settingsBaseUrl', 'settingsLogin', 'settingsPassword'].forEach(function (key) {
  const node = el[key];
  if (!node) return;
  node.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyConnectionFromSettings();
    }
  });
});

applyTheme(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light');
if (el.themeToggleBtn) {
  el.themeToggleBtn.addEventListener('click', function () {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}
if (el.autoNameToggle) {
  el.autoNameToggle.checked = isAutoNameEnabled();
  el.autoNameToggle.addEventListener('change', function () {
    setAutoNameEnabled(!!el.autoNameToggle.checked);
  });
}

document.addEventListener('click', function (event) {
  const menu = document.getElementById('colsMenu');
  if (menu && menu.hasAttribute('open') && !menu.contains(event.target)) {
    menu.removeAttribute('open');
  }
});

/* ===== DEV traffic panel ===== */
(function initDevTrafficPanel() {
  const panel = document.getElementById('devTrafficPanel');
  const fab = document.getElementById('devTrafficFab');
  const listEl = document.getElementById('devTrafficList');
  const detailEl = document.getElementById('devTrafficDetail');
  const statsEl = document.getElementById('devTrafficStats');
  const pauseBtn = document.getElementById('devTrafficPauseBtn');
  const clearBtn = document.getElementById('devTrafficClearBtn');
  const closeBtn = document.getElementById('devTrafficCloseBtn');
  const uiCb = document.getElementById('devTrafficUi');
  const carrotCb = document.getElementById('devTrafficCarrot');
  if (!panel || !fab || !listEl || !detailEl) return;

  const OPEN_KEY = 'carrot-dev-traffic-open';
  var entriesById = Object.create(null);
  var order = [];
  var selectedId = null;
  var paused = false;
  var timer = null;

  function wantOpen() {
    try {
      if (localStorage.getItem(OPEN_KEY) === '1') return true;
    } catch (e) { /* ignore */ }
    return /(?:^|[?&])dev=1(?:&|$)/.test(location.search);
  }

  function setOpen(open) {
    panel.hidden = !open;
    fab.hidden = !!open;
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) { /* ignore */ }
    if (open) startPoll();
    else stopPoll();
  }

  function stopPoll() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function startPoll() {
    stopPoll();
    poll();
    timer = setInterval(poll, 1000);
  }

  function channelAllowed(ch) {
    if (ch === 'ui') return !uiCb || uiCb.checked;
    if (ch === 'carrot') return !carrotCb || carrotCb.checked;
    return true;
  }

  function statusClass(st) {
    if (st == null) return 'dev-st-err';
    if (st >= 200 && st < 400) return 'dev-st-ok';
    return 'dev-st-err';
  }

  function shortUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url, location.origin);
      return u.pathname + (u.search ? '?…' : '');
    } catch (e) {
      return String(url).slice(0, 80);
    }
  }

  function renderList() {
    listEl.innerHTML = '';
    order.forEach(function (id) {
      const e = entriesById[id];
      if (!e || !channelAllowed(e.channel)) return;
      const li = document.createElement('li');
      if (id === selectedId) li.className = 'active';
      li.dataset.id = id;
      const ch = document.createElement('span');
      ch.className = 'dev-ch' + (e.channel === 'ui' ? ' ui' : '');
      ch.textContent = e.channel || '?';
      const st = document.createElement('span');
      st.className = statusClass(e.status);
      st.textContent = ' ' + (e.status != null ? e.status : 'ERR') + ' ';
      const meta = document.createElement('span');
      meta.className = 'dev-meta';
      meta.textContent = (e.method || '') + ' ' + shortUrl(e.url) +
        (e.durationMs != null ? ' · ' + e.durationMs + 'ms' : '') +
        (e.note ? ' · ' + e.note : '') +
        (e.error ? ' · ' + e.error : '');
      li.appendChild(ch);
      li.appendChild(st);
      li.appendChild(meta);
      li.addEventListener('click', function () {
        selectedId = id;
        renderList();
        renderDetail(e);
      });
      listEl.appendChild(li);
    });
  }

  function renderDetail(e) {
    if (!e) {
      detailEl.textContent = 'Выбери запрос слева';
      return;
    }
    const payload = {
      id: e.id,
      ts: e.ts ? new Date(e.ts * 1000).toISOString() : null,
      channel: e.channel,
      method: e.method,
      url: e.url,
      status: e.status,
      durationMs: e.durationMs,
      note: e.note,
      error: e.error,
      requestHeaders: e.requestHeaders,
      requestBody: e.requestBody,
      responseHeaders: e.responseHeaders,
      responseBody: e.responseBody
    };
    detailEl.textContent = JSON.stringify(payload, null, 2);
  }

  function mergeEntries(list) {
    (list || []).forEach(function (e) {
      if (!e || !e.id) return;
      if (!entriesById[e.id]) order.unshift(e.id);
      entriesById[e.id] = e;
    });
    if (order.length > 400) {
      const drop = order.splice(400);
      drop.forEach(function (id) { delete entriesById[id]; });
    }
  }

  async function poll() {
    if (paused || panel.hidden) return;
    try {
      const data = await api('GET', '/api/dev/traffic?limit=120');
      mergeEntries(data.entries || []);
      if (statsEl && data.stats) {
        statsEl.textContent = 'всего ' + data.stats.total +
          ' · ui ' + data.stats.ui +
          ' · carrot ' + data.stats.carrot;
      }
      renderList();
      if (selectedId && entriesById[selectedId]) renderDetail(entriesById[selectedId]);
    } catch (err) {
      if (statsEl) statsEl.textContent = 'ошибка опроса: ' + (err.message || err);
    }
  }

  fab.addEventListener('click', function () { setOpen(true); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
      if (!paused) poll();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', async function () {
      try {
        await api('POST', '/api/dev/traffic/clear', {});
        entriesById = Object.create(null);
        order = [];
        selectedId = null;
        renderList();
        renderDetail(null);
        toast('DEV-лог очищен', 'ok');
      } catch (err) {
        showError('Не удалось очистить DEV-лог', err);
      }
    });
  }
  if (uiCb) uiCb.addEventListener('change', renderList);
  if (carrotCb) carrotCb.addEventListener('change', renderList);

  setOpen(wantOpen());
})();
