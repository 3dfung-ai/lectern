/* Lectern: your talks, ready to browse, rehearse and present. Offline first; syncs through your own Google Drive. */
'use strict';
const LECTERN_VERSION = '1.0.0';

/* ============ small helpers ============ */
// Optional parts of a view are written as `cond ? el : null`; never print them as text.
for (const m of ['append', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...a) { return orig.apply(this, a.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false)); };
}
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;
const nowIso = () => new Date().toISOString();
function fmtClock(ms, signed) {
  const neg = ms < 0; ms = Math.abs(Math.round(ms / 1000));
  const hh = Math.floor(ms / 3600), mm = Math.floor((ms % 3600) / 60), ss = ms % 60;
  const t = hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  return (signed ? (neg ? '−' : '+') : (neg ? '−' : '')) + t;
}
function fmtMin(min) { min = Math.round(min); return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim() : `${min} min`; }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); }
function fmtBytes(n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; }
async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64FromBytes(u8) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function bytesFromB64(b64) { const s = atob(b64); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function wordsOf(text) { const m = String(text || '').replace(/\[[^\]]{1,40}\]/g, ' ').match(/[A-Za-z0-9À-ɏ'’-]+/g); return m ? m.length : 0; }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
function copyText(text, msg) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg || 'Copied.'), () => {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(msg || 'Copied.'); } catch (e) { toast('Couldn’t copy. Select and copy it by hand.'); }
    ta.remove();
  });
}

/* ============ icons (simple strokes, 24 grid) ============ */
const ICONS = {
  back: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', prev: 'M15 5l-7 7 7 7', plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', full: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5', unfull: 'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5',
  notes: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', film: 'M3 6h18v12H3zM3 10h18M7 6v4M12 6v4M17 6v4', play: 'M7 4l13 8-13 8z', pause: 'M7 4h4v16H7zM14 4h4v16h-4z',
  stop: 'M6 6h12v12H6z', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z', dots: 'M5 12h.01M12 12h.01M19 12h.01', gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14', upload: 'M12 20V9M7 14l5-5 5 5M5 4h14', flag: 'M5 21V4h11l-2 4 2 4H5', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  close: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10', screen: 'M3 4h18v12H3zM8 20h8M12 16v4', speaker: 'M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11',
  cards: 'M4 6h12v12H4zM8 3h12v12', help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01', sync: 'M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', black: 'M4 4h16v16H4z', audio: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
};
function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ''); svg.append(p);
  if (name === 'play' || name === 'pause' || name === 'stop' || name === 'black') svg.classList.add('fill');
  return svg;
}
function btn(label, opts) {
  opts = opts || {};
  const b = h('button', { type: 'button', class: 'btn' + (opts.primary ? ' primary' : '') + (opts.quiet ? ' quiet' : '') + (opts.cls ? ' ' + opts.cls : ''),
    title: opts.title || (opts.key ? `${label} (${opts.key})` : null), 'aria-label': opts.aria || (opts.iconOnly ? label : null), onclick: opts.onclick, disabled: opts.disabled }, opts.icon ? icon(opts.icon) : null, opts.iconOnly ? null : h('span', { text: label }), opts.key && !opts.iconOnly && !opts.hideKey ? h('kbd', { text: opts.key }) : null);
  return b;
}

/* ============ toasts and dialogs ============ */
function toast(msg, opts) {
  opts = opts || {};
  if (document.body.classList.contains('presenting') && !opts.important) return null;   // nothing pops up mid-talk
  const box = $('#toasts');
  const t = h('div', { class: 'toast' + (opts.kind ? ' ' + opts.kind : ''), role: 'status' }, h('span', { text: msg }),
    opts.action ? h('button', { type: 'button', class: 'tbtn', onclick: () => { opts.action.fn(); t.remove(); } }, opts.action.label) : null,
    h('button', { type: 'button', class: 'tx', 'aria-label': 'Dismiss', onclick: () => t.remove() }, icon('close')));
  box.append(t);
  setTimeout(() => t.remove(), opts.ms || 5000);
  return t;
}
function modal(o) {
  closeModal();
  const back = h('div', { class: 'scrim', onclick: e => { if (e.target === back && !o.sticky) closeModal(); } });
  const acts = (o.actions || [{ label: 'Close', primary: true }]).map(a => h('button', { type: 'button', class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), onclick: async () => {
    if (a.act) { const r = await a.act(); if (r === false) return; }
    closeModal();
  } }, a.label));
  const box = h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    h('div', { class: 'mhead' }, h('h2', { text: o.title }), h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close', onclick: closeModal }, icon('close'))),
    h('div', { class: 'mbody' }, o.body), acts.length ? h('div', { class: 'mfoot' }, acts) : null);
  back.append(box); $('#modal-root').append(back);
  const f = box.querySelector('[autofocus]') || box.querySelector('.mfoot .primary') || box.querySelector('button');
  setTimeout(() => f && f.focus(), 30);
  return box;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
const modalOpen = () => !!$('#modal-root .scrim');

/* ============ IndexedDB ============ */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('lectern', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        ['kv', 'decks', 'versions', 'pics', 'thumbs', 'files', 'runs', 'audio'].forEach(n => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n); });
      };
      r.onsuccess = () => { DB.db = r.result; res(DB.db); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => toast('Lectern is open in another tab with an older version. Close it, then reload.');
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode); let out;
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
      out = fn(Array.isArray(store) ? store.map(s => t.objectStore(s)) : t.objectStore(store));
    });
  },
  get(store, key) { return new Promise((res, rej) => { const r = DB.db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  put(store, key, val) { return DB.tx(store, 'readwrite', s => { s.put(val, key); }); },
  del(store, key) { return DB.tx(store, 'readwrite', s => { s.delete(key); }); },
  all(store) {
    return new Promise((res, rej) => {
      const out = new Map(); const r = DB.db.transaction(store).objectStore(store).openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); };
      r.onerror = () => rej(r.error);
    });
  },
  keys(store) { return new Promise((res, rej) => { const r = DB.db.transaction(store).objectStore(store).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  putMany(store, entries) { return DB.tx(store, 'readwrite', s => { for (const [k, v] of entries) s.put(v, k); }); },
};

/* ============ app state ============ */
const DEFAULT_PREFS = { voice: 'bm_george', speed: 1, wpm: 140, theme: 'system', notesSize: 19, tourDone: false, filmstrip: true, notesOpen: true, readHint: 0 };
const App = {
  decks: new Map(),       // id -> deck
  versions: new Map(),    // id -> version (with slides)
  prefs: Object.assign({}, DEFAULT_PREFS),
  pron: { text: '', rules: [], modified: '' },
  requests: new Map(),    // deckId -> { text, modified }
  sync: { url: '', key: '', device: '', base: {}, baseData: {}, dirty: {}, lastSync: 0, server: null, seenInbox: {}, masterSeen: {} },
  queue: [],              // Drive transfers waiting to run
  ui: { route: null, deck: null, n: 1, mode: 'browse' },
  thumbURLs: new Map(), picURLs: new Map(),
  device: { gpu: null },
};
const liveDecks = () => [...App.decks.values()].filter(d => !d.deletedAt);
const deckVer = d => d && App.versions.get(d.verId);
const deckOf = id => App.decks.get(id);

async function saveKV(name) {
  if (name === 'prefs') return DB.put('kv', 'prefs', App.prefs);
  if (name === 'sync') return DB.put('kv', 'sync', App.sync);
  if (name === 'queue') return DB.put('kv', 'queue', App.queue);
}
async function saveDeck(d, opts) {
  d.updatedAt = nowIso();
  App.decks.set(d.id, d);
  await DB.put('decks', d.id, d);
  if (!(opts && opts.local)) markDirty('d:' + d.id);
}
async function saveVersion(v, opts) {
  App.versions.set(v.id, v);
  await DB.put('versions', v.id, v);
  if (!(opts && opts.local)) markDirty('v:' + v.id);
}
async function savePrefs() { await saveKV('prefs'); markDirty('p:prefs'); }
function markDirty(id) { App.sync.dirty[id] = 1; saveKV('sync'); if (typeof syncSoon === 'function') syncSoon(2500); }

/* ============ talk maths ============ */
function deckWords(v) { return v ? v.slides.reduce((a, s) => a + wordsOf(s.notes), 0) : 0; }
function talkMinutes(d) {
  if (d.talkMin) return d.talkMin;
  const w = deckWords(deckVer(d));
  return w ? Math.max(5, Math.round(w / App.prefs.wpm / 5) * 5) : 0;
}
/* Targets: share the talk length across slides by how much you say on each; at least 15 s per visible slide. */
function slideTargets(d) {
  const v = deckVer(d); if (!v) return [];
  const total = talkMinutes(d) * 60000;
  const words = v.slides.map(s => s.hidden ? 0 : wordsOf(s.notes));
  const visible = v.slides.filter(s => !s.hidden).length || 1;
  const floor = Math.min(15000, total / visible / 2);
  const sumW = words.reduce((a, b) => a + b, 0);
  const spare = Math.max(0, total - floor * visible);
  return v.slides.map((s, i) => s.hidden ? 0 : floor + (sumW ? spare * words[i] / sumW : spare / visible));
}
