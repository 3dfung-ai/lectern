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
/* ============ reading a .pptx (titles, slide text, speaker notes) and writing notes back ============ */
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  dc: 'http://purl.org/dc/elements/1.1/',
};
const xmlParse = s => new DOMParser().parseFromString(s, 'application/xml');
async function zipXml(zip, name) { const f = zip.file(name); return f ? xmlParse(await f.async('string')) : null; }
function partTarget(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); }
  return parts.join('/');
}
async function rels(zip, part) {
  const relName = part.replace(/([^/]+)$/, '_rels/$1.rels');
  const x = await zipXml(zip, relName); const out = {};
  if (!x) return out;
  for (const r of x.getElementsByTagNameNS(NS.pr, 'Relationship')) out[r.getAttribute('Id')] = { target: partTarget(part, r.getAttribute('Target')), type: r.getAttribute('Type') || '' };
  return out;
}
function paraText(p) {
  let s = '';
  for (const n of p.getElementsByTagNameNS(NS.a, '*')) {
    if (n.localName === 't') s += n.textContent;
    else if (n.localName === 'br') s += '\n';
    else if (n.localName === 'tab') s += '\t';
  }
  return s;
}
function placeholderType(sp) {
  const ph = sp.getElementsByTagNameNS(NS.p, 'ph')[0];
  return ph ? (ph.getAttribute('type') || 'body') : '';
}
function shapeText(sp) {
  return Array.from(sp.getElementsByTagNameNS(NS.a, 'p')).map(paraText).map(s => s.trim()).filter(Boolean).join('\n');
}

async function loadZip(buf) {
  if (!window.JSZip) throw new Error('Reader not loaded');
  return JSZip.loadAsync(buf);
}

/* Returns { title, slides:[{n,title,text,notes,hidden,notesPart}], ratio } */
async function parsePptx(buf) {
  const zip = await loadZip(buf);
  const pres = await zipXml(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error('This file has no PowerPoint presentation inside.');
  const prel = await rels(zip, 'ppt/presentation.xml');
  const order = Array.from(pres.getElementsByTagNameNS(NS.p, 'sldId')).map(n => prel[n.getAttributeNS(NS.r, 'id')]).filter(Boolean).map(r => r.target);
  const sz = pres.getElementsByTagNameNS(NS.p, 'sldSz')[0];
  const ratio = sz ? Number(sz.getAttribute('cx')) / Number(sz.getAttribute('cy')) : 16 / 9;
  const slides = [];
  for (let i = 0; i < order.length; i++) {
    const part = order[i];
    const x = await zipXml(zip, part);
    let title = '', blocks = [], hidden = false, notes = '', notesPart = '';
    if (x) {
      hidden = x.documentElement.getAttribute('show') === '0';
      for (const sp of x.getElementsByTagNameNS(NS.p, 'sp')) {
        const t = shapeText(sp); if (!t) continue;
        blocks.push(t);
        const pt = placeholderType(sp);
        if (!title && (pt === 'title' || pt === 'ctrTitle')) title = t.replace(/\s+/g, ' ');
      }
      if (!title && blocks.length) title = blocks[0].split('\n')[0];
      const r = await rels(zip, part);
      const nr = Object.values(r).find(v => /notesSlide/.test(v.type));
      if (nr) {
        notesPart = nr.target;
        const nx = await zipXml(zip, notesPart);
        if (nx) for (const sp of nx.getElementsByTagNameNS(NS.p, 'sp')) {
          if (placeholderType(sp) !== 'body') continue;
          notes = Array.from(sp.getElementsByTagNameNS(NS.a, 'p')).map(paraText).join('\n').replace(/\n{3,}/g, '\n\n').trim();
          break;
        }
      }
    }
    slides.push({ n: i + 1, title: (title || `Slide ${i + 1}`).slice(0, 200), text: blocks.join('\n').slice(0, 6000), notes, hidden, notesPart });
  }
  const core = await zipXml(zip, 'docProps/core.xml');
  const coreTitle = core ? ((core.getElementsByTagNameNS(NS.dc, 'title')[0] || {}).textContent || '').trim() : '';
  return { title: coreTitle, slides, ratio };
}

/* A slide with no notes page gets one, cloned from another notes page in the same file. */
async function addNotesPage(zip, slides, s) {
  const tpl = slides.find(o => o.notesPart && zip.file(o.notesPart));
  if (!tpl) throw new Error('This PowerPoint file has no notes pages at all. Add one note in PowerPoint, then edit here.');
  const pres = await zipXml(zip, 'ppt/presentation.xml');
  const prel = await rels(zip, 'ppt/presentation.xml');
  const order = Array.from(pres.getElementsByTagNameNS(NS.p, 'sldId')).map(n => prel[n.getAttributeNS(NS.r, 'id')]).filter(Boolean).map(r => r.target);
  const slidePart = order[s.n - 1];
  let max = 0;
  zip.forEach(p => { const m = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(p); if (m) max = Math.max(max, Number(m[1])); });
  const part = `ppt/notesSlides/notesSlide${max + 1}.xml`;
  zip.file(part, await zip.file(tpl.notesPart).async('string'));
  const tplRels = await zipXml(zip, tpl.notesPart.replace(/([^/]+)$/, '_rels/$1.rels'));
  const master = Array.from(tplRels.getElementsByTagNameNS(NS.pr, 'Relationship')).find(r => /notesMaster/.test(r.getAttribute('Type')));
  zip.file(part.replace(/([^/]+)$/, '_rels/$1.rels'), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${master.getAttribute('Type')}" Target="${master.getAttribute('Target')}"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/${slidePart.split('/').pop()}"/></Relationships>`);
  // the copied page still points at the template's slide; give the slide its own relationship ids
  const relName = slidePart.replace(/([^/]+)$/, '_rels/$1.rels');
  let sr = zip.file(relName) ? await zip.file(relName).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let id = 1; while (sr.includes(`Id="rId${id}"`)) id++;
  sr = sr.replace('</Relationships>', `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${max + 1}.xml"/></Relationships>`);
  zip.file(relName, sr);
  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes(`/${part}"`)) ct = ct.replace('</Types>', `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`);
  zip.file('[Content_Types].xml', ct);
  s.notesPart = part;
}

/* Write edited notes into a copy of the .pptx. Only the edited notes pages change. */
async function writeNotes(buf, edits /* {n: text} */, slides) {
  const zip = await loadZip(buf);
  slides = slides.map(s => Object.assign({}, s));
  for (const [nStr, text] of Object.entries(edits)) {
    const s = slides[Number(nStr) - 1];
    if (!s) throw new Error(`Slide ${nStr} is not in this file.`);
    if (!s.notesPart || !zip.file(s.notesPart)) await addNotesPage(zip, slides, s);
    const x = await zipXml(zip, s.notesPart);
    const body = Array.from(x.getElementsByTagNameNS(NS.p, 'sp')).find(sp => placeholderType(sp) === 'body');
    if (!body) throw new Error(`Slide ${nStr}: notes area not found.`);
    const txBody = body.getElementsByTagNameNS(NS.p, 'txBody')[0];
    const oldParas = Array.from(txBody.getElementsByTagNameNS(NS.a, 'p'));
    const firstRun = oldParas.map(p => p.getElementsByTagNameNS(NS.a, 'rPr')[0]).find(Boolean);
    const pPr = oldParas.length ? oldParas[0].getElementsByTagNameNS(NS.a, 'pPr')[0] : null;
    oldParas.forEach(p => p.remove());
    for (const line of String(text).split('\n')) {
      const p = x.createElementNS(NS.a, 'a:p');
      if (pPr) p.append(pPr.cloneNode(true));
      if (line) {
        const r = x.createElementNS(NS.a, 'a:r');
        if (firstRun) r.append(firstRun.cloneNode(true)); else { const rp = x.createElementNS(NS.a, 'a:rPr'); rp.setAttribute('lang', 'en-GB'); r.append(rp); }
        const t = x.createElementNS(NS.a, 'a:t'); t.textContent = line;
        if (/^\s|\s$/.test(line)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        r.append(t); p.append(r);
      } else {
        const end = x.createElementNS(NS.a, 'a:endParaRPr'); end.setAttribute('lang', 'en-GB'); p.append(end);
      }
      txBody.append(p);
    }
    zip.file(s.notesPart, new XMLSerializer().serializeToString(x));
  }
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  return { bytes: out, slides };
}

/* File names: "poct1_v002_150min_full.pptx" and "poct1_v003_150min_full.pptx" are the same talk. */
function nameKey(name) {
  return String(name || '').toLowerCase().replace(/\.(pptx|pdf)$/i, '')
    .replace(/(^|[ _.-])(v\d{1,4}|rehearsal|final|draft|copy)(?=$|[ _.-])/g, '$1')
    .replace(/\(\d+\)/g, '').replace(/[ _.-]+/g, '_').replace(/^_|_$/g, '');
}
function talkMinFromName(name) { const m = /(\d{2,3})\s*min/i.exec(name || ''); return m ? Number(m[1]) : null; }
function seriesGuess(name) {
  const key = nameKey(name), m = /^([a-z]+)(\d{1,2})(?:_|$)/.exec(key);
  return { prefix: m ? m[1] : '', order: m ? Number(m[2]) : null, appendix: /(^|_)appendix(_|$)/.test(key), card: /(^|_)(card|handout|reference)(_|$)/.test(key) };
}
function niceTitle(parsed, fileName) {
  let t = (parsed.title || '').trim();
  if (!t || /^presentation\d*$/i.test(t) || /^powerpoint/i.test(t)) t = (parsed.slides[0] && parsed.slides[0].title) || '';
  if (!t) t = String(fileName || 'Untitled talk').replace(/\.pptx$/i, '').replace(/[_]+/g, ' ');
  return t.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/* ============ speaker notes for reading and for speaking ============ */
/* Split notes into display blocks: opening/closing sections are labelled; [Pause] becomes a pause mark. */
function notesBlocks(notes) {
  const out = []; let label = '';
  const text = String(notes || '').replace(/\[REHEARSAL-READY[^\]]*\]/gi, '').trim();
  for (const para of text.split(/\n+/)) {
    let p = para.trim(); if (!p) continue;
    let m;
    while ((m = /^\[(OPENING|CLOSING)\]\s*/i.exec(p))) { label = m[1].toLowerCase(); p = p.slice(m[0].length); }
    let endAfter = false;
    if (/\[\/(OPENING|CLOSING)\]\s*$/i.test(p)) { p = p.replace(/\s*\[\/(OPENING|CLOSING)\]\s*$/i, ''); endAfter = true; }
    if (p) out.push({ label, text: p });
    if (endAfter) label = '';
  }
  return out;
}
function sentences(text) {
  return String(text).replace(/\s+/g, ' ').match(/[^.!?…]+(?:[.!?…]+["'’”)]*|$)/g)?.map(s => s.trim()).filter(Boolean) || [];
}
function parsePron(text) {
  const rules = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 1) continue;
    const from = line.slice(0, i).trim(), to = line.slice(i + 1).trim(); if (!from) continue;
    const escd = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp((/^\w/.test(from) ? '(?<![\\w])' : '') + escd + (/\w$/.test(from) ? '(?![\\w])' : ''), 'g');
    rules.push({ from, to, re });
  }
  rules.sort((a, b) => b.from.length - a.from.length);
  return rules;
}
/* Text the voice reads: tags removed, pronunciations applied, pauses kept as markers. */
function speakable(text) {
  let t = String(text || '').replace(/\[REHEARSAL-READY[^\]]*\]/gi, ' ').replace(/\[\/?(OPENING|CLOSING)\]/gi, ' ');
  for (const r of App.pron.rules) t = t.replace(r.re, r.to);
  t = t.replace(/\s*\[pause[^\]]*\]\s*/gi, ' ⏸ ').replace(/[–—]/g, ', ').replace(/±/g, ' plus or minus ').replace(/≥/g, ' at least ').replace(/≤/g, ' at most ')
    .replace(/(\d)\s*%/g, '$1 percent').replace(/~\s*(\d)/g, 'about $1').replace(/\s+/g, ' ');
  return t.trim();
}
/* ============ slide pictures: from a PDF, from PowerPoint's own images, and small thumbnails ============ */
let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import('./vendor/pdf.min.mjs');
  _pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
  return _pdfjs;
}
function canvasBlob(c, type, q) { return new Promise(res => c.toBlob(res, type || 'image/jpeg', q || 0.86)); }
async function makeThumb(blob, w) {
  w = w || 400;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * bmp.height / bmp.width);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  return canvasBlob(c, 'image/jpeg', 0.8);
}
/* Render every page of a PDF to a 1920-wide picture. onPage(i, total) reports progress. */
async function pdfToPictures(buf, onPage) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = 1920 / v1.width;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    out.push(await canvasBlob(c, 'image/jpeg', 0.86));
    page.cleanup();
    if (onPage) onPage(i, doc.numPages);
  }
  doc.destroy();
  return out;
}
/* Match picture pages to slides: one per slide, or one per visible slide when hidden slides were left out. */
function mapPictures(count, slides) {
  if (count === slides.length) return slides.map((s, i) => i);
  const vis = slides.map((s, i) => s.hidden ? -1 : i).filter(i => i >= 0);
  if (count === vis.length) { const m = slides.map(() => -1); vis.forEach((si, k) => { m[si] = k; }); return m; }
  return slides.map((s, i) => i < count ? i : -1);
}
/* Store a picture set: full pictures and thumbnails, keyed "<picsId>/<slide n>". */
async function storePictures(picsId, blobsBySlide, onStep) {
  const entries = [], thumbs = [];
  for (let i = 0; i < blobsBySlide.length; i++) {
    const b = blobsBySlide[i]; if (!b) continue;
    entries.push([`${picsId}/${i + 1}`, b]);
    thumbs.push([`${picsId}/${i + 1}`, await makeThumb(b)]);
    if (onStep) onStep(i + 1, blobsBySlide.length);
  }
  await DB.putMany('pics', entries);
  await DB.putMany('thumbs', thumbs);
}
async function hasPictures(picsId, n) { return !!(picsId && await DB.get('thumbs', `${picsId}/${n || 1}`)); }
/* Pack pictures into one zip for Drive, and unpack. */
async function packPictures(picsId, count) {
  const zip = new JSZip();
  for (let n = 1; n <= count; n++) { const b = await DB.get('pics', `${picsId}/${n}`); if (b) zip.file(String(n).padStart(3, '0') + '.jpg', b); }
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
async function unpackPictures(picsId, bytes, onStep) {
  const zip = await JSZip.loadAsync(bytes), blobs = [];
  const names = Object.keys(zip.files).filter(n => /^\d+\.jpg$/i.test(n)).sort();
  for (const name of names) blobs[Number(name.slice(0, -4)) - 1] = new Blob([await zip.file(name).async('uint8array')], { type: 'image/jpeg' });
  await storePictures(picsId, blobs, onStep);
  return names.length;
}
/* Object URLs for pictures, cached and released when the set changes. */
async function picURL(picsId, n, full) {
  const key = `${picsId}/${n}`, cache = full ? App.picURLs : App.thumbURLs;
  if (cache.has(key)) return cache.get(key);
  const blob = await DB.get(full ? 'pics' : 'thumbs', key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  cache.set(key, url);
  if (full && cache.size > 60) { const [k, u] = cache.entries().next().value; URL.revokeObjectURL(u); cache.delete(k); }
  return url;
}
/* Fill an <img> with a slide picture, or show the slide's text when there is no picture yet. */
function slideImage(v, n, full, cls) {
  const s = v.slides[n - 1] || { title: '', text: '' };
  const wrap = h('div', { class: 'pic' + (cls ? ' ' + cls : ''), style: { aspectRatio: String(v.ratio || 16 / 9) } });
  const fallback = () => { wrap.classList.add('textpic'); wrap.replaceChildren(h('div', { class: 'tp' }, h('b', { text: s.title }), full ? h('p', { text: s.text.split('\n').slice(1, 9).join('\n') }) : null)); };
  if (!v.picsId) { fallback(); return wrap; }
  picURL(v.picsId, n, full).then(url => {
    if (!url) { fallback(); return; }
    const img = h('img', { alt: `Slide ${n}: ${s.title}`, src: url, draggable: 'false', decoding: 'async' });
    wrap.replaceChildren(img);
  });
  return wrap;
}
/* ============ Drive sync: this device first, then your own Apps Script and Drive folder ============ */
/*
  Everything is saved on this device at once, so Lectern works with no internet.
  The shared list of talks is one JSON file in your Drive (00_Apps/Lectern/_data/lectern-index.json),
  kept by a small Apps Script in your account that answers only requests carrying your key.
  Files (the .pptx, slide pictures, MP3s) travel separately, 3 MB at a time, in the background.
*/
const Sync = { yielded: false, busy: false, again: false, timer: 0, err: null, detail: '', fails: 0, scanAt: 0, qBusy: false, qErr: null, qNow: null };
const syncReady = () => !!(App.sync.url && App.sync.key);
const validScriptUrl = url => /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
function syncSoon(ms) { clearTimeout(Sync.timer); if (syncReady()) Sync.timer = setTimeout(() => syncNow(false), ms); }

async function call(body, opts) {
  opts = opts || {};
  if (!syncReady() && !opts.url) throw Object.assign(new Error('not_connected'), { code: 'not_connected' });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 60000);
  try {
    const res = await fetch(opts.url || App.sync.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: opts.key || App.sync.key }, body)), redirect: 'follow', signal: ctl.signal });
    let out;
    try { out = await res.json(); } catch (e) { throw Object.assign(new Error('not_json'), { code: 'not_json' }); }
    if (!out || !out.ok) throw Object.assign(new Error((out && out.error) || 'server'), { code: (out && out.error) || 'server', detail: out && out.detail });
    return out;
  } catch (e) {
    if (!e.code) e.code = e.name === 'AbortError' ? 'timeout' : 'network';
    throw e;
  } finally { clearTimeout(t); }
}
function syncErrText(code, detail) {
  return {
    bad_key: 'The sync key doesn’t match your Lectern sync script',
    not_json: 'The link didn’t answer like the Lectern sync script. Check the Web app link, and that access is set to “Anyone”',
    timeout: 'Google took too long to answer; will retry', network: 'Couldn’t reach Google; will retry', offline: 'You’re offline',
    busy: 'Another device was syncing at the same moment; will retry', not_connected: 'Drive sync isn’t set up on this device',
    corrupt_store: 'The Drive index file can’t be read. Nothing was overwritten',
    too_big_for_google: 'Google can’t redraw a file this large. Drop the PowerPoint PDF on the talk instead',
    outside_lectern: 'That file is outside the Lectern folder', upload_expired: 'An upload took too long and will restart',
  }[code] || ('Drive said: ' + code + (detail ? ' (' + detail + ')' : ''));
}

/* ---------- records ---------- */
const PREF_SYNC_KEYS = ['voice', 'speed', 'wpm', 'nbLinks'];
async function recordData(id) {
  const [kind, key] = [id.slice(0, 1), id.slice(2)];
  if (kind === 'd') return App.decks.get(key) || null;
  if (kind === 'v') { const v = App.versions.get(key); if (!v) return null; const c = Object.assign({}, v); return c; }
  if (kind === 'r') return (await DB.get('runs', key)) || null;
  if (kind === 'p') { const o = { updatedAt: App.prefs.syncedAt || '' }; PREF_SYNC_KEYS.forEach(k => { o[k] = App.prefs[k]; }); return o; }
  return null;
}
function merge3(base, mine, theirs) {
  base = base || {}; const out = Object.assign({}, theirs);
  const keys = new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  const mineNewer = String(mine.updatedAt || '') > String(theirs.updatedAt || '');
  for (const k of keys) {
    const b = JSON.stringify(base[k]), m = JSON.stringify(mine[k]), t = JSON.stringify(theirs[k]);
    if (m === t) continue;
    if (m !== b && t === b) out[k] = mine[k];          // only I changed it
    else if (m !== b && t !== b) {                       // both changed: newer wins, positions by their own clock
      if (k === 'pos') out[k] = String((mine.pos || {}).at || '') > String((theirs.pos || {}).at || '') ? mine.pos : theirs.pos;
      else if (k === 'prep') { out[k] = Object.assign({}, theirs.prep, mine.prep); for (const p in theirs.prep || {}) if (String(theirs.prep[p] || '') > String((mine.prep || {})[p] || '')) out[k][p] = theirs.prep[p]; }
      else out[k] = mineNewer ? mine[k] : theirs[k];
    }
  }
  return out;
}
async function applyRecord(id, data) {
  const kind = id.slice(0, 1), key = id.slice(2);
  if (kind === 'd') { App.decks.set(key, data); await DB.put('decks', key, data); }
  else if (kind === 'v') { App.versions.set(key, data); await DB.put('versions', key, data); }
  else if (kind === 'r') await DB.put('runs', key, data);
  else if (kind === 'p') { PREF_SYNC_KEYS.forEach(k => { if (data[k] !== undefined) App.prefs[k] = data[k]; }); App.prefs.syncedAt = data.updatedAt; await saveKV('prefs'); }
}

async function syncNow(manual) {
  const S = App.sync;
  if (!syncReady()) { updatePill(); if (manual) openSettings('sync'); return; }
  if (Sync.yielded && !manual) { updatePill(); return; }
  if (Sync.busy) { Sync.again = true; return; }
  if (navigator.onLine === false) { Sync.err = 'offline'; updatePill(); if (manual) toast('You’re offline. Everything is saved on this device and will sync when you’re back online.'); return; }
  Sync.busy = true; updatePill();
  let got = 0, sent = 0, changed = false;
  try {
    const changes = [], sentJSON = new Map();
    for (const id of Object.keys(S.dirty)) {
      const data = await recordData(id);
      if (!data) { delete S.dirty[id]; continue; }
      sentJSON.set(id, JSON.stringify(data));
      changes.push({ id, baseRev: S.base[id] === undefined ? null : S.base[id], data });
    }
    const out = await call({ op: 'sync', device: S.device, changes, have: Object.assign({}, S.base) }, { timeout: 90000 });
    for (const a of out.accepted || []) {
      S.base[a.id] = a.rev; S.baseData[a.id] = JSON.parse(sentJSON.get(a.id)); sent++;
      const now = await recordData(a.id);
      if (now && JSON.stringify(now) === sentJSON.get(a.id)) delete S.dirty[a.id];
    }
    for (const c of [...(out.conflicts || []), ...(out.updates || [])]) {
      const mine = S.dirty[c.id] ? await recordData(c.id) : null;
      const merged = mine && c.data ? merge3(S.baseData[c.id], mine, c.data) : c.data;
      await applyRecord(c.id, merged);
      S.base[c.id] = c.rev; S.baseData[c.id] = c.data;
      if (mine && JSON.stringify(merged) !== JSON.stringify(c.data)) S.dirty[c.id] = 1; else delete S.dirty[c.id];
      got++; changed = true;
    }
    S.server = { count: out.count, savedAt: out.savedAt, savedBy: out.savedBy, rev: out.serverRev };
    Sync.err = null; Sync.detail = ''; Sync.fails = 0; S.lastSync = Date.now();
    if (Date.now() - Sync.scanAt > 60000 || manual) { Sync.scanAt = Date.now(); await scanDrive(); }
    planDownloads();
  } catch (e) {
    Sync.err = (e && e.code) || 'network'; Sync.detail = (e && e.detail) || ''; Sync.fails++;
  } finally {
    Sync.busy = false;
    await saveKV('sync');
    if (changed) rerender();
    updatePill();
    if (manual && !Sync.err) toast(got || sent ? `Synced: ${sent} sent, ${got} received.` : 'Up to date with Drive.');
    if (manual && Sync.err) toast('Sync failed: ' + syncErrText(Sync.err, Sync.detail) + '.', { ms: 9000, kind: 'warn' });
    if (Sync.again) { Sync.again = false; syncSoon(400); }
    else if (Sync.err === 'bad_key' || Sync.err === 'corrupt_store') { }
    else if (Object.keys(S.dirty).length && Sync.err) syncSoon(Math.min(300000, 15000 * Math.pow(2, Math.min(Sync.fails, 4))));
    else if (Object.keys(S.dirty).length) syncSoon(1500);
    runQueue();
  }
}

/* ---------- what changed in Drive: Inbox drops, edits made in PowerPoint, shared text files ---------- */
async function scanDrive() {
  let s;
  try { s = await call({ op: 'scan' }); } catch (e) { return; }
  // Inbox: pair each .pptx with a same-named .pdf (exact pictures) and attach cards/handouts.
  const files = (s.inbox || []).filter(f => !App.sync.seenInbox[f.id + ':' + f.md5]);
  const pptx = files.filter(f => /\.pptx$/i.test(f.name)).sort((a, b) => (seriesGuess(a.name).appendix ? 1 : 0) - (seriesGuess(b.name).appendix ? 1 : 0)), pdfs = files.filter(f => /\.pdf$/i.test(f.name));
  for (const f of pptx) {
    const pdf = pdfs.find(p => nameKey(p.name) === nameKey(f.name));
    if (pdf) pdfs.splice(pdfs.indexOf(pdf), 1);
    App.sync.seenInbox[f.id + ':' + f.md5] = 1; if (pdf) App.sync.seenInbox[pdf.id + ':' + pdf.md5] = 1;
    enqueue({ t: 'inbox', fileId: f.id, name: f.name, pdfId: pdf ? pdf.id : '', pdfName: pdf ? pdf.name : '' });
  }
  for (const p of pdfs) { App.sync.seenInbox[p.id + ':' + p.md5] = 1; enqueue({ t: 'inboxPdf', fileId: p.id, name: p.name }); }
  // Masters edited in PowerPoint (Decks/<talk>.pptx changed since Lectern last wrote it).
  for (const f of (s.decks || []).filter(f => /\.pptx$/i.test(f.name))) {
    const d = liveDecks().find(d => d.masterId === f.id) || liveDecks().find(d => d.masterName && d.masterName === f.name && d.masterId !== f.id);
    if (!d || !f.md5 || f.md5 === d.masterMd5) continue;
    if (App.sync.masterSeen[f.id] === f.md5) continue;
    App.sync.masterSeen[f.id] = f.md5;
    enqueue({ t: 'master', fileId: f.id, md5: f.md5, name: f.name, deckId: d.id });
  }
  // Talks being thought through in Claude: each Talks/<talk>/status.md becomes a card
  for (const t of s.talks || []) await applyTalkStatus(t);
  // Pronunciations and Claude's to-do lists
  if (s.pron && s.pron.modified !== App.pron.modified) await loadPron();
  for (const r of s.requests || []) {
    const d = liveDecks().find(d => d.reqName && d.reqName + '.md' === r.name);
    if (d && (!App.requests.get(d.id) || App.requests.get(d.id).modified !== r.modified)) await loadRequests(d);
  }
  saveKV('sync');
}
async function loadPron() {
  try { const r = await call({ op: 'readText', which: 'pron' }); App.pron.text = r.text; App.pron.modified = r.modified; App.pron.rules = parsePron(r.text); await DB.put('kv', 'pron', App.pron.text); } catch (e) { }
}
async function loadRequests(d) {
  try {
    const r = await call({ op: 'readText', which: 'request', name: d.reqName });
    App.requests.set(d.id, { text: r.text || '', modified: r.modified || '' });
    await DB.put('kv', 'req:' + d.id, App.requests.get(d.id));
    rerender();
  } catch (e) { }
}
function openRequests(d) { const r = App.requests.get(d.id); return r ? (r.text.match(/^\s*- \[ \]/gm) || []).length : 0; }
function requestLines(d) {
  const r = App.requests.get(d.id); if (!r) return [];
  return r.text.split('\n').map(l => /^\s*- \[( |x|X)\]\s*(.*)$/.exec(l)).filter(Boolean).map(m => ({ done: m[1] !== ' ', text: m[2] }));
}

/* ---------- file transfers, 3 MB at a time ---------- */
async function upFile(bytes, o, onProgress) {
  const size = bytes.length;
  const b = await call({ op: 'upBegin', name: o.name, size, mime: o.mime || 'application/octet-stream', folder: o.folder, replaceId: o.replaceId || '' });
  const chunk = b.chunk || 3 * 1024 * 1024;
  for (let off = 0; off < size; off += chunk) {
    let tries = 0;
    for (;;) {
      try {
        const r = await call({ op: 'upPart', uploadId: b.uploadId, offset: off, b64: b64FromBytes(bytes.subarray(off, Math.min(size, off + chunk))) }, { timeout: 120000 });
        if (onProgress) onProgress(Math.min(size, off + chunk), size);
        if (r.done) return r.file;
        break;
      } catch (e) { if (++tries > 3 || e.code === 'upload_expired' || e.code === 'bad_key') throw e; await sleep(2000 * tries); }
    }
  }
  throw Object.assign(new Error('upload_incomplete'), { code: 'upload_incomplete' });
}
async function downFile(fileId, onProgress) {
  const parts = []; let off = 0, size = 0, meta = null;
  for (;;) {
    let r, tries = 0;
    for (;;) { try { r = await call({ op: 'down', fileId, offset: off }, { timeout: 120000 }); break; } catch (e) { if (++tries > 3 || e.code === 'bad_key' || e.code === 'not_found') throw e; await sleep(2000 * tries); } }
    const u8 = bytesFromB64(r.b64 || ''); parts.push(u8); size = r.size; meta = r; off = r.next;
    if (onProgress) onProgress(Math.min(off, size), size);
    if (r.done || !u8.length) break;
  }
  const out = new Uint8Array(size); let p = 0; for (const u of parts) { out.set(u, p); p += u.length; }
  return { bytes: out, name: meta && meta.name, md5: meta && meta.md5 };
}

/* ---------- background queue ---------- */
const JOB_LABEL = {
  upOrig: 'Saving the .pptx to Drive', upPics: 'Saving slide pictures to Drive', google: 'Google is drawing the slide pictures',
  downPics: 'Getting slide pictures', inbox: 'Bringing in a new talk from the Inbox', inboxPdf: 'Bringing in a PDF from the Inbox',
  master: 'Bringing in your PowerPoint edits', upAudio: 'Saving the MP3 to Drive', request: 'Adding to Claude’s list', pron: 'Saving pronunciations', jot: 'Keeping your idea',
};
function enqueue(job) {
  const same = App.queue.find(j => j.t === job.t && j.verId === job.verId && j.fileId === job.fileId && j.deckId === job.deckId && j.picsId === job.picsId && j.t !== 'request' && j.t !== 'jot');
  if (same) return;
  job.id = uid('j'); job.tries = 0; App.queue.push(job); saveKV('queue'); runQueue();
}
async function runQueue() {
  if (Sync.qBusy || Sync.yielded || !App.queue.length || !syncReady() || navigator.onLine === false) { updatePill(); return; }
  Sync.qBusy = true;
  try {
    while (App.queue.length && navigator.onLine !== false && !Sync.yielded) {
      const job = App.queue.slice().sort((a, b) => jobRank(a) - jobRank(b))[0];
      Sync.qNow = job; updatePill(); renderTray();
      try {
        await runJob(job);
        App.queue = App.queue.filter(j => j.id !== job.id); Sync.qErr = null;
      } catch (e) {
        job.tries = (job.tries || 0) + 1; job.err = e.code || e.message;
        Sync.qErr = job;
        if (['network', 'timeout', 'busy', 'offline'].includes(e.code)) { await saveKV('queue'); break; }
        if (job.tries >= 4 || ['not_found', 'outside_lectern', 'too_big_for_google', 'no_original'].includes(e.code)) {
          App.queue = App.queue.filter(j => j.id !== job.id);
          jobFailed(job, e);
        } else { await saveKV('queue'); break; }
      }
      await saveKV('queue');
    }
  } finally {
    Sync.qBusy = false; Sync.qNow = null; updatePill(); renderTray();
    if (App.queue.length && Sync.qErr) setTimeout(runQueue, Math.min(300000, 20000 * Math.pow(2, Math.min(Sync.qErr.tries || 1, 4))));
  }
}
function jobRank(j) { return { request: 0, pron: 0, jot: 0, inbox: 1, master: 1, inboxPdf: 2, upOrig: 3, google: 4, upPics: 5, downPics: 6, upAudio: 7 }[j.t] ?? 9; }
function jobFailed(job, e) {
  const v = job.verId && App.versions.get(job.verId);
  if (job.t === 'google') {
    if (v) { v.picsState = 'failed'; v.picsError = syncErrText(e.code, e.detail); saveVersion(v); }
    toast('Google couldn’t draw the slides for “' + (v ? (deckOf(v.deckId) || {}).title : 'a talk') + '”. Drop the PowerPoint PDF on the talk for exact pictures.', { ms: 12000, kind: 'warn' });
  } else toast(JOB_LABEL[job.t] + ' failed: ' + syncErrText(e.code, e.detail) + '.', { ms: 9000, kind: 'warn' });
  rerender();
}

async function runJob(job) {
  const v = job.verId ? App.versions.get(job.verId) : null;
  const d = job.deckId ? App.decks.get(job.deckId) : (v ? App.decks.get(v.deckId) : null);
  const progress = (a, b) => { job.p = b ? a / b : 0; renderTray(); };
  if (job.t === 'upOrig') {
    if (!v || !d) return;
    if (!v.origId) {
      const blob = await DB.get('files', 'orig/' + v.id);
      if (!blob) throw Object.assign(new Error('no_original'), { code: 'no_original' });
      const f = await upFile(new Uint8Array(await blob.arrayBuffer()), { name: versionFileName(d, v), folder: 'Decks/_versions/' + talkFolder(d), mime: PPTX_MIME }, progress);
      v.origId = f.id; v.origMd5 = f.md5; await saveVersion(v);
    }
    if (d.verId === v.id) await refreshMaster(d, v);
    if (!v.picsId && v.picsState !== 'failed') enqueue({ t: 'google', verId: v.id });
    return;
  }
  if (job.t === 'google') {
    if (!v || v.picsSrc === 'pdf' || v.picsSrc === 'powerpoint') return;
    if (!v.origId) { enqueue({ t: 'upOrig', verId: v.id }); return; }
    v.picsState = 'drawing'; await saveVersion(v, { local: true }); rerender();
    const c = await call({ op: 'convert', fileId: v.origId }, { timeout: 330000 });
    const pdf = await downFile(c.pdfId, progress);
    const pages = await pdfToPictures(pdf.bytes, (i, n) => { job.p = i / n; renderTray(); });
    const map = mapPictures(pages.length, v.slides);
    const picsId = uid('p');
    await storePictures(picsId, v.slides.map((s, i) => map[i] >= 0 ? pages[map[i]] : null));
    Object.assign(v, { picsId, picsSrc: 'google', picsCount: v.slides.length, picsZipId: '', picsState: 'ready', picsError: '' });
    await saveVersion(v);
    try { await call({ op: 'trash', fileId: c.pdfId }); } catch (e) { }
    enqueue({ t: 'upPics', verId: v.id, picsId });
    rerender();
    return;
  }
  if (job.t === 'upPics') {
    if (!v || !v.picsId || v.picsId !== job.picsId || v.picsZipId) return;
    const zip = await packPictures(v.picsId, v.slides.length);
    const f = await upFile(zip, { name: v.picsId + '.zip', folder: '_data/pics', mime: 'application/zip' }, progress);
    // every version sharing this picture set gets the Drive copy
    for (const o of App.versions.values()) if (o.picsId === v.picsId && !o.picsZipId) { o.picsZipId = f.id; await saveVersion(o); }
    return;
  }
  if (job.t === 'downPics') {
    if (!v || !v.picsZipId || await hasPictures(v.picsId, 1)) return;
    const z = await downFile(v.picsZipId, progress);
    await unpackPictures(v.picsId, z.bytes);
    rerender();
    return;
  }
  if (job.t === 'inbox' || job.t === 'master') {
    if (job.t === 'inbox') {
      const c = await call({ op: 'claim', fileId: job.fileId });
      if (c.taken && !job.claimed) return;
      job.claimed = true; await saveKV('queue');
      if (job.pdfId) { try { await call({ op: 'claim', fileId: job.pdfId }); } catch (e) { } }
    } else {
      const c = await call({ op: 'claimMaster', fileId: job.fileId, md5: job.md5 });
      if (c.taken && !job.claimed) return;
      job.claimed = true; await saveKV('queue');
    }
    const file = await downFile(job.fileId, progress);
    let pdfBytes = null;
    if (job.pdfId) { try { pdfBytes = (await downFile(job.pdfId)).bytes; } catch (e) { } }
    const res = await importPptx(file.bytes, job.name, { from: job.t === 'inbox' ? 'inbox' : 'powerpoint', pdfBytes, driveFileId: job.fileId, deckId: job.deckId, quiet: true });
    if (job.pdfId) { try { await call({ op: 'trash', fileId: job.pdfId }); } catch (e) { } }
    if (res && res.version) toast(job.t === 'inbox' ? `New in Lectern: “${res.deck.title}”${res.version.n > 1 ? ` (version ${res.version.n})` : ''}.` : `Your PowerPoint edits to “${res.deck.title}” are in, as version ${res.version.n}.`, { ms: 8000, action: { label: 'Open', fn: () => go(`#/d/${res.deck.id}/1`) } });
    return;
  }
  if (job.t === 'inboxPdf') {
    const c = await call({ op: 'claim', fileId: job.fileId });
    if (c.taken && !job.claimed) return;
    job.claimed = true;
    const file = await downFile(job.fileId, progress);
    await importPdf(file.bytes, job.name, { quiet: true });
    try { await call({ op: 'trash', fileId: job.fileId }); } catch (e) { }
    return;
  }
  if (job.t === 'upAudio') {
    if (!d) return;
    const blob = await DB.get('files', 'mp3/' + d.id); if (!blob) return;
    const f = await upFile(new Uint8Array(await blob.arrayBuffer()), { name: talkFolder(d) + '.mp3', folder: 'Audio', mime: 'audio/mpeg', replaceId: d.audioId || '' }, progress);
    d.audioId = f.id; await saveDeck(d);
    return;
  }
  if (job.t === 'request') {
    const deck = App.decks.get(job.deckId); if (!deck) return;
    const r = await call({ op: 'appendText', which: 'request', name: deck.reqName, text: job.line, header: requestHeader(deck) });
    App.requests.set(deck.id, { text: r.text, modified: r.modified }); await DB.put('kv', 'req:' + deck.id, App.requests.get(deck.id));
    rerender();
    return;
  }
  if (job.t === 'jot') {
    await call({ op: 'appendText', which: 'ideas', name: job.folder, text: job.line, header: '# Ideas jotted in Lectern\n\n' });
    return;
  }
  if (job.t === 'pron') { const r = await call({ op: 'writeText', which: 'pron', text: App.pron.text }); App.pron.modified = r.modified; return; }
}
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
function talkFolder(d) { return String(d.title || 'Talk').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90); }
function versionFileName(d, v) { return `v${String(v.n).padStart(3, '0')} - ${v.name}`.replace(/[\\/:*?"<>|]+/g, '-'); }
function requestHeader(d) { return `# ${d.title}: changes for Claude\n\nLectern adds items here while you rehearse. Claude ticks them off ([x]) when the deck is rebuilt.\n\n`; }

/* Make Decks/<talk>.pptx a copy of the current version. */
async function refreshMaster(d, v) {
  if (!v.origId) return;
  const name = talkFolder(d) + '.pptx';
  const r = await call({ op: 'setMaster', fileId: v.origId, name, oldId: d.masterId || '' });
  d.masterId = r.file.id; d.masterMd5 = r.file.md5; d.masterName = r.file.name; await saveDeck(d);
  App.sync.masterSeen[r.file.id] = r.file.md5;
}

/* After a sync: fetch pictures for current versions that this device doesn't have yet. */
async function planDownloads() {
  for (const d of liveDecks()) {
    const v = deckVer(d);
    if (v && v.picsId && v.picsZipId && !(await hasPictures(v.picsId, 1))) enqueue({ t: 'downPics', verId: v.id });
  }
}

/* ---------- the pill at the corner ---------- */
function updatePill() {
  const p = $('#sync-pill'); if (!p) return;
  let txt, cls = '';
  const q = App.queue.length, dirty = Object.keys(App.sync.dirty).length;
  if (!syncReady()) { txt = 'This device only'; cls = 'off'; }
  else if (navigator.onLine === false) { txt = 'Offline: saved here'; cls = 'warn'; }
  else if (Sync.yielded) { txt = 'Paused: open in another tab'; cls = 'off'; }
  else if (Sync.busy) { txt = 'Syncing…'; cls = 'busy'; }
  else if (Sync.qNow) { txt = (JOB_LABEL[Sync.qNow.t] || 'Working') + (q > 1 ? ` (+${q - 1})` : ''); cls = 'busy'; }
  else if (Sync.err && !['offline'].includes(Sync.err)) { txt = Sync.err === 'bad_key' ? 'Sync key wrong' : 'Sync problem'; cls = 'warn'; }
  else if (q) { txt = `${q} waiting for Drive`; cls = 'warn'; }
  else if (dirty) { txt = 'Saving…'; cls = 'busy'; }
  else { txt = 'Synced with Drive'; cls = 'ok'; }
  p.className = 'pill ' + cls; p.querySelector('span').textContent = txt;
  p.title = Sync.yielded ? 'Lectern is open in another tab. Click to reload this one.' : syncReady() ? (App.sync.lastSync ? 'Last synced ' + new Date(App.sync.lastSync).toLocaleTimeString() : 'Not synced yet') + '. Click to sync now.' : 'Set up Drive sync so your talks reach your other devices.';
}

/* ---------- connecting a device ---------- */
function setupLink() {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ u: App.sync.url, k: App.sync.key })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.origin + location.pathname + '#sync=' + payload;
}
function readSetupHash() {
  const m = /^#sync=([A-Za-z0-9_-]+)$/.exec(location.hash || '');
  if (!m) return null;
  let o = null;
  try { const b = m[1].replace(/-/g, '+').replace(/_/g, '/'); o = JSON.parse(decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4))))); } catch (e) { }
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  return o && o.u && o.k ? { url: o.u, key: o.k } : null;
}
function offerSetupLink(link) {
  if (!validScriptUrl(link.url)) { toast('That setup link isn’t a Google Apps Script link, so it was ignored.'); return; }
  if (link.url === App.sync.url && link.key === App.sync.key) { syncNow(true); return; }
  const short = link.url.replace(/^https?:\/\//, '').replace(/^(.{34}).*(.{10})$/, '$1…$2');
  modal({
    title: 'Turn on Drive sync?',
    body: [h('p', {}, 'This setup link connects Lectern on this device to the sync script at ', h('b', { text: short }), '. Your talks will be copied to and from that script’s Google Drive.'),
      h('p', { class: 'hint' }, 'Only continue if you made this link on one of your own devices.')],
    actions: [{ label: 'Not now' }, { label: 'Turn on sync', primary: true, act: () => { applySync(link.url, link.key); } }],
  });
}
async function applySync(url, key, dev) {
  const S = App.sync, changedServer = url !== S.url;
  try { await call({ op: 'ping' }, { url, key }); } catch (e) { toast('Couldn’t connect: ' + syncErrText(e.code, e.detail) + '.', { ms: 9000, kind: 'warn' }); return false; }
  S.url = url; S.key = key; if (dev) S.device = dev;
  if (!S.device) S.device = guessDevice();
  Sync.err = null;
  if (changedServer) {
    S.base = {}; S.baseData = {};
    for (const d of App.decks.values()) S.dirty['d:' + d.id] = 1;
    for (const v of App.versions.values()) S.dirty['v:' + v.id] = 1;
    for (const k of await DB.keys('runs')) S.dirty['r:' + k] = 1;
    S.dirty['p:prefs'] = 1;
  }
  await healSync();
  await saveKV('sync');
  await loadPron();
  await syncNow(false);
  if (!Sync.err) toast(`Drive sync is on. ${plural(liveDecks().length, 'talk')} on this device.`);
  return true;
}
/* Self-repair, run at start and on connect: anything on this device that Drive has never seen gets sent,
   and any .pptx or picture set not yet on Drive gets queued. Covers two tabs open at once and sync turned on late. */
async function healSync() {
  if (!syncReady()) return;
  const S = App.sync; let n = 0;
  const mark = id => { if (S.base[id] === undefined && !S.dirty[id]) { S.dirty[id] = 1; n++; } };
  for (const d of App.decks.values()) mark('d:' + d.id);
  for (const v of App.versions.values()) mark('v:' + v.id);
  for (const k of await DB.keys('runs')) mark('r:' + k);
  for (const v of App.versions.values()) {
    if (!v.origId && await DB.get('files', 'orig/' + v.id)) enqueue({ t: 'upOrig', verId: v.id });
    if (v.picsId && !v.picsZipId && await hasPictures(v.picsId, 1)) enqueue({ t: 'upPics', verId: v.id, picsId: v.picsId });
  }
  if (n) { await saveKV('sync'); syncSoon(1500); }
}
function guessDevice() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Phone' : 'PC ' + Math.random().toString(36).slice(2, 5).toUpperCase();
}
function syncInit() {
  window.addEventListener('online', () => { if (['offline', 'network', 'timeout'].includes(Sync.err)) Sync.err = null; updatePill(); syncNow(false); });
  window.addEventListener('offline', () => { Sync.err = 'offline'; updatePill(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(false); else if (Object.keys(App.sync.dirty).length) syncNow(false); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(false); }, 120000);
  if (syncReady()) setTimeout(() => syncNow(false), 400);
}

/* status.md is a few "key: value" lines Claude keeps current (front matter style). */
function parseStatus(text) {
  const o = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*([A-Za-z_]+)\s*:\s*(.*?)\s*$/.exec(line); if (!m) continue;
    o[m[1].toLowerCase()] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  }
  return o;
}
async function applyTalkStatus(t) {
  const st = parseStatus(t.status);
  const id = 'dt_' + t.id;
  let d = App.decks.get(id);
  const think = { folder: t.name, folderId: t.id, stage: (st.stage || 'think').toLowerCase(), notebook: st.notebook || '', next: st.next || '', spine: !!t.spine, spineId: t.spine || '',
    spineApproved: /approved|yes|true/i.test(st.spine || '') || ['building', 'deck'].includes((st.stage || '').toLowerCase()), questions: t.questions || '', questionsModified: t.questionsModified || '', pack: t.pack || 0, packId: t.packId || '', audience: st.audience || '', updated: t.statusModified || '' };
  if (!d) {
    if (!t.status) return;   // a folder without a status note is still being set up by Claude
    // a deck that is already in Lectern under this talk's name joins up instead of making a second card
    const existing = liveDecks().find(x => !x.think && talkFolder(x).toLowerCase() === t.name.toLowerCase());
    if (existing) { existing.think = think; await saveDeck(existing); return; }
    d = { id, title: st.talk || st.title || t.name, key: nameKey(t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')), series: st.series || '', seriesOrder: null, role: '', talkMin: Number(st.length) || null, date: /^\d{4}-\d\d-\d\d$/.test(st.date || '') ? st.date : '',
      createdAt: nowIso(), verId: '', masterId: '', masterMd5: '', masterName: '', pos: { n: 1, at: '' }, prep: {}, reqName: t.name, deletedAt: null, audioId: '', think };
    await saveDeck(d);
    toast(`New talk from Claude: “${d.title}”.`, { ms: 6000, action: { label: 'Open', fn: () => go(`#/d/${d.id}/1`) } });
    return;
  }
  const before = JSON.stringify(d.think);
  d.think = think;
  if (st.date && /^\d{4}-\d\d-\d\d$/.test(st.date) && !d.date) d.date = st.date;
  if (st.length && !d.talkMin) d.talkMin = Number(st.length) || null;
  if (JSON.stringify(d.think) !== before) { App.decks.set(d.id, d); await DB.put('decks', d.id, d); rerender(); }
}
/* ============ adding talks: drop a .pptx (and optionally its PDF) anywhere ============ */
const Tray = new Map();   // id -> { title, step, p, done, err }
function trayItem(id, patch) { Tray.set(id, Object.assign(Tray.get(id) || {}, patch)); renderTray(); if (patch.done || patch.err) setTimeout(() => { Tray.delete(id); renderTray(); }, patch.err ? 12000 : 4000); }
function renderTray() {
  const box = $('#tray'); if (!box) return;
  const items = [...Tray.entries()];
  const q = Sync.qNow ? [{ title: JOB_LABEL[Sync.qNow.t] || 'Working', p: Sync.qNow.p || 0, bg: true }] : [];
  box.replaceChildren(...items.map(([id, t]) => h('div', { class: 'titem' + (t.err ? ' err' : t.done ? ' done' : '') },
    h('div', { class: 'tline' }, h('b', { text: t.title }), h('span', { text: t.err ? t.err : t.done ? (t.doneText || 'Done') : t.step || '' })),
    !t.done && !t.err ? h('div', { class: 'bar' }, h('i', { style: { width: Math.round((t.p || 0) * 100) + '%' } })) : null)),
  ...q.map(t => h('div', { class: 'titem bg' }, h('div', { class: 'tline' }, h('span', { text: t.title })), h('div', { class: 'bar' }, h('i', { style: { width: Math.round(t.p * 100) + '%' } })))));
  box.hidden = !items.length && !q.length;
}

async function handleFiles(fileList, target) {
  const files = Array.from(fileList || []);
  const pptx = files.filter(f => /\.pptx$/i.test(f.name)), pdfs = files.filter(f => /\.pdf$/i.test(f.name));
  const other = files.filter(f => !/\.(pptx|pdf)$/i.test(f.name));
  if (other.length) toast(`${plural(other.length, 'file')} skipped: Lectern takes PowerPoint (.pptx) and PDF files. Old .ppt files: open in PowerPoint and save as .pptx.`, { ms: 9000 });
  for (const f of pptx) {
    const pdf = pdfs.find(p => nameKey(p.name) === nameKey(f.name));
    if (pdf) pdfs.splice(pdfs.indexOf(pdf), 1);
    await importPptx(new Uint8Array(await f.arrayBuffer()), f.name, { from: 'drop', pdfBytes: pdf ? new Uint8Array(await pdf.arrayBuffer()) : null });
  }
  for (const p of pdfs) await importPdf(new Uint8Array(await p.arrayBuffer()), p.name, { target });
}

/* Decide which talk a file belongs to: same file name (ignoring v001/v002) = same talk. */
function findDeckFor(name, title) {
  const key = nameKey(name);
  return liveDecks().find(d => d.key === key && !(d.think && !d.verId))
    // a talk from the 1 Talk Ideas project: Claude starts its file names with the talk's key
    || (seriesGuess(name).appendix ? null : liveDecks().filter(d => d.think && !d.verId && d.key && key.startsWith(d.key)).sort((a, b) => b.key.length - a.key.length)[0]) || null;
}

async function importPptx(bytes, fileName, o) {
  o = o || {};
  const tid = uid('t');
  trayItem(tid, { title: fileName, step: 'Reading slides and notes', p: 0.05 });
  try {
    const sha = await sha256(bytes);
    const dup = [...App.versions.values()].find(v => v.sha === sha && App.decks.get(v.deckId) && !App.decks.get(v.deckId).deletedAt);
    if (dup) {
      const d = App.decks.get(dup.deckId);
      trayItem(tid, { done: true, doneText: 'Already in Lectern' });
      if (!o.quiet) toast(`“${d.title}” is already in Lectern (version ${dup.n}).`, { action: { label: 'Open', fn: () => go(`#/d/${d.id}/1`) } });
      return { deck: d, version: dup, duplicate: true };
    }
    const parsed = await parsePptx(bytes);
    trayItem(tid, { step: 'Saving on this device', p: 0.3 });
    let d = (o.deckId && App.decks.get(o.deckId)) || findDeckFor(fileName);
    const isNewDeck = !d;
    const g = seriesGuess(fileName);
    if (!d) {
      d = { id: uid('d'), title: o.title || niceTitle(parsed, fileName), key: nameKey(fileName), series: '', seriesOrder: g.order, role: g.appendix ? 'appendix' : '',
        talkMin: g.appendix ? null : talkMinFromName(fileName), date: '', createdAt: nowIso(), verId: '', masterId: '', masterMd5: '', masterName: '',
        pos: { n: 1, at: '' }, prep: {}, reqName: '', deletedAt: null, audioId: '' };
      d.reqName = talkFolder(d);
      // join a series when a sibling file (poct1 … poct2) is already in one
      const sib = g.prefix && liveDecks().find(x => x.key.startsWith(g.prefix) && x.series);
      if (sib) d.series = sib.series;
      if (g.appendix) {
        const main = liveDecks().find(x => x.key === d.key.replace(/(^|_)appendix(_|$)/, '$1full$2') || x.key === d.key.replace(/(^|_)appendix(_|$)/, '$1main$2') || (g.prefix && x.role !== 'appendix' && seriesGuess(x.key).prefix === g.prefix && seriesGuess(x.key).order === g.order));
        if (main) { d.mainId = main.id; d.series = main.series; d.title = 'Appendix: ' + main.title; }
      }
    }
    if (d.think && !d.verId) { d.key = nameKey(fileName); const gg = seriesGuess(fileName); if (gg.appendix) d.role = 'appendix'; }
    const prevV = deckVer(d);
    const n = [...App.versions.values()].filter(v => v.deckId === d.id).reduce((m, v) => Math.max(m, v.n), 0) + 1;
    const v = { id: uid('v'), deckId: d.id, n, name: fileName, sha, bytes: bytes.length, at: nowIso(), from: o.from || 'drop', ratio: parsed.ratio,
      slides: parsed.slides, picsId: '', picsSrc: '', picsCount: 0, picsZipId: '', picsState: '', picsError: '', origId: '', origMd5: '', note: o.note || '' };
    // pictures: the PDF dropped with it (exact), the set handed in (PowerPoint's own), unchanged slides (notes-only edit), or Google later
    if (o.pdfBytes) {
      trayItem(tid, { step: 'Drawing slides from the PDF', p: 0.4 });
      const pages = await pdfToPictures(o.pdfBytes, (i, k) => trayItem(tid, { p: 0.4 + 0.5 * i / k }));
      const map = mapPictures(pages.length, v.slides);
      v.picsId = uid('p');
      await storePictures(v.picsId, v.slides.map((s, i) => map[i] >= 0 ? pages[map[i]] : null));
      Object.assign(v, { picsSrc: 'pdf', picsCount: v.slides.length, picsState: 'ready' });
    } else if (o.pictures) {
      v.picsId = uid('p');
      await storePictures(v.picsId, o.pictures, (i, k) => trayItem(tid, { p: 0.35 + 0.55 * i / k }));
      Object.assign(v, { picsSrc: o.picsSrc || 'powerpoint', picsCount: v.slides.length, picsState: 'ready' });
    } else if (o.reusePicsFrom) {
      Object.assign(v, { picsId: o.reusePicsFrom.picsId, picsSrc: o.reusePicsFrom.picsSrc, picsCount: o.reusePicsFrom.picsCount, picsZipId: o.reusePicsFrom.picsZipId, picsState: o.reusePicsFrom.picsState });
    } else v.picsState = syncReady() ? 'waiting' : 'offline';
    await DB.put('files', 'orig/' + v.id, new Blob([bytes], { type: PPTX_MIME }));
    d.verId = v.id;
    await saveVersion(v);
    await saveDeck(d);
    // Drive: an Inbox or PowerPoint-edited file is already there; anything else is uploaded
    if (o.driveFileId && o.from === 'inbox') {
      try { const a = await call({ op: 'adopt', fileId: o.driveFileId, folderName: talkFolder(d), name: versionFileName(d, v) }); v.origId = a.file.id; v.origMd5 = a.file.md5; await saveVersion(v); await refreshMaster(d, v); }
      catch (e) { enqueue({ t: 'upOrig', verId: v.id }); }
    } else if (o.driveFileId && o.from === 'powerpoint') {
      try { const a = await call({ op: 'snapshot', fileId: o.driveFileId, folderName: talkFolder(d), name: versionFileName(d, v) }); v.origId = a.file.id; v.origMd5 = a.file.md5; await saveVersion(v); d.masterId = o.driveFileId; d.masterMd5 = a.file.md5; await saveDeck(d); }
      catch (e) { enqueue({ t: 'upOrig', verId: v.id }); }
    } else if (syncReady()) enqueue({ t: 'upOrig', verId: v.id });
    if (v.picsId && !v.picsZipId && syncReady()) enqueue({ t: 'upPics', verId: v.id, picsId: v.picsId });
    if (!v.picsId && v.origId && syncReady()) enqueue({ t: 'google', verId: v.id });
    // an appendix that arrived before its main deck finds it now
    if (d.role !== 'appendix') for (const a of liveDecks().filter(x => x.role === 'appendix' && !x.mainId)) {
      const ak = a.key.replace(/(^|_)appendix(_|$)/, '$1');
      if (ak && (d.key.replace(/(^|_)(main|full)(_|$)/, '$1') === ak || d.key.replace(/(^|_)(main|full)(_|$)/, '$1').replace(/_$/, '') === ak.replace(/_$/, ''))) { a.mainId = d.id; a.series = d.series; a.title = 'Appendix: ' + d.title; await saveDeck(a); }
    }
    // Claude's flags that this version may have dealt with
    if (prevV) v.prevId = prevV.id, await saveVersion(v, { local: true });
    trayItem(tid, { done: true, doneText: isNewDeck ? `Added: ${parsed.slides.length} slides` : `Version ${v.n} of “${d.title}”` });
    if (!o.quiet) {
      if (isNewDeck) toast(`Added “${d.title}”: ${plural(parsed.slides.length, 'slide')}.` + (v.picsId ? '' : syncReady() ? ' Google is drawing the pictures; the slides show as text until then.' : ' Slides show as text until Drive sync is on or you drop the PDF.'), { ms: 9000, action: { label: 'Open', fn: () => go(`#/d/${d.id}/1`) } });
      else toast(`Saved as version ${v.n} of “${d.title}”. Earlier versions are kept.`, { ms: 8000, action: { label: 'Undo', fn: () => undoVersion(d.id, v.id) } });
    }
    rerender();
    return { deck: d, version: v };
  } catch (e) {
    console.error(e);
    trayItem(tid, { err: 'Couldn’t read this file: ' + (e.message || e) });
    if (!o.quiet) toast(`Couldn’t add ${fileName}: ${e.message || e}`, { ms: 10000, kind: 'warn' });
    return null;
  }
}
async function undoVersion(deckId, verId) {
  const d = App.decks.get(deckId), v = App.versions.get(verId);
  if (!d || !v || !v.prevId) return;
  d.verId = v.prevId; await saveDeck(d);
  const prev = App.versions.get(v.prevId);
  if (prev && prev.origId && syncReady()) refreshMaster(d, prev).catch(() => { });
  toast(`Back to version ${prev ? prev.n : ''}. Version ${v.n} is still kept under Versions.`);
  rerender();
}

/* A PDF on its own: exact pictures for the talk it names (or the open talk), else a talk of its own. */
async function importPdf(bytes, fileName, o) {
  o = o || {};
  const key = nameKey(fileName);
  let d = (o.target && App.decks.get(o.target)) || liveDecks().find(x => x.key === key);
  const tid = uid('t');
  trayItem(tid, { title: fileName, step: 'Drawing slides from the PDF', p: 0.05 });
  try {
    const pages = await pdfToPictures(bytes, (i, k) => trayItem(tid, { p: 0.05 + 0.85 * i / k }));
    if (d && deckVer(d)) {
      const v = deckVer(d);
      const map = mapPictures(pages.length, v.slides);
      const picsId = uid('p');
      await storePictures(picsId, v.slides.map((s, i) => map[i] >= 0 ? pages[map[i]] : null));
      Object.assign(v, { picsId, picsSrc: 'pdf', picsCount: v.slides.length, picsZipId: '', picsState: 'ready', picsError: '' });
      await saveVersion(v);
      if (syncReady()) enqueue({ t: 'upPics', verId: v.id, picsId });
      trayItem(tid, { done: true, doneText: 'Exact pictures in place' });
      if (!o.quiet) toast(`“${d.title}” now shows the exact slide pictures from the PDF.` + (pages.length !== v.slides.length ? ` The PDF has ${pages.length} pages for ${v.slides.length} slides; check the order.` : ''), { ms: 8000 });
      rerender();
      return;
    }
    // a PDF-only talk: pictures, no notes
    const slides = pages.map((b, i) => ({ n: i + 1, title: `Page ${i + 1}`, text: '', notes: '', hidden: false, notesPart: '' }));
    d = { id: uid('d'), title: fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' '), key, series: '', seriesOrder: null, role: 'pdf', talkMin: null, date: '', createdAt: nowIso(), verId: '',
      masterId: '', masterMd5: '', masterName: '', pos: { n: 1, at: '' }, prep: {}, reqName: '', deletedAt: null, audioId: '' };
    d.reqName = talkFolder(d);
    const v = { id: uid('v'), deckId: d.id, n: 1, name: fileName, sha: await sha256(bytes), bytes: bytes.length, at: nowIso(), from: 'pdf', ratio: 16 / 9, slides,
      picsId: uid('p'), picsSrc: 'pdf', picsCount: slides.length, picsZipId: '', picsState: 'ready', origId: '', origMd5: '' };
    const bmp = await createImageBitmap(pages[0]); v.ratio = bmp.width / bmp.height; bmp.close && bmp.close();
    await storePictures(v.picsId, pages);
    d.verId = v.id; await saveVersion(v); await saveDeck(d);
    if (syncReady()) enqueue({ t: 'upPics', verId: v.id, picsId: v.picsId });
    trayItem(tid, { done: true, doneText: `Added: ${pages.length} pages` });
    if (!o.quiet) toast(`Added “${d.title}” from a PDF (pictures only, no notes).`, { action: { label: 'Open', fn: () => go(`#/d/${d.id}/1`) } });
    rerender();
  } catch (e) {
    trayItem(tid, { err: 'Couldn’t read this PDF: ' + (e.message || e) });
  }
}

/* ============ notes edits: kept as drafts until saved into a new .pptx version ============ */
const Drafts = { map: {} };   // deckId -> { verId, edits: {n: text} }
async function loadDrafts() { Drafts.map = (await DB.get('kv', 'drafts')) || {}; }
function saveDrafts() { return DB.put('kv', 'drafts', Drafts.map); }
function draftFor(d) { const x = Drafts.map[d.id]; return x && x.verId === d.verId ? x : null; }
function draftCount(d) { const x = draftFor(d); return x ? Object.keys(x.edits).length : 0; }
function noteText(d, n) { const x = draftFor(d), v = deckVer(d); return x && x.edits[n] !== undefined ? x.edits[n] : ((v && v.slides[n - 1]) || {}).notes || ''; }
function setDraft(d, n, text) {
  const v = deckVer(d); if (!v) return;
  let x = Drafts.map[d.id];
  if (!x || x.verId !== d.verId) x = Drafts.map[d.id] = { verId: d.verId, edits: {} };
  if (text === (v.slides[n - 1] || {}).notes) delete x.edits[n]; else x.edits[n] = text;
  if (!Object.keys(x.edits).length) delete Drafts.map[d.id];
  saveDrafts(); renderEditBar();
}
function discardDrafts(d) { delete Drafts.map[d.id]; saveDrafts(); rerender(); }
async function saveDraftsToPptx(d) {
  const x = draftFor(d), v = deckVer(d); if (!x || !v) return;
  let blob = await DB.get('files', 'orig/' + v.id);
  if (!blob && v.origId && syncReady()) { toast('Getting the .pptx from Drive first…'); const f = await downFile(v.origId); blob = new Blob([f.bytes]); await DB.put('files', 'orig/' + v.id, blob); }
  if (!blob) { toast('The .pptx for this version isn’t on this device yet. Connect Drive sync, or drop the file once.', { ms: 9000, kind: 'warn' }); return; }
  const nums = Object.keys(x.edits).map(Number).sort((a, b) => a - b);
  const tid = uid('t'); trayItem(tid, { title: d.title, step: 'Writing notes into PowerPoint', p: 0.3 });
  try {
    const res = await writeNotes(new Uint8Array(await blob.arrayBuffer()), x.edits, v.slides);
    const check = await parsePptx(res.bytes);   // read it back: every edited note must match
    for (const n of nums) if (check.slides[n - 1].notes !== String(x.edits[n]).replace(/\n{3,}/g, '\n\n').trim() && check.slides[n - 1].notes !== x.edits[n]) throw new Error(`slide ${n} didn’t read back the same`);
    const out = await importPptx(res.bytes, v.name, { deckId: d.id, from: 'notes', reusePicsFrom: v, quiet: true, note: `Notes edited in Lectern on slide${nums.length > 1 ? 's' : ''} ${nums.join(', ')}` });
    if (!out || !out.version) throw new Error('the new version wasn’t saved');
    delete Drafts.map[d.id]; await saveDrafts();
    trayItem(tid, { done: true, doneText: `Saved as version ${out.version.n}` });
    addRequest(d, `Notes edited in Lectern on slide${nums.length > 1 ? 's' : ''} ${nums.join(', ')} (saved as v${out.version.n}). Copy these notes into the act files before rebuilding.`, true);
    toast(`Notes saved into PowerPoint as version ${out.version.n}. The earlier version is kept.`, { ms: 8000, action: { label: 'Undo', fn: () => undoVersion(d.id, out.version.id) } });
    rerender();
  } catch (e) {
    console.error(e);
    trayItem(tid, { err: 'Not saved: ' + (e.message || e) });
    toast('Notes weren’t saved into PowerPoint: ' + (e.message || e) + '. Your edits are still here as a draft.', { ms: 12000, kind: 'warn' });
  }
}

/* ============ Claude's to-do list for a talk (Drive › Lectern › Requests › <talk>.md) ============ */
function addRequest(d, text, auto) {
  const v = deckVer(d);
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const line = `- [ ] ${text}${auto ? '' : ''} (${date})`;
  const cur = App.requests.get(d.id) || { text: requestHeader(d), modified: '' };
  if (!cur.text.trim()) cur.text = requestHeader(d);
  cur.text = cur.text.replace(/\s*$/, '\n') + line + '\n';
  App.requests.set(d.id, cur); DB.put('kv', 'req:' + d.id, cur);
  enqueue({ t: 'request', deckId: d.id, line });
  if (!syncReady() && !auto) toast('Flag saved on this device. Turn on Drive sync so Claude can see it.', { ms: 7000 });
  rerender();
}

/* ============ J: jot an idea for a talk (Drive › Lectern › Talks › <talk> › ideas.md) ============ */
function jotIdea(d) {
  if (!d) { const list = liveDecks(); if (!list.length) { toast('Add or start a talk first.'); return; } }
  const sel = d ? null : h('select', {}, liveDecks().map(x => h('option', { value: x.id }, x.title)));
  const where = d && Deck.d === d && Deck.v ? ` (while on slide ${Deck.n})` : '';
  const ta = h('textarea', { rows: 3, placeholder: 'An idea, a case, a question to answer, a line to use…', autofocus: true });
  const save = () => {
    const deck = d || App.decks.get(sel.value); const t = ta.value.trim(); if (!t || !deck) return false;
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const line = `- ${t.replace(/\n+/g, ' ')}${where} (${date})`;
    enqueue({ t: 'jot', deckId: deck.id, line, folder: deck.think ? deck.think.folder : talkFolder(deck) });
    toast('Idea kept for Claude.', { ms: 2500 });
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (save() !== false) closeModal(); } });
  modal({ title: d ? `Idea for “${d.title}”` : 'Jot an idea', body: [sel ? h('label', { class: 'pf' }, h('span', { class: 'pl', text: 'For which talk' }), sel) : null, ta,
    h('p', { class: 'hint' }, 'Goes to the talk’s ideas file, which Claude reads. ', h('kbd', { text: 'Enter' }), ' saves.')],
    actions: [{ label: 'Cancel' }, { label: 'Keep it', primary: true, act: save }] });
}
/* ============ the four steps every talk goes through, and the one next thing to do ============ */
const FROM_LABEL = { inbox: 'from Claude', drop: 'added', notes: 'notes edited here', powerpoint: 'edited in PowerPoint', flow: 'from Flow', pdf: 'from a PDF' };
function daysTo(dateStr) { if (!dateStr) return null; const t = new Date(dateStr + 'T00:00:00'), n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((t - n) / 86400000); }
function pipeline(d) {
  const v = deckVer(d), p = d.prep || {}, days = daysTo(d.date), req = openRequests(d), drafts = draftCount(d), t = d.think;
  const think = t ? { state: v || ['building', 'deck'].includes(t.stage) ? 'done' : 'part',
    detail: [t.pack ? `Pack ${t.pack} PDFs ✓` : 'Pack ○', t.notebook ? 'Notebook ✓' : 'Notebook ○', t.spineApproved ? 'Spine ✓' : t.spine ? 'Spine ◐' : 'Spine ○'].join('  ') } : null;
  const make = { state: v ? 'done' : t && t.stage === 'building' ? 'part' : 'todo',
    detail: v ? `v${v.n} ${FROM_LABEL[v.from] || 'added'}, ${fmtDate(v.at)}` : t && t.stage === 'building' ? 'Claude is building it' : 'After the spine is approved' };
  const parts = [['Timed run', p.timed], ['Notes printed', p.printed]];
  const doneN = parts.filter(x => x[1]).length;
  const rehearse = { state: doneN === 2 ? 'done' : doneN ? 'part' : 'todo', parts };
  const present = { state: p.presented ? 'done' : 'todo', detail: p.presented ? `Given ${fmtDate(p.presented)}` : d.date ? (days > 1 ? `${fmtDate(d.date)}, in ${days} days` : days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : `${fmtDate(d.date)}, passed`) : 'No date yet' };
  const improve = { count: req + (drafts ? 1 : 0), detail: drafts ? `${plural(drafts, 'notes edit')} not saved yet` : req ? `${plural(req, 'change')} waiting for Claude` : 'Nothing waiting' };
  let next;
  if (!v && t) next = { text: t.next || (t.stage === 'building' ? 'Claude is building the deck in 2 Slide Workshop. It appears here by itself.' : 'Carry on in this talk’s chat in 1 Talk Ideas.'), label: 'Continue in Claude', fn: () => copyContinue(d) };
  else if (drafts) next = { text: `You edited the notes on ${plural(drafts, 'slide')}. Save them into the PowerPoint file.`, label: 'Save to PowerPoint', fn: () => saveDraftsToPptx(d) };
  else if (v && v.picsState === 'failed') next = { text: 'Google couldn’t draw the slide pictures. Drop the PowerPoint PDF here for exact ones.', label: 'Choose the PDF', fn: () => pickFiles('.pdf', d.id) };
  else if (v && !p.timed) next = { text: 'Do one timed run, out loud: the clock shows where you run long.', label: 'Start timed run', fn: () => { go(`#/d/${d.id}/1/rehearse`); setTimeout(() => startRun(d), 80); } };
  else if (req) next = { text: `${plural(req, 'change')} for Claude. Paste the instruction into this talk’s chat in 2 Slide Workshop.`, label: 'Copy instruction for Claude', fn: () => copyClaudeInstruction(d) };
  else if (v && !p.printed && (days === null || days <= 14)) next = { text: `${days === 0 ? 'Talk today' : days ? plural(days, 'day') + ' to go' : 'When the deck is settled'}: print your podium notes.`, label: 'Print notes', fn: () => go(`#/print/${d.id}`) };
  else if (days !== null && days < 0 && !p.presented) next = { text: 'Did you give this talk?', label: 'Mark as given', fn: () => markGiven(d) };
  else if (!d.date && !p.presented) next = { text: 'Set the talk date and Lectern will pace your preparation.', label: 'Set date', fn: () => editTalkDetails(d) };
  else if (p.presented) next = { text: 'Given. Flags from the talk can still go to Claude for next time.', label: null };
  else next = { text: days ? `Ready. One more timed run the day before (${fmtDate(new Date(new Date(d.date).getTime() - 86400000).toISOString())}).` : 'Ready.', label: null };
  return { think, make, rehearse, present, improve, next };
}
function markGiven(d) { d.prep = Object.assign({}, d.prep, { presented: nowIso() }); saveDeck(d); rerender(); toast('Marked as given.'); }
function copyContinue(d) {
  copyText(`Continue my talk "${d.title}"${d.think ? ` (Lectern › Talks › ${d.think.folder})` : ''}. Read its status.md, spine.md and ideas.md first, then tell me where we are and the next step.`, 'Copied. Paste it into this talk’s chat in Claude › 1 Talk Ideas (or a new chat there).');
}
function copyClaudeInstruction(d) {
  copyText(`Apply my Lectern requests for "${d.title}": read Drive › 00_Apps › Lectern › Requests › ${d.reqName}.md (and the current deck in Decks › ${talkFolder(d)}.pptx), fold any notes I edited in Lectern into the act files, make the slide changes, tick off what you did, then drop the rebuilt .pptx into Drive › 00_Apps › Lectern › Inbox.`,
    'Copied. Paste it into this talk’s chat in Claude › 2 Slide Workshop.');
}
const STEP_MARK = { done: '✓', part: '◐', todo: '○' };
function railHtml(d, compact) {
  const p = pipeline(d);
  if (compact) {
    const segs = [p.think ? ['Think', p.think.state] : null, ['Make', p.make.state], ['Rehearse', p.rehearse.state], ['Present', p.present.state]].filter(Boolean);
    const at = segs.find(x => x[1] !== 'done');
    return h('div', { class: 'prog', title: segs.map(x => `${x[0]}: ${x[1] === 'done' ? 'done' : x[1] === 'part' ? 'under way' : 'not yet'}`).join('\n') },
      h('div', { class: 'segs' }, segs.map(x => h('i', { class: x[1] }))),
      h('span', { class: 'at' }, at ? `At: ${at[0]}` : 'Given', p.improve.count ? h('b', { class: 'badge', title: p.improve.detail, text: '↺ ' + p.improve.count }) : null));
  }
  const step = (n, name, state, detail, onclick) => h('button', { type: 'button', class: `step ${state}`, onclick, title: compact ? detail : null },
    h('span', { class: 'sn' }, n), h('span', { class: 'sname' }, name, ' ', h('i', { class: 'sm', text: STEP_MARK[state] || '' })), compact ? null : h('span', { class: 'sdet', text: detail }));
  const imp = p.improve.count;
  const rail = h('div', { class: 'rail' + (compact ? ' compact' : '') + (p.think ? ' five' : '') },
    p.think ? step('0', 'Think', p.think.state, p.think.detail, compact ? null : () => go(`#/d/${d.id}/1/think`)) : null,
    step('1', 'Make', p.make.state, p.make.detail, compact || !deckVer(d) ? null : () => openVersions(d)),
    step('2', 'Rehearse', p.rehearse.state, compact ? p.rehearse.parts.map(x => (x[1] ? '✓ ' : '○ ') + x[0]).join(', ') : null, compact || !deckVer(d) ? null : () => setMode('rehearse')),
    step('3', 'Present', p.present.state, p.present.detail, compact ? null : () => editTalkDetails(d)),
    h('button', { type: 'button', class: 'step improve' + (imp ? ' has' : ''), onclick: compact ? null : () => openImprove(d), title: compact ? p.improve.detail : null },
      h('span', { class: 'sn' }, '↺'), h('span', { class: 'sname' }, 'Improve', imp ? h('b', { class: 'badge', text: imp }) : null), compact ? null : h('span', { class: 'sdet', text: p.improve.detail })));
  if (!compact) {
    const rs = rail.children[p.think ? 2 : 1];
    const rd = rs.querySelector('.sdet') || h('span', { class: 'sdet' });
    rd.replaceChildren(...p.rehearse.parts.map(x => h('span', { class: x[1] ? 'got' : 'miss' }, (x[1] ? '✓ ' : '○ ') + x[0])));
    if (!rs.querySelector('.sdet')) rs.append(rd);
  }
  return rail;
}
function nextHtml(d, compact) {
  const n = pipeline(d).next;
  return h('div', { class: 'next' + (compact ? ' compact' : '') }, h('span', { class: 'nl' }, 'Next'), h('span', { class: 'nt', text: n.text }),
    n.label && !compact && !(Deck.d === d && Deck.mode === 'rehearse' && n.label === 'Start timed run') ? h('button', { type: 'button', class: 'btn primary small', onclick: n.fn }, n.label) : null);
}

/* ============ the library ============ */
const Lib = { q: '', collapsed: {} };
function seriesGroups() {
  const decks = liveDecks().filter(d => d.role !== 'appendix' || !d.mainId || !App.decks.get(d.mainId) || App.decks.get(d.mainId).deletedAt);
  const groups = new Map();
  for (const d of decks) { const k = d.series || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
  for (const list of groups.values()) list.sort((a, b) => (a.seriesOrder ?? 999) - (b.seriesOrder ?? 999) || String(b.createdAt).localeCompare(a.createdAt));
  return [...groups.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0]));
}
function appendixOf(d) { return liveDecks().find(x => x.mainId === d.id); }
function deckCard(d) {
  const v = deckVer(d);
  const mins = talkMinutes(d), ap = appendixOf(d);
  const resume = d.pos && d.pos.n > 1 && v && d.pos.n <= v.slides.length;
  const card = h('article', { class: 'card', tabindex: '0', onclick: () => go(`#/d/${d.id}/${resume ? d.pos.n : 1}`), onkeydown: e => { if (e.key === 'Enter') go(`#/d/${d.id}/${resume ? d.pos.n : 1}`); } },
    v ? slideImage(v, 1, false, 'cover') : h('div', { class: 'pic cover textpic' }),
    h('div', { class: 'cbody' },
      h('h3', { text: d.title }),
      h('p', { class: 'meta' }, v ? `${plural(v.slides.length, 'slide')}${mins ? ', ' + fmtMin(mins) : ''}` : 'No slides', ap ? ', with appendix' : '', resume ? h('span', { class: 'resume', text: `Resume at ${d.pos.n}` }) : null),
      railHtml(d, true),
      h('p', { class: 'cnext', text: pipeline(d).next.text })));
  return card;
}
function renderLibrary() {
  const main = $('#main');
  const decks = liveDecks();
  const head = h('header', { class: 'libhead' },
    h('div', { class: 'brandrow' }, h('h1', { class: 'brand' }, 'Lectern'), h('p', { class: 'tag', text: 'Your talks, from the first idea to the podium.' }),
      h('div', { class: 'headbtns' }, btn('How it works', { icon: 'help', quiet: true, onclick: () => openHelp() }), btn('Settings', { icon: 'gear', quiet: true, iconOnly: true, onclick: () => openSettings() }))),
    h('div', { class: 'searchrow' },
      h('label', { class: 'search' }, icon('search'), h('input', { id: 'libq', type: 'search', placeholder: 'Search every slide and note', value: Lib.q, autocomplete: 'off', spellcheck: 'false',
        oninput: debounce(e => { Lib.q = e.target.value; renderLibraryBody(); }, 120), onkeydown: e => { if (e.key === 'Enter') { const f = $('.hit'); if (f) f.click(); } } }), h('kbd', { text: '/' })),
      btn('Add a talk', { icon: 'plus', primary: true, onclick: () => pickFiles('.pptx,.pdf') })));
  main.replaceChildren(head, h('div', { id: 'libbody' }));
  renderLibraryBody();
  if (!decks.length) return;
}
function renderLibraryBody() {
  const body = $('#libbody'); if (!body) return;
  const decks = liveDecks();
  if (Lib.q.trim()) { body.replaceChildren(searchResults(Lib.q.trim())); return; }
  if (!decks.length) { body.replaceChildren(emptyLibrary()); return; }
  const out = [];
  const recent = decks.filter(d => d.pos && d.pos.at).sort((a, b) => String(b.pos.at).localeCompare(a.pos.at))[0];
  const upcoming = decks.filter(d => d.date && daysTo(d.date) >= 0 && !(d.prep || {}).presented).sort((a, b) => a.date.localeCompare(b.date))[0];
  const focus = upcoming || recent;
  if (focus) {
    const v = deckVer(focus);
    out.push(h('section', { class: 'focus' }, h('div', { class: 'ftext' },
      h('p', { class: 'fk', text: upcoming ? (daysTo(focus.date) === 0 ? 'Talk today' : `Next talk, in ${plural(daysTo(focus.date), 'day')}`) : 'Carry on where you left off' }),
      h('h2', { text: focus.title }),
      railHtml(focus, false), nextHtml(focus, false),
      h('div', { class: 'factions' }, btn(focus.pos && focus.pos.n > 1 ? `Open at slide ${focus.pos.n}` : 'Open', { primary: false, onclick: () => go(`#/d/${focus.id}/${focus.pos && focus.pos.n || 1}`) }))),
      v ? h('div', { class: 'fpic', onclick: () => go(`#/d/${focus.id}/${focus.pos && focus.pos.n || 1}`) }, slideImage(v, Math.min(v.slides.length, focus.pos && focus.pos.n || 1), true)) : null));
  }
  for (const [series, list] of seriesGroups()) {
    const k = series || '_';
    const coll = !!Lib.collapsed[k];
    out.push(h('section', { class: 'group' },
      h('button', { type: 'button', class: 'ghead', 'aria-expanded': String(!coll), onclick: () => { Lib.collapsed[k] = !coll; renderLibraryBody(); } },
        h('h2', { text: series || (seriesGroups().length > 1 ? 'Other talks' : 'Talks') }), h('span', { class: 'gcount', text: plural(list.length, 'talk') })),
      coll ? null : h('div', { class: 'cards' }, list.map(deckCard))));
  }
  body.replaceChildren(...out);
}
function emptyLibrary() {
  return h('section', { class: 'empty' },
    h('div', { class: 'drop-hero', onclick: () => pickFiles('.pptx,.pdf') },
      icon('upload', 'big'), h('h2', { text: 'Drop a PowerPoint here' }),
      h('p', { text: 'Or click to choose a .pptx. Lectern reads the slides and your speaker notes, and keeps the original safe in Drive.' })),
    howItWorks());
}
function howItWorks() {
  const step = (n, t, d) => h('li', {}, h('b', { class: 'hn', text: n }), h('div', {}, h('strong', { text: t }), h('p', { text: d })));
  return h('div', { class: 'how' },
    h('h3', { text: 'How a talk gets made' }),
    h('ol', { class: 'loop' },
      step('0', 'Think, in Claude', 'In the 1 Talk Ideas project say “New talk: topic, audience, length, date”. Claude gathers a pack of your PDFs, makes the NotebookLM notebook, and writes a one-page spine with you. The talk shows up here straight away.'),
      step('1', 'Make, in Claude', 'In 2 Slide Workshop say “Build <talk>”. When you approve it, the deck arrives here by itself.'),
      step('2', 'Rehearse, here', 'Timed run out loud; print your podium notes. Edit notes with E; flag a slide with C.'),
      step('3', 'Present, here', 'Speaker view on your laptop, clean slides on the projector. Or take the .pptx to the venue PC.'),
      step('↺', 'Improve', 'Your flags and notes edits go back to Claude, and the next version comes back here.')),
    h('p', { class: 'hint', text: 'Jot an idea for any talk with J. Everything is kept in My Drive › 00_Apps › Lectern.' }));
}

/* ---------- search across every talk ---------- */
function searchResults(q) {
  const ql = q.toLowerCase(), terms = ql.split(/\s+/).filter(Boolean);
  const talks = [], hits = [];
  for (const d of liveDecks()) {
    const v = deckVer(d); if (!v) continue;
    if (terms.every(t => d.title.toLowerCase().includes(t))) talks.push(d);
    for (const s of v.slides) {
      const notes = noteText(d, s.n), hay = (s.title + '\n' + s.text + '\n' + notes).toLowerCase();
      if (!terms.every(t => hay.includes(t))) continue;
      const inSlide = terms.every(t => (s.title + '\n' + s.text).toLowerCase().includes(t));
      hits.push({ d, v, s, where: inSlide ? 'slide' : 'notes', snip: snippet(inSlide ? s.text || s.title : notes, terms[0]) });
      if (hits.length > 120) break;
    }
  }
  const wrap = h('section', { class: 'results' });
  if (!talks.length && !hits.length) { wrap.append(h('p', { class: 'none', text: `Nothing matches “${q}”. Try fewer words.` })); return wrap; }
  if (talks.length) wrap.append(h('h2', { text: plural(talks.length, 'talk') }), h('div', { class: 'cards' }, talks.map(deckCard)));
  if (hits.length) wrap.append(h('h2', { text: `${hits.length > 120 ? '120+' : hits.length} slides` }), h('div', { class: 'hits' }, hits.map(x =>
    h('button', { type: 'button', class: 'hit', onclick: () => go(`#/d/${x.d.id}/${x.s.n}`) },
      slideImage(x.v, x.s.n, false), h('div', { class: 'htext' }, h('p', { class: 'hk' }, h('span', { text: x.d.title }), ` slide ${x.s.n}`, x.where === 'notes' ? h('i', { text: ' in notes' }) : null),
        h('p', { class: 'hs', html: highlight(x.snip, terms) }))))));
  return wrap;
}
function snippet(text, term) {
  const t = String(text || '').replace(/\s+/g, ' '), i = t.toLowerCase().indexOf(term);
  if (i < 0) return t.slice(0, 160);
  const a = Math.max(0, i - 60);
  return (a ? '…' : '') + t.slice(a, a + 170) + (a + 170 < t.length ? '…' : '');
}
function highlight(text, terms) {
  let out = esc(text);
  for (const t of terms) { if (!t) continue; out = out.replace(new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); }
  return out;
}

function pickFiles(accept, target) {
  const inp = h('input', { type: 'file', accept: accept || '.pptx,.pdf', multiple: true, style: { display: 'none' } });
  inp.addEventListener('change', () => { handleFiles(inp.files, target); inp.remove(); });
  document.body.append(inp); inp.click();
}

/* ============ one talk: Plan, Review, Rehearse, Present ============ */
const Deck = { d: null, v: null, n: 1, mode: 'review', editing: false, grid: false, jump: '', jumpT: 0 };
const MODES = [['review', 'Review', 'V'], ['rehearse', 'Rehearse', 'R'], ['present', 'Present', 'P']];

function renderDeck(id, n, mode) {
  const d = App.decks.get(id);
  if (!d || d.deletedAt) { go('#/'); return; }
  const v = deckVer(d);
  if (!v && mode !== 'think') mode = d.think ? 'think' : 'review';
  if (mode === 'think' && !d.think) mode = 'review';
  const changedDeck = Deck.d !== d || Deck.v !== v || Deck.mode !== mode;
  Deck.d = d; Deck.v = v; Deck.mode = mode || 'review';
  Deck.n = v ? clamp(Number(n) || 1, 1, v.slides.length) : 1;
  if (!changedDeck && $('#main .deck')) { showSlide(Deck.n); return; }
  Deck.editing = false; Deck.grid = false;
  const main = $('#main');
  const series = d.series ? h('span', { class: 'crumb', text: d.series }) : null;
  const head = h('header', { class: 'dhead' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/', class: 'crumb home' }, icon('back'), 'Lectern'), series ? h('i', { class: 'sep', text: '›' }) : null, series,
      h('i', { class: 'sep', text: '›' }), h('button', { type: 'button', class: 'dtitle', title: 'Rename', onclick: () => renameDeck(d) }, d.title)),
    v ? h('div', { class: 'tabs', role: 'tablist' }, MODES.map(([m, label, key]) => h('button', { type: 'button', role: 'tab', class: 'tab' + (Deck.mode === m ? ' on' : ''), 'aria-selected': String(Deck.mode === m), title: `${label} (${key})`, onclick: () => setMode(m) }, label, h('kbd', { text: key })))) : h('div', { class: 'tabs' }),
    h('div', { class: 'dtools' }, btn('Help', { icon: 'help', iconOnly: true, quiet: true, onclick: () => openHelp() }), btn('More', { icon: 'dots', iconOnly: true, quiet: true, onclick: e => deckMenu(d, e.currentTarget) })));
  const wrap = h('div', { class: 'deck mode-' + Deck.mode }, head, h('div', { class: 'railrow' }, railHtml(d, false), nextHtml(d, false)));
  if (Deck.mode === 'think') wrap.append(thinkView(d));
  else if (Deck.mode === 'present') wrap.append(presentStart(d));
  else wrap.append(workArea());
  main.replaceChildren(wrap);
  if (v && Deck.mode !== 'present' && Deck.mode !== 'think') showSlide(Deck.n, true);
  renderEditBar();
}
function setMode(m) { if (!Deck.d) return; if (Deck.mode === 'rehearse' && Run.active && m !== 'rehearse') { toast('Finish or stop the timed run first.'); return; } go(`#/d/${Deck.d.id}/${Deck.n}/${m}`); }

function workArea() {
  const d = Deck.d, v = Deck.v;
  const film = h('div', { class: 'filmstrip', id: 'film', hidden: !App.prefs.filmstrip }, v.slides.map(s => h('button', { type: 'button', class: 'fthumb' + (s.hidden ? ' hid' : ''), dataset: { n: s.n }, title: `${s.n}. ${s.title}`, onclick: () => goSlide(s.n) },
    slideImage(v, s.n, false), h('span', { class: 'fn', text: s.n }))));
  const stage = h('div', { class: 'stage', id: 'stage' },
    h('button', { type: 'button', class: 'navbtn prev', 'aria-label': 'Previous slide', onclick: () => goSlide(Deck.n - 1) }, icon('prev')),
    h('div', { class: 'slidebox', id: 'slidebox', onclick: e => { if (e.offsetX > e.currentTarget.clientWidth * 0.3) goSlide(Deck.n + 1); else goSlide(Deck.n - 1); } }),
    h('button', { type: 'button', class: 'navbtn next', 'aria-label': 'Next slide', onclick: () => goSlide(Deck.n + 1) }, icon('next')),
    h('button', { type: 'button', class: 'fsbtn', title: 'Full screen (F)', 'aria-label': 'Full screen', onclick: () => toggleFull($('#stage')) }, icon('full')));
  const under = h('div', { class: 'underbar' },
    h('div', { class: 'counter', id: 'counter' }),
    h('div', { class: 'acts' },
      btn('Edit notes', { icon: 'edit', key: 'E', cls: 'act-edit', onclick: () => startEdit() }),
      btn('Change this slide', { icon: 'flag', key: 'C', cls: 'act-flag', onclick: () => flagSlide() }),
      btn('Read aloud', { icon: 'speaker', key: 'L', cls: 'act-read', onclick: () => Voice.toggleSlide(Deck.d, Deck.n) })),
    h('div', { class: 'views' },
      btn('All slides', { icon: 'grid', iconOnly: true, quiet: true, title: 'All slides (G)', onclick: () => toggleGrid() }),
      btn('Filmstrip', { icon: 'film', iconOnly: true, quiet: true, title: 'Filmstrip (T)', onclick: () => toggleFilm() }),
      btn('Script', { icon: 'notes', iconOnly: true, quiet: true, title: 'Script panel (N)', onclick: () => toggleNotes() })));
  const left = h('section', { class: 'stagecol' }, Deck.mode === 'rehearse' ? rehearseBar() : null, stage, under, film);
  const script = h('aside', { class: 'script', id: 'script', hidden: !App.prefs.notesOpen });
  return h('div', { class: 'work' }, left, script);
}

function goSlide(n) {
  if (!Deck.v) return;
  n = clamp(n, 1, Deck.v.slides.length);
  if (n === Deck.n) { if (n === Deck.v.slides.length && Run.active) offerFinishRun(); return; }
  if (Deck.editing) commitEdit();
  Run.onSlide && Run.onSlide(Deck.n, n);
  Deck.n = n;
  try { history.replaceState(null, '', `#/d/${Deck.d.id}/${n}${Deck.mode !== 'review' ? '/' + Deck.mode : ''}`); } catch (e) { }
  showSlide(n);
}
function showSlide(n, first) {
  const d = Deck.d, v = Deck.v, s = v.slides[n - 1];
  const box = $('#slidebox'); if (!box) return;
  box.replaceChildren(slideImage(v, n, true, 'main'));
  const flags = slideFlags(d, n);
  $('#counter').replaceChildren(...[h('b', { text: `${n}` }), h('span', { class: 'of', text: `/ ${v.slides.length}` }), h('span', { class: 'ct', text: s.title }),
    s.hidden ? h('span', { class: 'tagpill', text: 'hidden slide' }) : null,
    flags.length ? h('button', { type: 'button', class: 'tagpill flagged', title: flags.map(f => f.text).join('\n'), onclick: () => openImprove(d) }, icon('flag'), plural(flags.length, 'flag')) : null,
    draftFor(d) && draftFor(d).edits[n] !== undefined ? h('span', { class: 'tagpill edited', text: 'notes edited' }) : null].filter(Boolean));
  $$('#film .fthumb').forEach(b => b.classList.toggle('on', Number(b.dataset.n) === n));
  const cur = $(`#film .fthumb[data-n="${n}"]`); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: first ? 'auto' : 'smooth' });
  renderScript();
  // remember the place, synced lightly
  d.pos = { n, at: nowIso() }; App.decks.set(d.id, d); DB.put('decks', d.id, d); savePosSoon();
  // pre-load the neighbours
  if (v.picsId) { picURL(v.picsId, n + 1, true); picURL(v.picsId, n - 1, true); }
  if (Deck.grid) renderGrid();
  Run.render && Run.render();
  Voice.onSlideShown && Voice.onSlideShown(n);
}
const savePosSoon = debounce(() => { if (Deck.d) markDirty('d:' + Deck.d.id); }, 20000);

/* ---------- the script panel: your notes, readable, and editable in place ---------- */
function renderScript() {
  const el = $('#script'); if (!el || el.hidden) return;
  const d = Deck.d, v = Deck.v, n = Deck.n, s = v.slides[n - 1];
  const text = noteText(d, n), words = wordsOf(text);
  const tgt = slideTargets(d)[n - 1] || 0;
  const head = h('div', { class: 'shead' },
    h('h2', {}, 'Script', h('span', { class: 'smeta', text: words ? `${words} words, about ${fmtClock(words / App.prefs.wpm * 60000)}${tgt ? `; target ${fmtClock(tgt)}` : ''}` : 'No notes on this slide' })),
    h('div', { class: 'sctl' },
      btn('Smaller text', { iconOnly: true, quiet: true, cls: 'tsz', onclick: () => textSize(-1) }), h('span', { class: 'tsl', text: 'A' }), btn('Larger text', { iconOnly: true, quiet: true, cls: 'tsz up', onclick: () => textSize(1) })));
  let body;
  if (Deck.editing) {
    const ta = h('textarea', { id: 'noteedit', class: 'noteedit', spellcheck: 'true', 'aria-label': `Notes for slide ${n}` });
    ta.value = text;
    ta.addEventListener('input', debounce(() => { setDraft(d, n, ta.value); }, 300));
    ta.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); commitEdit(); } if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitEdit(); } });
    body = h('div', { class: 'sbody editing' }, ta, h('p', { class: 'hint' }, 'Editing slide ', h('b', { text: n }), '. Changes are kept as you type. ', h('kbd', { text: 'Esc' }), ' when done; then ', h('b', { text: 'Save to PowerPoint' }), ' at the bottom writes them into the .pptx. Tags like [Pause] still work.'));
    setTimeout(() => { ta.focus(); if (Deck.caret != null) { ta.setSelectionRange(Deck.caret, Deck.caret); Deck.caret = null; } }, 20);
  } else if (Run.cue && text) {
    body = h('div', { class: 'sbody cue', style: { fontSize: App.prefs.notesSize + 'px' } }, cueCards(text));
  } else if (text) {
    const blocks = notesBlocks(text);
    let lastLabel = '';
    body = h('div', { class: 'sbody', style: { fontSize: App.prefs.notesSize + 'px' }, title: 'Click to edit', onclick: e => {
      const p = e.target.closest('[data-off]'); Deck.caret = p ? Number(p.dataset.off) : null; startEdit(); } },
      blocks.map(b => {
        const lab = b.label && b.label !== lastLabel ? h('p', { class: 'blabel', text: b.label === 'opening' ? 'Opening remarks' : 'Closing remarks' }) : null;
        lastLabel = b.label;
        return [lab, h('p', { class: 'para' + (b.label ? ' ' + b.label : ''), dataset: { off: Math.max(0, text.indexOf(b.text.slice(0, 30))) }, html: scriptHtml(b.text) })];
      }));
  } else {
    body = h('div', { class: 'sbody none' }, h('p', { text: 'No speaker notes on this slide.' }), btn('Write notes for this slide', { icon: 'edit', onclick: () => startEdit() }));
  }
  el.replaceChildren(...[head, body, s.text && !Deck.editing ? h('details', { class: 'slidetext' }, h('summary', { text: 'Text on the slide' }), h('p', { text: s.text })) : null].filter(Boolean));
}
function scriptHtml(t) {
  return esc(t).replace(/\[pause[^\]]*\]/gi, '<span class="pausemark" title="Pause">‖</span>').replace(/\[([A-Z][A-Za-z /-]{1,24})\]/g, '<span class="cue-tag">$1</span>');
}
function cueCards(text) {
  // memorise the seams: first and last sentence of the slide, the middle hidden until you tap
  const all = sentences(notesBlocks(text).map(b => b.text).join(' '));
  if (all.length <= 2) return h('p', { class: 'para', html: scriptHtml(all.join(' ')) });
  const mid = all.slice(1, -1);
  const hidden = h('p', { class: 'para mid', hidden: true, html: scriptHtml(mid.join(' ')) });
  const reveal = h('button', { type: 'button', class: 'reveal', onclick: () => { hidden.hidden = false; reveal.remove(); } }, `${plural(mid.length, 'sentence')} in the middle. Say them, then tap to check (Space).`);
  return [h('p', { class: 'para launch', html: scriptHtml(all[0]) }), reveal, hidden, h('p', { class: 'para land', html: scriptHtml(all[all.length - 1]) })];
}
function textSize(dir) { App.prefs.notesSize = clamp(App.prefs.notesSize + dir * 2, 13, 34); saveKV('prefs'); renderScript(); }
function startEdit() {
  if (!Deck.v) return;
  if (!App.prefs.notesOpen) { App.prefs.notesOpen = true; const s = $('#script'); if (s) s.hidden = false; }
  if (Voice.busy) Voice.stop();
  Deck.editing = true; renderScript();
}
function commitEdit() {
  const ta = $('#noteedit');
  if (ta && Deck.d) setDraft(Deck.d, Deck.n, ta.value);
  Deck.editing = false; renderScript(); showSlideMarks();
}
function showSlideMarks() { if (Deck.v && $('#counter')) { const n = Deck.n; const d = Deck.d; const ed = draftFor(d) && draftFor(d).edits[n] !== undefined; const c = $('#counter .edited'); if (ed && !c) $('#counter').append(h('span', { class: 'tagpill edited', text: 'notes edited' })); if (!ed && c) c.remove(); } }
function renderEditBar() {
  let bar = $('#editbar');
  const d = Deck.d, k = d ? draftCount(d) : 0;
  if (!k || !d || !$('#main .deck')) { if (bar) bar.remove(); return; }
  const nums = Object.keys(draftFor(d).edits).map(Number).sort((a, b) => a - b);
  const content = [h('span', { class: 'eb-t' }, h('b', { text: `${plural(k, 'slide')} edited` }), ` (${nums.slice(0, 8).join(', ')}${nums.length > 8 ? '…' : ''}). Not in the PowerPoint file yet.`),
    btn('Save to PowerPoint', { primary: true, icon: 'check', onclick: () => saveDraftsToPptx(d) }),
    btn('Discard edits', { quiet: true, onclick: () => modal({ title: 'Discard your notes edits?', body: h('p', { text: `The edits on ${plural(k, 'slide')} go; the PowerPoint file is unchanged.` }), actions: [{ label: 'Keep them' }, { label: 'Discard', danger: true, act: () => discardDrafts(d) }] }) })];
  if (!bar) { bar = h('div', { id: 'editbar', class: 'editbar' }); document.body.append(bar); }
  bar.replaceChildren(...content);
}

/* ---------- flag a slide for Claude ---------- */
function slideFlags(d, n) { return requestLines(d).filter(r => !r.done && new RegExp(`^Slide ${n}\\b`).test(r.text)); }
function flagSlide(n) {
  const d = Deck.d, v = Deck.v; if (!d || !v) return;
  n = n || Deck.n;
  const wasRunning = Run.active && !Run.paused; if (wasRunning) Run.pause();
  if (Voice.busy) Voice.pause();
  const ta = h('textarea', { rows: 3, placeholder: 'What should change on this slide? e.g. chart labels too small; split into two slides; drop the second bullet', autofocus: true });
  const send = () => {
    const t = ta.value.trim(); if (!t) return false;
    addRequest(d, `Slide ${n} (v${v.n}, “${v.slides[n - 1].title.slice(0, 60)}”): ${t}`);
    toast(`Flagged slide ${n} for Claude.`, { ms: 3000, important: true });
    showSlide(Deck.n);
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (send() !== false) { closeModal(); resume(); } } });
  const resume = () => { if (wasRunning) Run.resume(); };
  modal({ title: `Change slide ${n}`, body: [ta, h('p', { class: 'hint' }, 'Goes on this talk’s list for Claude (Drive › Lectern › Requests). ', h('kbd', { text: 'Enter' }), ' to save, ', h('kbd', { text: 'Shift+Enter' }), ' for a new line.', wasRunning ? ' The run clock is paused meanwhile.' : '')],
    actions: [{ label: 'Cancel', act: () => { resume(); } }, { label: 'Flag for Claude', primary: true, act: () => { if (send() === false) return false; resume(); } }] });
}

/* ---------- views: filmstrip, notes panel, grid, full screen ---------- */
function toggleFilm() { App.prefs.filmstrip = !App.prefs.filmstrip; saveKV('prefs'); const f = $('#film'); if (f) { f.hidden = !App.prefs.filmstrip; showSlide(Deck.n); } }
function toggleNotes() { App.prefs.notesOpen = !App.prefs.notesOpen; saveKV('prefs'); const s = $('#script'); if (s) { s.hidden = !App.prefs.notesOpen; renderScript(); } }
function toggleGrid() { Deck.grid = !Deck.grid; renderGrid(); }
function renderGrid() {
  let g = $('#grid');
  if (!Deck.grid) { if (g) g.remove(); return; }
  const v = Deck.v;
  if (!g) {
    g = h('div', { id: 'grid', class: 'gridview', role: 'dialog', 'aria-label': 'All slides' },
      h('div', { class: 'ghead2' }, h('h2', { text: `All ${v.slides.length} slides` }), btn('Close', { icon: 'close', quiet: true, onclick: () => toggleGrid(), key: 'G' })),
      h('div', { class: 'gcells' }, v.slides.map(s => h('button', { type: 'button', class: 'gcell' + (slideFlags(Deck.d, s.n).length ? ' flagged' : ''), dataset: { n: s.n }, onclick: () => { Deck.grid = false; renderGrid(); goSlide(s.n); } },
        slideImage(v, s.n, false), h('span', { class: 'gn' }, h('b', { text: s.n }), ' ', s.title)))));
    $('#main .deck').append(g);
  }
  $$('#grid .gcell').forEach(c => c.classList.toggle('on', Number(c.dataset.n) === Deck.n));
  const on = $('#grid .gcell.on'); if (on) on.scrollIntoView({ block: 'center' });
}
function toggleFull(el) {
  if (document.fullscreenElement) document.exitFullscreen();
  else (el || document.documentElement).requestFullscreen().catch(() => toast('Full screen isn’t allowed here.'));
}

/* ---------- talk details, versions, menu ---------- */
function renameDeck(d) {
  const inp = h('input', { type: 'text', value: d.title, autofocus: true });
  modal({ title: 'Rename talk', body: [inp, h('p', { class: 'hint', text: 'Changes the name in Lectern and of the current .pptx in Drive › Lectern › Decks.' })],
    actions: [{ label: 'Cancel' }, { label: 'Rename', primary: true, act: async () => { const t = inp.value.trim(); if (!t) return false; d.title = t; await saveDeck(d); if (syncReady() && deckVer(d)) refreshMaster(d, deckVer(d)).catch(() => { }); rerender(); } }] });
}
function editTalkDetails(d) {
  const date = h('input', { type: 'date', value: d.date || '' });
  const mins = h('input', { type: 'number', min: 5, max: 600, step: 5, value: talkMinutes(d) || '' });
  const series = h('input', { type: 'text', value: d.series || '', placeholder: 'e.g. When Results Disagree', list: 'serieslist' });
  const order = h('input', { type: 'number', min: 0, max: 99, value: d.seriesOrder ?? '' });
  const dl = h('datalist', { id: 'serieslist' }, [...new Set(liveDecks().map(x => x.series).filter(Boolean))].map(s => h('option', { value: s })));
  const words = deckWords(deckVer(d));
  modal({ title: 'Talk details', body: h('div', { class: 'form' },
    h('label', {}, h('span', { text: 'Talk date' }), date), h('label', {}, h('span', { text: 'Talk length (minutes)' }), mins,
      words ? h('small', { text: `Your notes are ${words.toLocaleString()} words: about ${Math.round(words / App.prefs.wpm)} min at ${App.prefs.wpm} words a minute.` }) : null),
    h('label', {}, h('span', { text: 'Series' }), series, dl), h('label', {}, h('span', { text: 'Order in series' }), order)),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, act: async () => {
      d.date = date.value || ''; d.talkMin = Number(mins.value) || null; d.series = series.value.trim(); d.seriesOrder = order.value === '' ? null : Number(order.value);
      await saveDeck(d); const ap = appendixOf(d); if (ap) { ap.series = d.series; ap.seriesOrder = d.seriesOrder; await saveDeck(ap); } rerender(); } }] });
}
function openVersions(d) {
  const list = [...App.versions.values()].filter(v => v.deckId === d.id).sort((a, b) => b.n - a.n);
  modal({ title: `Versions of “${d.title}”`, wide: true, body: h('div', { class: 'vlist' }, list.map(v => h('div', { class: 'vrow' + (v.id === d.verId ? ' cur' : '') },
    h('b', { text: `Version ${v.n}` }), h('span', { text: `${fmtDate(v.at)}, ${FROM_LABEL[v.from] || ''}${v.note ? ': ' + v.note : ''}` }), h('span', { class: 'mut', text: `${plural(v.slides.length, 'slide')}, ${v.name}` }),
    h('div', { class: 'vact' }, v.id === d.verId ? h('span', { class: 'tagpill', text: 'current' }) : btn('Make current', { quiet: true, onclick: async () => { d.verId = v.id; await saveDeck(d); if (syncReady() && v.origId) refreshMaster(d, v).catch(() => { }); closeModal(); rerender(); toast(`Version ${v.n} is current again.`); } }),
      btn('Download .pptx', { quiet: true, icon: 'download', onclick: () => downloadOriginal(d, v) })))),
    h('p', { class: 'hint', text: 'Every version is kept in Drive › 00_Apps › Lectern › Decks › _versions.' })) });
}
async function downloadOriginal(d, v) {
  v = v || deckVer(d);
  let blob = await DB.get('files', 'orig/' + v.id);
  if (!blob && v.origId && syncReady()) { toast('Getting it from Drive…'); try { const f = await downFile(v.origId); blob = new Blob([f.bytes], { type: PPTX_MIME }); await DB.put('files', 'orig/' + v.id, blob); } catch (e) { toast('Couldn’t get it from Drive: ' + syncErrText(e.code), { kind: 'warn' }); return; } }
  if (!blob) { toast('This .pptx isn’t on this device, and Drive sync is off.', { kind: 'warn' }); return; }
  downloadBlob(blob, v.name);
}
function deckMenu(d, anchor) {
  const items = [
    ['Talk details: date, length, series', () => editTalkDetails(d)], ['Rename', () => renameDeck(d)], ['Versions', () => openVersions(d)],
    deckVer(d) ? ['Download the .pptx', () => downloadOriginal(d)] : null,
    deckVer(d) ? ['Use exact pictures from a PDF…', () => pickFiles('.pdf', d.id)] : null,
    deckVer(d) && syncReady() && deckVer(d).picsSrc !== 'pdf' ? ['Ask Google to redraw the pictures', () => { const v = deckVer(d); v.picsState = 'waiting'; v.picsSrc = ''; saveVersion(v); enqueue({ t: 'google', verId: v.id }); toast('Redrawing in the background.'); }] : null,
    ['Claude’s list for this talk', () => openImprove(d)],
    ['Move to deleted talks', () => deleteDeck(d)],
  ].filter(Boolean);
  popMenu(anchor, items);
}
function popMenu(anchor, items) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu', role: 'menu', style: { top: (r.bottom + 6) + 'px', right: Math.max(8, innerWidth - r.right) + 'px' } },
    items.map(([label, fn]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenus(); fn(); } }, label)));
  document.body.append(m);
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
  const f = m.querySelector('button'); if (f) f.focus();
}
function closeMenus() { $$('.menu').forEach(m => m.remove()); }
async function deleteDeck(d) {
  d.deletedAt = nowIso(); await saveDeck(d);
  const ap = appendixOf(d); if (ap) { ap.deletedAt = d.deletedAt; await saveDeck(ap); }
  go('#/');
  toast(`“${d.title}” moved to deleted talks. Its files stay in Drive.`, { ms: 9000, action: { label: 'Undo', fn: async () => { d.deletedAt = null; await saveDeck(d); if (ap) { ap.deletedAt = null; await saveDeck(ap); } rerender(); } } });
}

/* ---------- "Sounds like AI?": common tells in slide text and notes ---------- */
const AI_WORDS = ['delve', 'landscape', 'navigate', 'navigating', 'robust', 'leverage', 'leveraging', 'unlock', 'unlocking', 'journey', 'crucial', 'pivotal', 'seamless', 'seamlessly', 'holistic', 'game-changer', 'game changer', 'key takeaways', 'in today’s', "in today's", 'tapestry', 'testament', 'realm', 'elevate', 'empower', 'harness', 'paradigm shift', 'let’s dive', "let's dive", 'dive into', 'in conclusion'];
function aiTells(v) {
  const out = [];
  const wordRe = new RegExp('\\b(' + AI_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi');
  for (const s of v.slides) {
    if (s.hidden) continue;
    const why = [];
    const body = s.text.split('\n').slice(1).map(x => x.trim()).filter(Boolean);
    const short = body.filter(l => l.split(/\s+/).length <= 7);
    if (body.length === 3 && short.length === 3) why.push('three short parallel lines');
    if (/^\s*[A-Z][a-z]+\.\s+[A-Z][a-z]+\.\s+[A-Z][a-z]+\.\s*$/m.test(s.text)) why.push('three-word slogan');
    if (/^[^:\n]{2,40}:\s+\S/.test(s.title) && !/\d:\d/.test(s.title)) why.push('“Topic: subtitle” title');
    if (/\bnot (just |only |merely )?[^.,;]{1,40}, but\b|\bit[’']s not (just|only|about)\b/i.test(s.text + ' ' + s.notes)) why.push('“not X, but Y”');
    const words = new Set(((s.text + ' ' + s.notes).match(wordRe) || []).map(w => w.toLowerCase()));
    if (words.size) why.push('words: ' + [...words].join(', '));
    if (/[\u2014]/.test(s.text)) why.push('em dash on the slide');
    if (why.length) out.push({ n: s.n, title: s.title, why });
  }
  return out;
}

/* ---------- Improve: Claude's list, unsaved notes, what changed ---------- */
function openImprove(d) {
  const lines = requestLines(d), drafts = draftCount(d), v = deckVer(d);
  const prev = v && v.prevId && App.versions.get(v.prevId);
  const changed = prev ? v.slides.filter((s, i) => !prev.slides[i] || prev.slides[i].notes !== s.notes || prev.slides[i].text !== s.text || prev.slides[i].title !== s.title).map(s => s.n) : [];
  modal({ title: `Improve “${d.title}”`, wide: true, body: h('div', { class: 'improve' },
    drafts ? h('div', { class: 'callout' }, h('p', {}, h('b', { text: `${plural(drafts, 'slide')} with edited notes` }), ' not yet saved into the PowerPoint file.'), btn('Save to PowerPoint', { primary: true, onclick: () => { closeModal(); saveDraftsToPptx(d); } })) : null,
    h('h3', { text: 'Claude’s list' }),
    lines.length ? h('ul', { class: 'reqs' }, lines.map(r => h('li', { class: r.done ? 'done' : '' }, h('span', { class: 'rk', text: r.done ? '✓' : '○' }), h('span', { text: r.text })))) : h('p', { class: 'mut', text: 'Nothing yet. Press C on any slide to flag a change for Claude.' }),
    lines.some(r => !r.done) ? h('div', { class: 'callout' }, h('p', {}, 'To apply these: open Claude, then your ', h('b', { text: '2 Slide Workshop' }), ' project, and paste the instruction. The rebuilt deck comes back here by itself.'), btn('Copy instruction for Claude', { primary: true, onclick: () => copyClaudeInstruction(d) })) : null,
    (() => { if (!v) return null; const tells = aiTells(v); if (!tells.length) return [h('h3', { text: 'Sounds like AI?' }), h('p', { class: 'mut', text: 'No common tells found: no triplet slogans, formula titles or giveaway words.' })];
      return [h('h3', { text: `Sounds like AI? ${plural(tells.length, 'slide')}` }), h('ul', { class: 'reqs' }, tells.slice(0, 40).map(t => h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => { closeModal(); go(`#/d/${d.id}/${t.n}`); } }, `Slide ${t.n}`), h('span', { class: 'mut', text: ` ${t.why.join('; ')}` })))),
        btn('Send these to Claude to make more human', { onclick: () => { addRequest(d, `Make more human (v${v.n}): ` + tells.map(t => `slide ${t.n} (${t.why.join('; ')})`).join('; ') + '. Keep the content; vary the form; no reflex threes.'); closeModal(); toast('Sent to Claude’s list.'); } })]; })(),
    prev ? [h('h3', { text: `What changed in version ${v.n}` }), changed.length ? h('div', { class: 'changed' }, changed.slice(0, 60).map(n => h('button', { type: 'button', class: 'chg', onclick: () => { closeModal(); go(`#/d/${d.id}/${n}`); } }, slideImage(v, n, false), h('span', { text: `Slide ${n}` })))) : h('p', { class: 'mut', text: 'No slide text or notes differ from the previous version (pictures may have).' })] : null,
    h('p', { class: 'hint', text: `The list lives in Drive › 00_Apps › Lectern › Requests › ${d.reqName}.md, where Claude reads and ticks it.` })) });
}
/* ============ step 0, Think: what Claude and you have done so far (read-only, no forms) ============ */
function thinkView(d) {
  const t = d.think || {};
  const item = (ok, part, text, extra) => h('li', { class: ok ? 'got' : part ? 'part' : 'miss' }, h('span', { class: 'tk', text: ok ? '✓' : part ? '◐' : '○' }), h('span', {}, text), extra || null);
  const spineBox = h('div', { class: 'spine' }, h('p', { class: 'mut', text: t.spine ? 'Loading the spine…' : 'No spine yet. Claude writes it with you in 1 Talk Ideas.' }));
  if (t.spine && syncReady()) call({ op: 'readText', which: 'spine', name: t.folder }).then(r => {
    spineBox.replaceChildren(...(r.text || '').split('\n').filter(l => l.trim()).map(l => /^#{1,3}\s/.test(l) ? h('h4', { text: l.replace(/^#+\s*/, '') }) : /^\s*[-*]\s/.test(l) ? h('p', { class: 'li', text: '• ' + l.replace(/^\s*[-*]\s*/, '') }) : h('p', { text: l })));
  }).catch(() => spineBox.replaceChildren(h('p', { class: 'mut', text: 'The spine is in Drive › Lectern › Talks › ' + t.folder + ' › spine.md.' })));
  return h('div', { class: 'think' },
    h('div', { class: 'pcol' },
      h('h2', { text: 'Thinking it through' }),
      h('p', { class: 'lead', text: 'This happens in Claude’s 1 Talk Ideas project. Lectern shows where it has got to; nothing to fill in here.' }),
      h('ul', { class: 'tchecks' },
        item(t.pack > 0, false, t.pack ? `Talk pack: ${t.pack} PDFs` : 'Talk pack of PDFs', t.packId ? h('a', { class: 'btn quiet small', href: `https://drive.google.com/drive/folders/${t.packId}`, target: '_blank', rel: 'noopener' }, 'Open in Drive') : null),
        item(!!t.notebook, false, 'NotebookLM notebook', t.notebook ? h('a', { class: 'btn quiet small', href: t.notebook, target: '_blank', rel: 'noopener' }, 'Open notebook') : null),
        item(t.spineApproved, t.spine, t.spineApproved ? 'Spine approved' : t.spine ? 'Spine drafted, not approved yet' : 'One-page spine'),
        item(!!deckVer(d), t.stage === 'building', deckVer(d) ? 'Deck built' : t.stage === 'building' ? 'Claude is building the deck' : 'Deck')),
      h('div', { class: 'callout' }, h('p', { text: t.next || 'Carry on in this talk’s chat in 1 Talk Ideas.' }), btn('Continue in Claude', { primary: true, onclick: () => copyContinue(d) })),
      h('p', { class: 'hint' }, 'Had an idea? Press ', h('kbd', { text: 'J' }), ' anywhere in Lectern, or ', h('button', { type: 'button', class: 'link', onclick: () => jotIdea(d) }, 'jot it now'), '.')),
    h('div', { class: 'pcol side' }, h('section', { class: 'psrc' }, h('h3', { text: 'The spine' }), spineBox)));
}
/* ============ Rehearse: timed runs, cue cards, recording yourself, listening ============ */
const Run = { active: false, paused: false, cue: false, rec: false, deckId: '', startAt: 0, pausedAt: 0, pausedMs: 0, segs: [], slideStart: 0, n: 0, recorder: null, chunks: [], tick: 0 };
function rehearseBar() {
  const d = Deck.d;
  const hasMp3 = !!(d.prep && d.prep.mp3);
  return h('div', { class: 'rbar', id: 'rbar' },
    h('div', { class: 'rmain' },
      Run.active ? null : btn('Start timed run', { primary: true, icon: 'clock', key: 'S', onclick: () => startRun(d) }),
      Run.active ? btn(Run.paused ? 'Resume' : 'Pause', { icon: Run.paused ? 'play' : 'pause', onclick: () => Run.paused ? Run.resume() : Run.pause() }) : null,
      Run.active ? btn('Finish run', { icon: 'stop', onclick: () => finishRun() }) : null,
      h('div', { class: 'hud', id: 'hud' })),
    h('div', { class: 'ropts' },
      Run.cue ? toggleBtn('Cue cards', true, 'cards', 'Showing only the first and last line of each slide', () => { Run.cue = false; renderDeckBar(); renderScript(); }) : null,
      Run.rec ? toggleBtn('Record me', true, 'mic', 'Your voice is recorded during the next timed run', () => { Run.rec = false; renderDeckBar(); }) : null,
      btn('Print notes', { icon: 'print', onclick: () => go(`#/print/${d.id}`) }),
      btn('Past runs', { icon: 'clock', quiet: true, onclick: () => openRuns(d) }),
      btn('More', { icon: 'dots', quiet: true, onclick: e => popMenu(e.currentTarget, [
        ['Practise likely questions', () => practiseQuestions(d)],
        ['Read my notes aloud from here (turns the slides)', () => Voice.playOn(Deck.d, Deck.n)],
        ['Read this slide aloud  (L)', () => Voice.toggleSlide(Deck.d, Deck.n)],
        [hasMp3 ? 'Play the talk MP3' : 'Make the talk MP3, for the car', () => hasMp3 ? openMp3(d) : makeTalkMp3(d)],
        [Run.cue ? 'Cue cards off' : 'Cue cards: only first and last lines', () => { Run.cue = !Run.cue; renderDeckBar(); renderScript(); }],
        [Run.rec ? 'Don’t record me' : 'Record me during the next timed run', () => { if (Run.active) { toast('Recording starts with a timed run.'); return; } Run.rec = !Run.rec; renderDeckBar(); }]]) })));
}
function toggleBtn(label, on, ic, title, fn) { return h('button', { type: 'button', class: 'btn quiet tog' + (on ? ' on' : ''), 'aria-pressed': String(!!on), title, onclick: fn }, icon(ic), h('span', { text: label })); }
function renderDeckBar() { const b = $('#rbar'); if (b) b.replaceWith(rehearseBar()); Run.render(); }

function runElapsed() { return Run.active ? ((Run.paused ? Run.pausedAt : Date.now()) - Run.startAt - Run.pausedMs) : 0; }
function slideElapsed() { return Run.active ? ((Run.paused ? Run.pausedAt : Date.now()) - Run.slideStart) : 0; }
async function startRun(d) {
  if (Run.active) return;
  if (Deck.mode !== 'rehearse') { go(`#/d/${d.id}/1/rehearse`); await sleep(60); }
  Voice.stop();
  Object.assign(Run, { active: true, paused: false, deckId: d.id, startAt: Date.now(), pausedMs: 0, segs: [], slideStart: Date.now(), n: 1, chunks: [] });
  if (Deck.n !== 1) goSlide(1);
  if (Run.rec) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      Run.recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 } : {});
      Run.recorder.ondataavailable = e => { if (e.data.size) Run.chunks.push(e.data); };
      Run.recorder.start(5000);
    } catch (e) { Run.recorder = null; toast('The microphone isn’t available, so this run isn’t recorded.', { kind: 'warn' }); }
  }
  clearInterval(Run.tick); Run.tick = setInterval(() => Run.render(), 500);
  renderDeckBar();
  toast('Timed run started at slide 1. Use → or Space to move on; Finish run at the end.', { ms: 5000 });
}
Run.pause = () => { if (!Run.active || Run.paused) return; Run.paused = true; Run.pausedAt = Date.now(); if (Run.recorder && Run.recorder.state === 'recording') Run.recorder.pause(); renderDeckBar(); };
Run.resume = () => { if (!Run.active || !Run.paused) return; const gap = Date.now() - Run.pausedAt; Run.pausedMs += gap; Run.slideStart += gap; Run.paused = false; if (Run.recorder && Run.recorder.state === 'paused') Run.recorder.resume(); renderDeckBar(); };
Run.onSlide = (from, to) => {
  if (!Run.active) return;
  const now = Run.paused ? Run.pausedAt : Date.now();
  Run.segs.push({ n: from, ms: now - Run.slideStart, at: now - Run.startAt - Run.pausedMs });
  Run.slideStart = now; Run.n = to;
};
Run.render = () => {
  const hud = $('#hud'); if (!hud) return;
  if (!Run.active || !Deck.d || Run.deckId !== Deck.d.id) { hud.replaceChildren(); return; }
  const d = Deck.d, tg = slideTargets(d), n = Deck.n;
  const el = runElapsed(), sl = slideElapsed(), total = talkMinutes(d) * 60000;
  const before = tg.slice(0, n - 1).reduce((a, b) => a + b, 0);
  const expected = before + Math.min(sl, tg[n - 1] || 0);
  const delta = el - expected;
  const state = Math.abs(delta) <= 30000 ? 'ok' : delta > 120000 ? 'bad' : delta > 0 ? 'warn' : 'ahead';
  hud.replaceChildren(...[
    h('div', { class: 'clk' }, h('b', { text: fmtClock(el) }), h('span', { text: total ? ` of ${fmtMin(total / 60000)}` : '' })),
    h('div', { class: 'sclk' + (tg[n - 1] && sl > tg[n - 1] * 1.25 ? ' over' : '') }, h('span', { text: 'This slide ' }), h('b', { text: fmtClock(sl) }), h('span', { text: tg[n - 1] ? ` / ${fmtClock(tg[n - 1])}` : '' })),
    h('div', { class: 'pace ' + state, text: state === 'ok' ? 'On time' : delta > 0 ? `${fmtClock(delta)} behind` : `${fmtClock(-delta)} ahead` }),
    Run.paused ? h('div', { class: 'paused', text: 'Paused' }) : null, Run.recorder ? h('div', { class: 'recdot', title: 'Recording' }) : null].filter(Boolean));
};
function offerFinishRun() {
  modal({ title: 'That was the last slide', body: h('p', { text: 'Finish the timed run and see where the time went?' }), actions: [{ label: 'Keep going' }, { label: 'Finish run', primary: true, act: () => finishRun() }] });
}
async function finishRun() {
  if (!Run.active) return;
  const d = App.decks.get(Run.deckId), v = deckVer(d);
  Run.onSlide(Deck.n, Deck.n);
  const total = runElapsed();
  clearInterval(Run.tick);
  let recBlob = null;
  if (Run.recorder) {
    await new Promise(res => { Run.recorder.onstop = res; try { Run.recorder.stop(); } catch (e) { res(); } });
    Run.recorder.stream.getTracks().forEach(t => t.stop());
    recBlob = new Blob(Run.chunks, { type: Run.recorder.mimeType || 'audio/webm' });
  }
  // fold repeated visits to a slide together
  const per = {};
  for (const s of Run.segs) per[s.n] = (per[s.n] || 0) + s.ms;
  const run = { id: uid('r'), deckId: d.id, verId: v.id, at: nowIso(), totalMs: total, talkMin: talkMinutes(d), slides: per, marks: Run.segs.map(s => [s.n, s.at - s.ms]), recorded: !!recBlob };
  await DB.put('runs', run.id, run); markDirty('r:' + run.id);
  if (recBlob) { await DB.put('files', 'rec/' + run.id, recBlob); pruneRecordings(d.id); }
  Object.assign(Run, { active: false, paused: false, recorder: null, chunks: [] });
  if (total > 60000) { d.prep = Object.assign({}, d.prep, { timed: nowIso() }); await saveDeck(d); }
  renderDeckBar(); rerenderRail();
  showRunReport(run);
}
async function pruneRecordings(deckId) {
  const runs = [...(await DB.all('runs')).values()].filter(r => r.deckId === deckId && r.recorded).sort((a, b) => b.at.localeCompare(a.at));
  for (const r of runs.slice(5)) { await DB.del('files', 'rec/' + r.id); r.recorded = false; await DB.put('runs', r.id, r); }
}
async function showRunReport(run) {
  const d = App.decks.get(run.deckId), v = App.versions.get(run.verId) || deckVer(d);
  const tg = slideTargets(d);
  const rows = v.slides.map((s, i) => ({ n: s.n, title: s.title, t: tg[i] || 0, a: run.slides[s.n] || 0 })).filter(r => r.a || r.t);
  const over = rows.filter(r => r.a - r.t > 20000).sort((a, b) => (b.a - b.t) - (a.a - a.t)).slice(0, 5);
  const max = Math.max(...rows.map(r => Math.max(r.a, r.t)), 1);
  const talk = run.talkMin * 60000;
  const rec = run.recorded ? await DB.get('files', 'rec/' + run.id) : null;
  const audio = rec ? h('audio', { controls: true, src: URL.createObjectURL(rec), class: 'recplayer' }) : null;
  const seekTo = n => { if (!audio) { closeModal(); go(`#/d/${d.id}/${n}/rehearse`); return; } const m = run.marks.find(x => x[0] === n); if (m) { audio.currentTime = Math.max(0, m[1] / 1000); audio.play(); } };
  modal({ title: 'How the run went', wide: true, body: h('div', { class: 'report' },
    h('div', { class: 'rsum' },
      h('div', {}, h('b', { class: 'big', text: fmtClock(run.totalMs) }), h('span', { text: talk ? ` for a ${fmtMin(run.talkMin)} slot` : '' })),
      h('p', { text: !talk ? '' : Math.abs(run.totalMs - talk) < 60000 ? 'Right on time.' : run.totalMs > talk ? `${fmtClock(run.totalMs - talk)} over. The slides below are where it went.` : `${fmtClock(talk - run.totalMs)} under: room for questions.` })),
    over.length ? h('div', { class: 'over' }, h('h3', { text: 'Where you ran long' }), h('ol', {}, over.map(r => h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => seekTo(r.n) }, `Slide ${r.n}: ${r.title.slice(0, 60)}`), h('span', { class: 'mut', text: ` ${fmtClock(r.a)} against ${fmtClock(r.t)} (${fmtClock(r.a - r.t, true)})` }))))) : h('p', { class: 'mut', text: 'No slide ran more than 20 seconds over its share.' }),
    audio ? h('div', { class: 'rec' }, h('h3', { text: 'Your recording' }), audio, h('p', { class: 'mut', text: 'Click a slide in the chart to hear that part.' })) : null,
    h('h3', { text: 'Every slide (bar: your time; line: its share of the talk)' }),
    h('div', { class: 'bars' }, rows.map(r => h('button', { type: 'button', class: 'brow', onclick: () => seekTo(r.n), title: `Slide ${r.n}: ${fmtClock(r.a)} (target ${fmtClock(r.t)})` },
      h('span', { class: 'bn', text: r.n }), h('span', { class: 'btrack' }, h('i', { class: 'ba' + (r.a - r.t > 20000 ? ' long' : ''), style: { width: (100 * r.a / max) + '%' } }), h('i', { class: 'bt', style: { left: (100 * r.t / max) + '%' } })), h('span', { class: 'bv', text: fmtClock(r.a) }))))),
    actions: [{ label: 'Close', primary: true }] });
}
async function openRuns(d) {
  const runs = [...(await DB.all('runs')).values()].filter(r => r.deckId === d.id).sort((a, b) => b.at.localeCompare(a.at));
  modal({ title: 'Past timed runs', body: runs.length ? h('div', { class: 'vlist' }, runs.slice(0, 30).map(r => h('div', { class: 'vrow' }, h('b', { text: fmtClock(r.totalMs) }), h('span', { text: `${fmtDate(r.at)} ${new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }), r.recorded ? h('span', { class: 'tagpill', text: 'recorded' }) : null,
    h('div', { class: 'vact' }, btn('Report', { quiet: true, onclick: () => showRunReport(r) }))))) : h('p', { class: 'mut', text: 'No timed runs yet. Start one from Rehearse.' }) });
}

/* ============ Voice: your notes read aloud with natural British voices, in the browser ============ */
const VOICES = [['bm_george', 'George (British man)'], ['bm_lewis', 'Lewis (British man)'], ['bm_daniel', 'Daniel (British man)'], ['bm_fable', 'Fable (British man)'],
  ['bf_emma', 'Emma (British woman)'], ['bf_isabella', 'Isabella (British woman)'], ['bf_alice', 'Alice (British woman)'], ['bf_lily', 'Lily (British woman)']];
const Voice = {
  worker: null, ready: false, loading: null, reqs: new Map(), seq: 0, ctx: null, busy: false, paused: false, src: null, stopFlag: 0, device: '', cache: new Map(), cur: null,
  async load(onProgress) {
    if (this.ready) return;
    if (this.loading) return this.loading;
    this.loading = new Promise(async (res, rej) => {
      let device = 'wasm';
      try { if (navigator.gpu) { const a = await navigator.gpu.requestAdapter(); if (a) device = 'webgpu'; } } catch (e) { }
      this.device = device;
      this.worker = new Worker('tts-worker.js', { type: 'module' });
      this.worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress' && onProgress) onProgress(m);
        if (m.type === 'ready') { this.ready = true; res(); }
        if (m.type === 'error' && !m.id) { this.loading = null; rej(new Error(m.error)); }
        if (m.id && this.reqs.has(m.id)) { const r = this.reqs.get(m.id); this.reqs.delete(m.id); m.type === 'error' ? r.rej(new Error(m.error)) : r.res(m); }
      };
      this.worker.postMessage({ op: 'load', device });
    });
    return this.loading;
  },
  gen(text, voice, speed) {
    const key = voice + '|' + speed + '|' + text;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    const id = ++this.seq;
    return new Promise((res, rej) => { this.reqs.set(id, { res, rej }); this.worker.postMessage({ op: 'gen', id, text, voice, speed }); })
      .then(m => { const out = { pcm: m.pcm, sr: m.sr }; this.cache.set(key, out); if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value); return out; });
  },
  chunks(text) {
    // sentences, grouped to ~240 characters; a pause mark becomes a short silence
    const out = []; let buf = '';
    for (const part of speakable(text).split('⏸')) {
      for (const s of sentences(part)) { if ((buf + ' ' + s).length > 240 && buf) { out.push(buf.trim()); buf = ''; } buf += ' ' + s; }
      if (buf.trim()) { out.push(buf.trim()); buf = ''; }
      out.push('⏸');
    }
    out.pop();
    return out.filter(Boolean);
  },
  async ensure() {
    if (this.ready) return true;
    const t = toast('Loading the voice (first time: about 90 MB, then it works offline)…', { ms: 600000 });
    const span = t.querySelector('span');
    try { await this.load(m => { if (m.progress && m.file && /onnx/.test(m.file)) span.textContent = `Loading the voice: ${Math.round(m.progress)}% (first time only)…`; }); t.remove(); return true; }
    catch (e) { t.remove(); toast('The voice couldn’t load: ' + e.message + '. It needs internet the first time.', { ms: 10000, kind: 'warn' }); return false; }
  },
  async play(pcm, sr) {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const buf = this.ctx.createBuffer(1, pcm.length, sr); buf.copyToChannel(pcm, 0);
    return new Promise(res => { const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.ctx.destination); s.onended = res; this.src = s; s.start(); });
  },
  async speakSlide(d, n, token) {
    const text = noteText(d, n); if (!text.trim()) return;
    const parts = this.chunks(text);
    const voice = App.prefs.voice, speed = App.prefs.speed;
    let nextGen = parts[0] === '⏸' ? null : this.gen(parts[0], voice, speed);
    for (let i = 0; i < parts.length; i++) {
      if (token !== this.stopFlag) return;
      const cur = nextGen;
      nextGen = i + 1 < parts.length && parts[i + 1] !== '⏸' ? this.gen(parts[i + 1], voice, speed) : null;
      if (parts[i] === '⏸') { await sleep(650); continue; }
      const a = await cur;
      while (this.paused && token === this.stopFlag) await sleep(150);
      if (token !== this.stopFlag) return;
      this.mark(parts[i]);
      await this.play(a.pcm, a.sr);
    }
    this.mark('');
  },
  mark(text) {
    // highlight the sentence being read in the script panel
    $$('#script .para').forEach(p => p.classList.toggle('reading', !!text && p.textContent.replace(/\s+/g, ' ').includes(text.slice(0, 24).replace(/\s+/g, ' ').split(' ').slice(0, 3).join(' '))));
  },
  async toggleSlide(d, n) {
    if (this.busy) { this.stop(); return; }
    if (!noteText(d, n).trim()) { toast('No notes on this slide to read.'); return; }
    if (!(await this.ensure())) return;
    const token = ++this.stopFlag; this.busy = true; this.setBtn();
    try { await this.speakSlide(d, n, token); } catch (e) { toast('Reading stopped: ' + e.message, { kind: 'warn' }); }
    if (token === this.stopFlag) { this.busy = false; this.setBtn(); }
  },
  async playOn(d, n) {
    if (this.busy) { this.stop(); return; }
    if (!(await this.ensure())) return;
    const token = ++this.stopFlag; this.busy = true; this.setBtn();
    toast('Reading your notes and turning the slides. L or Esc stops.', { ms: 4000 });
    try {
      for (let k = n; k <= deckVer(d).slides.length && token === this.stopFlag; k++) {
        if (Deck.d === d && Deck.n !== k) goSlide(k);
        await this.speakSlide(d, k, token);
        await sleep(900);
      }
    } catch (e) { toast('Reading stopped: ' + e.message, { kind: 'warn' }); }
    if (token === this.stopFlag) { this.busy = false; this.setBtn(); }
  },
  pause() { this.paused = true; if (this.ctx) this.ctx.suspend(); },
  resume() { this.paused = false; if (this.ctx) this.ctx.resume(); },
  stop() { this.stopFlag++; this.paused = false; try { this.src && this.src.stop(); } catch (e) { } if (this.ctx) this.ctx.resume(); this.busy = false; this.mark(''); this.setBtn(); },
  setBtn() { const b = $('.act-read span'); if (b) b.textContent = this.busy ? 'Stop reading' : 'Read aloud'; },
  onSlideShown() { },
};

/* ============ the talk MP3: every slide's notes, read in order, for the car ============ */
const Mp3 = { running: false, cancel: false };
async function makeTalkMp3(d) {
  if (Mp3.running) { toast('An MP3 is already being made.'); return; }
  const v = deckVer(d); if (!v) return;
  const slides = v.slides.filter(s => !s.hidden && noteText(d, s.n).trim());
  if (!slides.length) { toast('This talk has no speaker notes to read.'); return; }
  if (!(await Voice.ensure())) return;
  Voice.stop();
  Mp3.running = true; Mp3.cancel = false;
  const tid = uid('t'); const started = Date.now();
  // Kokoro runs about 3.5x faster than speech on a laptop GPU, about 1.2x without one
  const listenMin = slides.reduce((a, s) => a + wordsOf(noteText(d, s.n)), 0) / (App.prefs.wpm || 140);
  const makeMs = listenMin * 60000 / (Voice.device === 'webgpu' ? 3.5 : 1.2);
  toast(`Making the talk MP3 takes about ${fmtMin(Math.max(1, makeMs / 60000))} on this computer. Keep this tab open; you can carry on working.`, { ms: 9000 });
  trayItem(tid, { title: `MP3: ${d.title}`, step: `Starting, about ${fmtMin(Math.max(1, makeMs / 60000))}`, p: 0 });
  const enc = new Worker('mp3-worker.js');
  const parts = []; const chapters = []; let samples = 0, sr = 24000;
  enc.onmessage = e => { if (e.data.type === 'data') parts.push(e.data.buf); };
  enc.postMessage({ op: 'init', sr: 24000, kbps: 48 });
  const silence = ms => new Float32Array(Math.round(sr * ms / 1000));
  try {
    const totalChars = slides.reduce((a, s) => a + noteText(d, s.n).length, 0); let doneChars = 0;
    for (const s of slides) {
      if (Mp3.cancel) throw new Error('cancelled');
      chapters.push([s.n, samples / sr]);
      for (const part of Voice.chunks(noteText(d, s.n))) {
        if (Mp3.cancel) throw new Error('cancelled');
        let pcm;
        if (part === '⏸') pcm = silence(650); else { const a = await Voice.gen(part, App.prefs.voice, App.prefs.speed); pcm = a.pcm; sr = a.sr; }
        enc.postMessage({ op: 'pcm', pcm }); samples += pcm.length;
      }
      const gap = silence(1200); enc.postMessage({ op: 'pcm', pcm: gap }); samples += gap.length;
      doneChars += noteText(d, s.n).length;
      const p = doneChars / totalChars, el = Date.now() - started;
      trayItem(tid, { step: `Slide ${s.n} of ${v.slides.length}${p > 0.05 ? `, about ${fmtClock(el / p - el)} left` : ''}`, p });
    }
    await new Promise(res => { enc.onmessage = e => { if (e.data.type === 'data') parts.push(e.data.buf); if (e.data.type === 'done') res(); }; enc.postMessage({ op: 'end' }); });
    const blob = new Blob(parts, { type: 'audio/mpeg' });
    await DB.put('files', 'mp3/' + d.id, blob);
    d.audioChapters = chapters.map(c => [c[0], Math.round(c[1] * 10) / 10]); d.audioVer = v.id; d.audioVoice = App.prefs.voice;
    d.prep = Object.assign({}, d.prep, { mp3: nowIso() });
    await saveDeck(d);
    if (syncReady()) enqueue({ t: 'upAudio', deckId: d.id });
    trayItem(tid, { done: true, doneText: `${fmtClock(samples / sr * 1000)} of audio` });
    toast(`The talk MP3 is ready (${fmtClock(samples / sr * 1000)}). It also goes to Drive › Lectern › Audio.`, { ms: 9000, action: { label: 'Play', fn: () => openMp3(d) } });
    rerender();
  } catch (e) {
    trayItem(tid, { err: e.message === 'cancelled' ? 'Stopped' : 'Couldn’t finish: ' + e.message });
  } finally { enc.terminate(); Mp3.running = false; }
}
async function openMp3(d) {
  let blob = await DB.get('files', 'mp3/' + d.id);
  if (!blob && d.audioId && syncReady()) { toast('Getting the MP3 from Drive…'); try { const f = await downFile(d.audioId); blob = new Blob([f.bytes], { type: 'audio/mpeg' }); await DB.put('files', 'mp3/' + d.id, blob); } catch (e) { } }
  if (!blob) { makeTalkMp3(d); return; }
  const audio = h('audio', { controls: true, src: URL.createObjectURL(blob), class: 'recplayer' });
  const ch = d.audioChapters || [];
  const now = h('p', { class: 'mut' });
  audio.addEventListener('timeupdate', () => { const t = audio.currentTime; let n = ch.length ? ch[0][0] : 1; for (const c of ch) if (c[1] <= t) n = c[0]; now.textContent = `Now: slide ${n}`; if (Deck.d === d && Deck.n !== n && !Run.active) goSlide(n); });
  const rate = h('select', { 'aria-label': 'Speed' }, [0.8, 0.9, 1, 1.1, 1.25, 1.5].map(r => h('option', { value: r, selected: r === 1 }, r + '×')));
  rate.addEventListener('change', () => { audio.playbackRate = Number(rate.value); });
  const stale = d.audioVer && d.audioVer !== d.verId;
  modal({ title: 'Talk MP3', body: h('div', { class: 'mp3' }, audio,
    h('div', { class: 'row' }, btn('Back 15 s', { quiet: true, onclick: () => { audio.currentTime -= 15; } }), btn('Forward 15 s', { quiet: true, onclick: () => { audio.currentTime += 15; } }), rate, now),
    stale ? h('p', { class: 'warn', text: 'Made from an earlier version of the talk.' }) : null,
    h('p', { class: 'mut', text: 'The slides follow along. On a phone: Drive › 00_Apps › Lectern › Audio.' })),
    actions: [{ label: 'Download MP3', act: () => { downloadBlob(blob, talkFolder(d) + '.mp3'); return false; } }, { label: 'Make it again', act: () => { makeTalkMp3(d); } }, { label: 'Close', primary: true }] });
}

/* ============ podium notes: slide picture beside its notes, three to an A4 page ============ */
async function renderPrint(id) {
  const d = App.decks.get(id), v = deckVer(d); if (!v) { go('#/'); return; }
  const tg = slideTargets(d); let cum = 0;
  const sheet = h('div', { class: 'printsheet' },
    h('div', { class: 'pbar noprint' }, btn('Back', { icon: 'back', quiet: true, onclick: () => history.length > 1 ? history.back() : go(`#/d/${d.id}/1`) }),
      h('span', { text: `${d.title}: ${plural(v.slides.length, 'slide')}, three to a page` }), btn('Print', { primary: true, icon: 'print', onclick: () => window.print() })),
    h('header', { class: 'phead' }, h('h1', { text: d.title }), h('p', { text: `${d.date ? fmtDate(d.date) + ', ' : ''}${talkMinutes(d) ? fmtMin(talkMinutes(d)) : ''}, version ${v.n}` })),
    v.slides.filter(s => !s.hidden).map(s => { cum += tg[s.n - 1] || 0; return h('section', { class: 'pslide' },
      h('div', { class: 'pleft' }, slideImage(v, s.n, true), h('p', { class: 'pn' }, h('b', { text: s.n }), ` by ${fmtClock(cum)}`)),
      h('div', { class: 'pnotes' }, notesBlocks(noteText(d, s.n)).map(b => h('p', { html: scriptHtml(b.text) })))); }));
  $('#main').replaceChildren(sheet);
  const after = () => { d.prep = Object.assign({}, d.prep, { printed: nowIso() }); saveDeck(d); window.removeEventListener('afterprint', after); };
  window.addEventListener('afterprint', after);
}

/* ============ pressure test: likely questions from the room, answered aloud before the answer is shown ============ */
function parseQuestions(text) {
  const out = []; let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const q = /^(?:#{1,4}\s*)?(?:Q\d*[:.)]|\d+[.)]\s*Q:?)\s*(.+)$/i.exec(line) || /^#{2,4}\s+(.+\?)\s*$/.exec(line);
    if (q) { cur = { q: q[1].trim(), a: [] }; out.push(cur); continue; }
    if (!cur || !line || /^#\s/.test(line)) continue;
    cur.a.push(line.replace(/^A[:.)]\s*/i, ''));
  }
  return out.filter(x => x.q).map(x => ({ q: x.q, a: x.a.join('\n') }));
}
async function practiseQuestions(d) {
  const folder = d.think ? d.think.folder : talkFolder(d);
  let text = (await DB.get('kv', 'qs:' + d.id)) || '';
  if (syncReady()) { try { const r = await call({ op: 'readText', which: 'questions', name: folder }); if (r.exists) { text = r.text; await DB.put('kv', 'qs:' + d.id, text); } } catch (e) { } }
  const qs = parseQuestions(text);
  if (!qs.length) {
    modal({ title: 'Likely questions', body: [h('p', { text: 'No questions written for this talk yet.' }),
      h('p', { class: 'mut' }, 'Ask Claude in this talk’s chat: “Pressure-test the talk: write the likely questions and objections, with short answers, into questions.md.” They appear here (Drive › Lectern › Talks › ' + folder + ').')],
      actions: [{ label: 'Copy that request', act: () => { copyText(`Pressure-test "${d.title}": who will be in the room, what will they ask or push back on? Write the likely questions and objections, each with a short prepared answer and the source behind it, into Drive › 00_Apps › Lectern › Talks › ${folder} › questions.md (format: "Q: …" then the answer).`, 'Copied. Paste it into this talk’s Claude chat.'); return false; } }, { label: 'Close', primary: true }] });
    return;
  }
  let i = 0, shown = false;
  const box = h('div', { class: 'qcard' });
  const draw = () => {
    const x = qs[i];
    box.replaceChildren(h('p', { class: 'mut', text: `Question ${i + 1} of ${qs.length}. Answer it aloud, then show the prepared answer.` }), h('h3', { class: 'qq', text: x.q }),
      shown ? h('div', { class: 'qa' }, x.a.split('\n').map(l => h('p', { text: l }))) : btn('Show the prepared answer', { key: 'Space', onclick: () => { shown = true; draw(); } }));
  };
  const keys = e => {
    if (!$('.qcard')) { document.removeEventListener('keydown', keys, true); return; }
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!shown) { shown = true; draw(); } else if (i < qs.length - 1) { i++; shown = false; draw(); } }
    if (e.key === 'ArrowRight') { e.stopPropagation(); if (i < qs.length - 1) { i++; shown = false; draw(); } }
    if (e.key === 'ArrowLeft') { e.stopPropagation(); if (i > 0) { i--; shown = false; draw(); } }
  };
  document.addEventListener('keydown', keys, true);
  draw();
  modal({ title: `Likely questions: ${d.title}`, wide: true, body: box, actions: [{ label: 'Previous', act: () => { if (i > 0) { i--; shown = false; draw(); } return false; } }, { label: 'Next question', primary: true, act: () => { if (i < qs.length - 1) { i++; shown = false; draw(); return false; } d.prep = Object.assign({}, d.prep, { questions: nowIso() }); saveDeck(d); } }] });
}
/* ============ Present: on this screen, or speaker view here + clean slides on the projector ============ */
function presentStart(d) {
  const v = deckVer(d), p = d.prep || {};
  const check = (ok, text) => h('li', { class: ok ? 'got' : 'miss' }, ok ? '✓ ' : '○ ', text);
  return h('div', { class: 'pstart' },
    h('div', { class: 'pchoices' },
      h('button', { type: 'button', class: 'pchoice', onclick: () => startSpeaker(d) }, icon('screen', 'big'), h('b', { text: 'Present with speaker view' }),
        h('span', { text: 'Your laptop shows the slide, the next one, your notes and the clock. The projector shows only the slides.' }), h('kbd', { text: 'P then Enter' })),
      h('button', { type: 'button', class: 'pchoice', onclick: () => go(`#/show/${d.id}/1`) }, icon('full', 'big'), h('b', { text: 'Present on this screen' }),
        h('span', { text: 'Full-screen slides only. Arrow keys, a clicker, or click to move on; B blanks the screen.' })),
      h('button', { type: 'button', class: 'pchoice', onclick: () => downloadOriginal(d) }, icon('download', 'big'), h('b', { text: 'Take the .pptx to the venue PC' }),
        h('span', { text: `Downloads ${v ? v.name : 'the file'} (version ${v ? v.n : ''}) to put on a USB stick or email.` }))),
    h('div', { class: 'pcheck' }, h('h3', { text: 'Before you go' }), h('ul', {},
      check(p.timed, 'A timed run done'), check(p.printed, 'Podium notes printed'), check(p.questions, 'Likely questions practised'),
      check(!draftCount(d), 'Notes edits saved into PowerPoint'), check(!!(v && v.picsId), 'Slide pictures in place')),
      h('p', { class: 'mut', text: 'Tip: on the projector window, press F if it isn’t full screen yet. Clickers work in either window.' }),
      p.questions ? null : btn('Practise likely questions', { quiet: true, onclick: () => practiseQuestions(d) }),
      p.presented ? null : btn('Mark this talk as given', { quiet: true, onclick: () => markGiven(d) })));
}

/* The speaker window and the projector window keep each other in step. */
const Show = { ch: null, win: null, black: false, startAt: 0 };
function showChannel() { if (!Show.ch) { try { Show.ch = new BroadcastChannel('lectern-show'); } catch (e) { Show.ch = null; } } return Show.ch; }
async function startSpeaker(d) {
  const n = 1;   // a talk starts at the beginning
  const url = location.origin + location.pathname + `#/screen/${d.id}/${n}`;
  let features = 'popup=yes,width=1280,height=720';
  try {
    if ('getScreenDetails' in window) {
      const sd = await window.getScreenDetails();
      const other = sd.screens.find(s => s !== sd.currentScreen) || null;
      if (other) features = `popup=yes,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    }
  } catch (e) { }
  Show.win = window.open(url, 'lectern-screen', features);
  if (!Show.win) { toast('The projector window was blocked. Allow pop-ups for Lectern, then try again.', { ms: 9000, kind: 'warn', important: true }); return; }
  go(`#/speaker/${d.id}/${n}`);
  if (!features.includes('left=')) toast('Drag the new window onto the projector screen, then press F in it.', { ms: 9000, important: true });
}
function renderSpeaker(id, n) {
  const d = App.decks.get(id), v = deckVer(d); if (!v) { go('#/'); return; }
  Deck.d = d; Deck.v = v; Deck.mode = 'speaker'; Deck.n = clamp(Number(n) || 1, 1, v.slides.length);
  if (!Show.startAt) Show.startAt = Date.now();
  const ch = showChannel();
  if (ch) ch.onmessage = e => { const m = e.data; if (m.deckId !== d.id) return; if (m.cmd === 'next') speakerGo(Deck.n + 1); if (m.cmd === 'prev') speakerGo(Deck.n - 1); if (m.cmd === 'black') speakerBlack(); if (m.cmd === 'hello') sendShow(); };
  const wrap = h('div', { class: 'speaker' },
    h('div', { class: 'spmain' }, h('div', { class: 'spcur', id: 'spcur' }), h('div', { class: 'spbar' },
      btn('Previous', { icon: 'prev', iconOnly: true, onclick: () => speakerGo(Deck.n - 1) }), h('div', { class: 'spn', id: 'spn' }), btn('Next', { icon: 'next', iconOnly: true, onclick: () => speakerGo(Deck.n + 1) }),
      btn('Blank the projector', { icon: 'black', key: 'B', quiet: true, cls: 'spblack', onclick: () => speakerBlack() }), btn('Change this slide', { icon: 'flag', key: 'C', quiet: true, onclick: () => flagSlide() }),
      btn('End', { icon: 'close', quiet: true, onclick: () => endShow(d) }))),
    h('div', { class: 'spside' }, h('div', { class: 'spclock', id: 'spclock' }), h('div', { class: 'spnext', id: 'spnext' }), h('div', { class: 'spnotes', id: 'spnotes', style: { fontSize: (App.prefs.notesSize + 3) + 'px' } })));
  $('#main').replaceChildren(wrap);
  speakerGo(Deck.n, true);
  clearInterval(Show.tick); Show.tick = setInterval(speakerClock, 1000);
}
/* Like PowerPoint's slide show, presenting skips hidden slides. */
function visibleStep(v, from, to) {
  const dir = to >= from ? 1 : -1;
  let n = clamp(to, 1, v.slides.length);
  while (v.slides[n - 1] && v.slides[n - 1].hidden && n + dir >= 1 && n + dir <= v.slides.length) n += dir;
  if (v.slides[n - 1] && v.slides[n - 1].hidden) n = from;
  return n;
}
function speakerGo(n, first) {
  const d = Deck.d, v = Deck.v; if (!v) return;
  n = visibleStep(v, Deck.n, n);
  if (!first && n === Deck.n) return;
  Deck.n = n;
  try { history.replaceState(null, '', `#/speaker/${d.id}/${n}`); } catch (e) { }
  $('#spcur').replaceChildren(slideImage(v, n, true));
  $('#spn').replaceChildren(h('b', { text: n }), ` / ${v.slides.length}`);
  const nx = visibleStep(v, n, n + 1);
  $('#spnext').replaceChildren(...(nx !== n ? [h('p', { class: 'mut', text: 'Next' }), slideImage(v, nx, false)] : [h('p', { class: 'mut', text: 'Last slide' })]));
  const text = noteText(d, n);
  $('#spnotes').replaceChildren(...(text ? notesBlocks(text).map(b => h('p', { html: scriptHtml(b.text) })) : [h('p', { class: 'mut', text: 'No notes on this slide.' })]));
  $('#spnotes').scrollTop = 0;
  d.pos = { n, at: nowIso() }; DB.put('decks', d.id, d);
  if (v.picsId) picURL(v.picsId, n + 1, true);
  sendShow(); speakerClock();
}
function speakerBlack() { Show.black = !Show.black; $('.spblack') && $('.spblack').classList.toggle('on', Show.black); sendShow(); }
function sendShow() { const ch = showChannel(); if (ch && Deck.d) ch.postMessage({ deckId: Deck.d.id, n: Deck.n, black: Show.black, verId: Deck.v.id }); }
function speakerClock() {
  const el = $('#spclock'); if (!el || !Deck.d) return;
  const ms = Date.now() - Show.startAt, total = talkMinutes(Deck.d) * 60000;
  const tg = slideTargets(Deck.d), expected = tg.slice(0, Deck.n - 1).reduce((a, b) => a + b, 0);
  const delta = ms - expected;
  el.replaceChildren(h('b', { text: fmtClock(ms) }), h('span', { text: total ? ` of ${fmtMin(total / 60000)}` : '' }),
    h('span', { class: 'pace ' + (Math.abs(delta) < 60000 ? 'ok' : delta > 0 ? 'warn' : 'ahead'), text: Math.abs(delta) < 60000 ? 'On time' : delta > 0 ? `${fmtClock(delta)} behind` : `${fmtClock(-delta)} ahead` }),
    h('span', { class: 'wall', text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
}
function endShow(d) {
  clearInterval(Show.tick);
  const mins = (Date.now() - Show.startAt) / 60000;
  Show.startAt = 0; Show.black = false;
  try { Show.win && Show.win.close(); } catch (e) { }
  const ch = showChannel(); if (ch) ch.postMessage({ deckId: d.id, end: true });
  if (mins > 5 && !(d.prep || {}).presented) {
    modal({ title: 'Was that the talk?', body: h('p', { text: `You presented for ${Math.round(mins)} minutes.` }), actions: [{ label: 'No, just practice', act: () => go(`#/d/${d.id}/${Deck.n}/present`) }, { label: 'Yes, mark as given', primary: true, act: () => { markGiven(d); go(`#/d/${d.id}/${Deck.n}/present`); } }] });
  } else go(`#/d/${d.id}/${Deck.n}/present`);
}

/* The projector window: the slide, nothing else. */
function renderScreen(id, n) {
  document.body.classList.add('screenmode');
  const d = App.decks.get(id), v = deckVer(d);
  const stage = h('div', { class: 'screen', id: 'screen', onclick: () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { }); } });
  const hint = h('div', { class: 'screenhint' }, 'Click here or press F for full screen');
  $('#main').replaceChildren(stage, hint);
  let cur = { n: Number(n) || 1, black: false, verId: v && v.id };
  const draw = () => {
    const vv = App.versions.get(cur.verId) || v;
    if (!vv) { stage.replaceChildren(h('p', { class: 'mut', text: 'Waiting for the speaker window…' })); return; }
    stage.classList.toggle('black', cur.black);
    stage.replaceChildren(cur.black ? h('div') : slideImage(vv, cur.n, true));
  };
  draw();
  const ch = showChannel();
  if (ch) { ch.onmessage = e => { const m = e.data; if (m.deckId !== id) return; if (m.end) { window.close(); return; } cur = { n: m.n, black: m.black, verId: m.verId }; draw(); }; ch.postMessage({ deckId: id, cmd: 'hello' }); }
  document.addEventListener('fullscreenchange', () => { hint.hidden = !!document.fullscreenElement; });
  Show.screenKeys = e => {
    const k = e.key;
    if (k === 'f' || k === 'F') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => { }); return; }
    const send = cmd => { if (ch) ch.postMessage({ deckId: id, cmd }); };
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) { e.preventDefault(); send('next'); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) { e.preventDefault(); send('prev'); }
    if (k === 'b' || k === 'B' || k === '.') { e.preventDefault(); send('black'); }
  };
}

/* Present on this screen: full screen, the slide only. */
function renderShow(id, n) {
  const d = App.decks.get(id), v = deckVer(d); if (!v) { go('#/'); return; }
  Deck.d = d; Deck.v = v; Deck.mode = 'show'; Deck.n = clamp(Number(n) || 1, 1, v.slides.length);
  const stage = h('div', { class: 'screen show', id: 'screen', onclick: e => { showGo(e.clientX < innerWidth * 0.25 ? Deck.n - 1 : Deck.n + 1); } });
  const hud = h('div', { class: 'showhud', id: 'showhud' });
  $('#main').replaceChildren(stage, hud);
  document.documentElement.requestFullscreen().catch(() => { });
  Show.black = false;
  showGo(Deck.n, true);
  let t; document.onmousemove = () => { hud.classList.add('on'); clearTimeout(t); t = setTimeout(() => hud.classList.remove('on'), 1800); };
}
function showGo(n, first) {
  const d = Deck.d, v = Deck.v;
  n = visibleStep(v, Deck.n, n); if (!first && n === Deck.n && !Show.black) return;
  Deck.n = n; Show.black = false;
  try { history.replaceState(null, '', `#/show/${d.id}/${n}`); } catch (e) { }
  $('#screen').classList.remove('black');
  $('#screen').replaceChildren(slideImage(v, n, true));
  $('#showhud').replaceChildren(h('span', { text: `${n} / ${v.slides.length}` }), btn('Exit', { quiet: true, onclick: () => exitShow() }));
  if (v.picsId) picURL(v.picsId, n + 1, true);
  d.pos = { n, at: nowIso() }; DB.put('decks', d.id, d);
}
function exitShow() { document.onmousemove = null; if (document.fullscreenElement) document.exitFullscreen(); go(`#/d/${Deck.d.id}/${Deck.n}/present`); }
/* ============ routes ============ */
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function parseRoute() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: parts[0] || 'library', a: parts[1], b: parts[2], c: parts[3] };
}
function route() {
  const r = parseRoute();
  App.ui.route = r;
  closeMenus();
  if (r.name !== 'd' && Run.active) { /* a run stays with its talk */ }
  document.body.classList.toggle('in-deck', r.name === 'd');
  document.body.classList.toggle('presenting', ['speaker', 'show', 'screen'].includes(r.name));
  if (r.name === 'd' && r.a) renderDeck(r.a, r.b, r.c || (App.decks.get(r.a) && !deckVer(App.decks.get(r.a)) ? 'think' : 'review'));
  else if (r.name === 'print' && r.a) renderPrint(r.a);
  else if (r.name === 'speaker' && r.a) renderSpeaker(r.a, r.b);
  else if (r.name === 'show' && r.a) renderShow(r.a, r.b);
  else if (r.name === 'screen' && r.a) renderScreen(r.a, r.b);
  else if (r.name === 'receive-flow') renderReceive();
  else { Deck.d = null; Deck.v = null; renderLibrary(); }
  if (r.name !== 'd') { const b = $('#editbar'); if (b) b.remove(); }
  document.title = r.name === 'd' && Deck.d ? `${Deck.d.title} · Lectern` : 'Lectern';
}
function rerender() {
  const r = App.ui.route || parseRoute();
  if (r.name === 'd' && Deck.d) {
    const d = App.decks.get(Deck.d.id);
    if (!d || d.deletedAt) { go('#/'); return; }
    if (Deck.editing) { rerenderRail(); renderEditBar(); return; }   // never disturb typing
    const keep = Deck.mode === 'think' && deckVer(d) && !(App.ui.route && App.ui.route.c === 'think') ? 'review' : Deck.mode;
    Deck.d = null; renderDeck(d.id, Deck.n, keep);
  } else if (r.name === 'library' || !r.name) renderLibraryBody();
}
function rerenderRail() { const r = $('.railrow'); if (r && Deck.d) r.replaceChildren(railHtml(Deck.d, false), nextHtml(Deck.d, false)); }

/* ============ keyboard ============ */
const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
function onKey(e) {
  if (Show.screenKeys && App.ui.route && App.ui.route.name === 'screen') return Show.screenKeys(e);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') {
    if ($('.menu')) { closeMenus(); return; }
    if (modalOpen()) { closeModal(); return; }
    if (Deck.grid) { toggleGrid(); return; }
    if (Voice.busy) { Voice.stop(); return; }
  }
  if (modalOpen() || typing(e) || e.altKey || e.ctrlKey || e.metaKey) return;
  const r = App.ui.route || {}, k = e.key;
  if (k === '?') { e.preventDefault(); openHelp(); return; }
  if (k === 'j' || k === 'J') { if (['library', 'd'].includes(r.name || 'library')) { e.preventDefault(); jotIdea(r.name === 'd' ? Deck.d : null); return; } }
  if (r.name === 'library' || !r.name) {
    if (k === '/') { e.preventDefault(); const q = $('#libq'); if (q) q.focus(); }
    return;
  }
  if (r.name === 'show') {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) { e.preventDefault(); showGo(Deck.n + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) { e.preventDefault(); showGo(Deck.n - 1); }
    else if (k === 'b' || k === 'B' || k === '.') { Show.black = !Show.black; $('#screen').classList.toggle('black', Show.black); }
    else if (k === 'Home') showGo(1); else if (k === 'End') showGo(Deck.v.slides.length);
    else if (k === 'Escape') exitShow();
    return;
  }
  if (r.name === 'speaker') {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) { e.preventDefault(); speakerGo(Deck.n + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) { e.preventDefault(); speakerGo(Deck.n - 1); }
    else if (k === 'b' || k === 'B' || k === '.') speakerBlack();
    else if (k === 'c' || k === 'C') flagSlide();
    return;
  }
  if (r.name !== 'd' || !Deck.d) return;
  if (k === 'v' || k === 'V') return setMode('review');
  if (k === 'r' || k === 'R') return setMode('rehearse');
  if (k === 'p' || k === 'P') return setMode('present');
  if (Deck.mode === 'present') { if (k === 'Enter') startSpeaker(Deck.d); return; }
  if (!Deck.v || Deck.mode === 'think') return;
  if (/^[0-9]$/.test(k)) { Deck.jump += k; clearTimeout(Deck.jumpT); Deck.jumpT = setTimeout(() => { Deck.jump = ''; }, 1500); toast(`Go to slide ${Deck.jump}… press Enter`, { ms: 1400 }); return; }
  if (k === 'Enter' && Deck.jump) { goSlide(Number(Deck.jump)); Deck.jump = ''; return; }
  if (k === ' ' && Run.cue) { const rv = $('#script .reveal'); if (rv) { e.preventDefault(); rv.click(); return; } }
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'n'].includes(k)) { e.preventDefault(); goSlide(Deck.n + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); goSlide(Deck.n - 1); }
  else if (k === 'Home') goSlide(1); else if (k === 'End') goSlide(Deck.v.slides.length);
  else if (k === 'e' || k === 'E') { e.preventDefault(); startEdit(); }
  else if (k === 'c' || k === 'C') { e.preventDefault(); flagSlide(); }
  else if (k === 'l' || k === 'L') Voice.toggleSlide(Deck.d, Deck.n);
  else if (k === 'g' || k === 'G') toggleGrid();
  else if (k === 't' || k === 'T') toggleFilm();
  else if (k === 'n' || k === 'N') toggleNotes();
  else if (k === 'f' || k === 'F') toggleFull($('#stage'));
  else if ((k === 's' || k === 'S') && Deck.mode === 'rehearse') { Run.active ? finishRun() : startRun(Deck.d); }
}

/* ============ help, shortcuts, where things live ============ */
function openHelp() {
  const keys = [['← →  Space', 'Previous / next slide'], ['12 then Enter', 'Go to slide 12'], ['E', 'Edit the notes of this slide'], ['C', 'Flag this slide for Claude to change'], ['J', 'Jot an idea for a talk'],
    ['L', 'Read this slide’s notes aloud'], ['V  R  P', 'Review, Rehearse, Present'], ['S', 'Start or finish a timed run (Rehearse)'], ['G', 'All slides'], ['T  N', 'Filmstrip, script panel'],
    ['F', 'Full screen'], ['B', 'Blank the projector (presenting)'], ['/', 'Search (library)'], ['Ctrl+K', 'Find any action'], ['?', 'This help']];
  modal({ title: 'How Lectern works', wide: true, body: h('div', { class: 'help' }, howItWorks(),
    h('h3', { text: 'Keys' }), h('dl', { class: 'keys' }, keys.map(([k, d]) => [h('dt', {}, h('kbd', { text: k })), h('dd', { text: d })])),
    h('p', {}, h('button', { type: 'button', class: 'link', onclick: () => { closeModal(); openSettings('where'); } }, 'Where things live (Drive folders, the PDF library, Claude, NotebookLM)'))) });
}
function whereThingsLive() {
  const row = (what, where, note) => h('tr', {}, h('th', { text: what }), h('td', {}, h('code', { text: where }), note ? h('small', { text: note }) : null));
  return h('table', { class: 'where' }, h('tbody', {},
    row('Lectern itself', 'https://3dfung-ai.github.io/lectern/', 'Bookmark it in Brave on each PC.'),
    row('All Lectern files', 'My Drive › 00_Apps › Lectern', 'On the laptop: G:\\My Drive\\00_Apps\\Lectern'),
    row('Thinking about a talk', 'Claude › 1 Talk Ideas project', 'One chat per talk: pack of PDFs, NotebookLM notebook, the one-page spine.'),
    row('Each talk’s working files', 'Lectern › Talks › <talk>', 'status.md (Claude keeps it current), spine.md, ideas.md (your J notes), questions.md (likely questions), Pack (the PDFs).'),
    row('New decks from Claude', 'Lectern › Inbox', 'Anything dropped here appears in Lectern by itself.'),
    row('Current .pptx of each talk', 'Lectern › Decks', 'Edit one in PowerPoint and Lectern picks up the change.'),
    row('Every earlier version', 'Lectern › Decks › _versions'),
    row('Claude’s change lists', 'Lectern › Requests › <talk>.md', 'Your flags (C) and notes edits go here.'),
    row('Talk MP3s', 'Lectern › Audio'),
    row('How the voice says things', 'Lectern › Pronunciations.txt', 'Editable in Settings › Voice.'),
    row('Your PDF library', 'Google Drive, the syllabus-numbered folders', 'Claude picks each talk’s pack from here; topic folders hold a “00 Scope.md”.'),
    row('Building decks', 'Claude › 2 Slide Workshop project', 'Say “Build <talk>”. Build files: C:\\Users\\Fung\\Library\\SlideLibrary\\<date topic>'),
    row('Brainstorming', 'https://notebooklm.google.com', 'One notebook per talk, made by Claude from the talk pack; link on the talk’s Think step.'),
    row('The sync script', 'script.google.com › Lectern sync', 'Only needed to set up a new device or a new key.')));
}
function commonPath(paths) {
  const split = paths.map(p => p.split(' / '));
  const out = [];
  for (let i = 0; i < Math.min(...split.map(s => s.length)); i++) { const v = split[0][i]; if (split.every(s => s[i] === v)) out.push(v); else break; }
  return out.join(' / ');
}

/* ============ command finder (Ctrl+K) ============ */
function paletteActions() {
  const a = [['Library', () => go('#/')], ['Add a talk (.pptx or PDF)', () => pickFiles('.pptx,.pdf')], ['Jot an idea', () => jotIdea(Deck.d)], ['Sync now', () => syncNow(true)], ['Settings', () => openSettings()], ['Where things live', () => openSettings('where')], ['How Lectern works', () => openHelp()]];
  const d = Deck.d;
  if (d && deckVer(d)) a.unshift(
    ['Review', () => setMode('review')], ['Rehearse', () => setMode('rehearse')], ['Present', () => setMode('present')], ['Start timed run', () => startRun(d)],
    ['Edit notes of this slide', () => startEdit()], ['Flag this slide for Claude', () => flagSlide()], ['Save notes edits to PowerPoint', () => saveDraftsToPptx(d)],
    ['Read this slide aloud', () => Voice.toggleSlide(d, Deck.n)], ['Listen from here (turns slides)', () => Voice.playOn(d, Deck.n)], ['Make the talk MP3', () => makeTalkMp3(d)], ['Play the talk MP3', () => openMp3(d)],
    ['Print notes', () => go(`#/print/${d.id}`)], ['Practise likely questions', () => practiseQuestions(d)], ['Past timed runs', () => openRuns(d)], ['Cue cards on/off', () => { Run.cue = !Run.cue; renderDeckBar(); renderScript(); }],
    ['Talk details (date, length, series)', () => editTalkDetails(d)], ['Versions', () => openVersions(d)], ['Download the .pptx', () => downloadOriginal(d)], ['Claude’s list for this talk', () => openImprove(d)],
    ['Copy instruction for Claude', () => copyClaudeInstruction(d)], ['All slides', () => toggleGrid()], ['Use exact pictures from a PDF', () => pickFiles('.pdf', d.id)]);
  for (const x of liveDecks()) a.push(['Open: ' + x.title, () => go(`#/d/${x.id}/${(x.pos && x.pos.n) || 1}`)]);
  return a;
}
function openPalette() {
  const acts = paletteActions();
  const inp = h('input', { type: 'search', placeholder: 'Type what you want to do', autofocus: true });
  const list = h('div', { class: 'pal' });
  let sel = 0, shown = acts;
  const draw = () => {
    const q = inp.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = acts.filter(([l]) => q.every(t => l.toLowerCase().includes(t))).slice(0, 12);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map(([l, fn], i) => h('button', { type: 'button', class: 'pitem' + (i === sel ? ' on' : ''), onclick: () => { closeModal(); fn(); } }, l)));
  };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); const fn = shown[sel][1]; closeModal(); fn(); }
  });
  draw();
  modal({ title: 'Find an action', body: [inp, list], actions: [] });
}

/* ============ settings ============ */
async function openSettings(tab) {
  tab = tab || (syncReady() ? 'voice' : 'sync');
  const tabs = [['sync', 'Drive sync'], ['voice', 'Voice'], ['where', 'Where things live'], ['look', 'Appearance'], ['storage', 'Storage'], ['deleted', 'Deleted talks']];
  const body = h('div', { class: 'settings' });
  const nav = h('nav', { class: 'stabs' }, tabs.map(([k, l]) => h('button', { type: 'button', class: 'stab' + (k === tab ? ' on' : ''), onclick: () => openSettings(k) }, l)));
  const pane = h('div', { class: 'spane' });
  body.append(nav, pane);
  modal({ title: 'Settings', wide: true, body, actions: [{ label: 'Done', primary: true }] });
  if (tab === 'sync') {
    const url = h('input', { type: 'url', value: App.sync.url, placeholder: 'https://script.google.com/macros/s/…/exec' });
    const key = h('input', { type: 'password', value: App.sync.key, placeholder: 'The key from the script’s Execution log', autocomplete: 'off' });
    const dev = h('input', { type: 'text', value: App.sync.device || guessDevice() });
    const msg = h('p', { class: 'mut' });
    pane.append(h('p', {}, 'Lectern keeps your talks in ', h('b', { text: 'My Drive › 00_Apps › Lectern' }), ' through a small script in your own Google account. Set it up once; other devices then use a setup link.'),
      h('div', { class: 'form' }, h('label', {}, h('span', { text: 'Web app link' }), url), h('label', {}, h('span', { text: 'Sync key' }), key), h('label', {}, h('span', { text: 'This device’s name' }), dev)),
      h('div', { class: 'row' }, btn(syncReady() ? 'Reconnect' : 'Connect', { primary: true, onclick: async () => { msg.textContent = 'Connecting…'; const ok = await applySync(url.value.trim(), key.value.trim(), dev.value.trim()); msg.textContent = ok ? 'Connected and synced.' : 'Not connected.'; } }),
        syncReady() ? btn('Sync now', { icon: 'sync', onclick: () => syncNow(true) }) : null,
        syncReady() ? btn('Copy setup link for another device', { onclick: () => copyText(setupLink(), 'Setup link copied. Open it in Brave on the other device. It contains your key: send it only to yourself.') }) : null), msg,
      syncReady() && App.sync.lastSync ? h('p', { class: 'mut', text: `Last synced ${new Date(App.sync.lastSync).toLocaleString()}${App.sync.server ? `; Drive holds ${App.sync.server.count} records, last saved by ${App.sync.server.savedBy || '…'}` : ''}.` }) : null,
      App.queue.length ? h('p', { class: 'mut', text: `${plural(App.queue.length, 'transfer')} waiting: ${App.queue.slice(0, 4).map(j => JOB_LABEL[j.t]).join('; ')}.` }) : null,
      h('details', {}, h('summary', { text: 'The sync script (for setting up from scratch)' }), h('p', { class: 'mut', text: 'script.google.com › New project › paste this › run setup › Deploy as a web app (Execute as: Me; Who has access: Anyone).' }),
        btn('Copy the script', { onclick: async () => { const t = await (await fetch('lectern-sync.gs')).text(); copyText(t, 'Script copied.'); } })));
  }
  if (tab === 'voice') {
    const sel = h('select', {}, VOICES.map(([id, label]) => h('option', { value: id, selected: App.prefs.voice === id }, label)));
    const sp = h('select', {}, [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.2].map(r => h('option', { value: r, selected: Number(App.prefs.speed) === r }, r === 1 ? 'Normal' : r + '×')));
    const wpm = h('input', { type: 'number', min: 90, max: 220, step: 5, value: App.prefs.wpm });
    const pron = h('textarea', { rows: 10, class: 'mono' }); pron.value = App.pron.text || '';
    sel.addEventListener('change', () => { App.prefs.voice = sel.value; App.prefs.syncedAt = nowIso(); savePrefs(); });
    sp.addEventListener('change', () => { App.prefs.speed = Number(sp.value); App.prefs.syncedAt = nowIso(); savePrefs(); });
    wpm.addEventListener('change', () => { App.prefs.wpm = clamp(Number(wpm.value) || 140, 90, 220); App.prefs.syncedAt = nowIso(); savePrefs(); });
    const test = async () => { if (!(await Voice.ensure())) return; const a = await Voice.gen(speakable('Good morning. Your HbA1c result and the point-of-care eGFR disagree, so let us work out why.'), App.prefs.voice, App.prefs.speed); Voice.play(a.pcm, a.sr); };
    pane.append(h('div', { class: 'form' }, h('label', {}, h('span', { text: 'Voice' }), sel), h('label', {}, h('span', { text: 'Speed' }), sp),
      h('label', {}, h('span', { text: 'Your speaking pace (words a minute)' }), wpm, h('small', { text: 'Used for talk length and slide targets when a talk has no set length.' }))),
      h('div', { class: 'row' }, btn('Hear it', { icon: 'speaker', onclick: test }), h('span', { class: 'mut', text: Voice.ready ? `Voice loaded (${Voice.device === 'webgpu' ? 'graphics card' : 'processor'}).` : 'The voice downloads once (about 90 MB), then works offline.' })),
      h('h3', { text: 'Pronunciations' }), h('p', { class: 'mut', text: 'One per line: written = spoken. Shared with Claude through Drive › Lectern › Pronunciations.txt.' }), pron,
      btn('Save pronunciations', { onclick: async () => { App.pron.text = pron.value; App.pron.rules = parsePron(pron.value); await DB.put('kv', 'pron', App.pron.text); enqueue({ t: 'pron' }); toast('Pronunciations saved.'); } }));
  }
  if (tab === 'where') pane.append(h('p', { class: 'mut', text: 'For when you forget. Everything about your talks lives in one of these places.' }), whereThingsLive());
  if (tab === 'look') {
    const sel = h('select', {}, [['system', 'Follow Windows (light by day, dark at night)'], ['light', 'Always light'], ['dark', 'Always dark']].map(([v, l]) => h('option', { value: v, selected: App.prefs.theme === v }, l)));
    sel.addEventListener('change', () => { App.prefs.theme = sel.value; saveKV('prefs'); applyTheme(); });
    pane.append(h('div', { class: 'form' }, h('label', {}, h('span', { text: 'Look' }), sel)), h('p', { class: 'mut', text: 'Slides always sit on a dark stage while presenting.' }),
      btn('Show the first-time tour again', { quiet: true, onclick: () => { closeModal(); showTour(); } }));
  }
  if (tab === 'storage') {
    let est = {}; try { est = await navigator.storage.estimate(); } catch (e) { }
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    pane.append(h('p', { text: `This device holds ${plural(liveDecks().length, 'talk')} using about ${fmtBytes(est.usage || 0)}.` }),
      h('p', { class: 'mut', text: persisted ? 'Storage is protected: the browser won’t clear it to save space.' : 'The browser may clear Lectern’s storage if the disk gets full. Drive keeps a copy of everything once sync is on.' }),
      persisted ? null : btn('Ask the browser to protect it', { onclick: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Protected.' : 'The browser said no; installing Lectern as an app usually allows it.'); } }),
      h('p', { class: 'warn', text: 'Brave: if “Clear cookies and site data when you close all windows” is on, add an exception for 3dfung-ai.github.io, or Lectern starts empty each day (Drive refills it).' }));
  }
  if (tab === 'deleted') {
    const gone = [...App.decks.values()].filter(d => d.deletedAt);
    pane.append(gone.length ? h('div', { class: 'vlist' }, gone.map(d => h('div', { class: 'vrow' }, h('b', { text: d.title }), h('span', { class: 'mut', text: 'deleted ' + fmtDate(d.deletedAt) }),
      h('div', { class: 'vact' }, btn('Restore', { quiet: true, onclick: async () => { d.deletedAt = null; await saveDeck(d); openSettings('deleted'); rerender(); } }))))) : h('p', { class: 'mut', text: 'No deleted talks.' }));
  }
}
function applyTheme() {
  const t = App.prefs.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

/* ============ first-time tour ============ */
function showTour() {
  modal({ title: 'Welcome to Lectern', wide: true, body: h('div', { class: 'tour' }, howItWorks(),
    h('ul', { class: 'tips' }, h('li', {}, h('b', { text: 'Each talk shows its steps' }), ' and one ', h('b', { text: 'Next' }), ' suggestion with a button, so you never need to remember the routine.'),
      h('li', {}, 'Press ', h('kbd', { text: '?' }), ' for help and ', h('kbd', { text: 'Ctrl+K' }), ' to find any action by typing.'))),
    actions: [{ label: 'Start', primary: true, act: () => { App.prefs.tourDone = true; saveKV('prefs'); } }] });
}

/* ============ bringing decks over from Flow (one time) ============ */
const FLOW_ORIGIN = 'http://127.0.0.1:8765';
function renderReceive() {
  App.ui.receiving = true;
  $('#main').replaceChildren(h('section', { class: 'receive' }, h('h1', { text: 'Bringing your talks over from Flow' }), h('p', { class: 'mut', text: 'Keep this tab and the Flow tab open. Each talk arrives with PowerPoint’s own slide pictures.' }), h('ol', { id: 'recvlist' })));
  if (window.opener) try { window.opener.postMessage({ type: 'lectern-ready' }, FLOW_ORIGIN); } catch (e) { }
}
window.addEventListener('message', async e => {
  if (e.origin !== FLOW_ORIGIN || !App.ui.receiving) return;
  const m = e.data || {};
  if (m.type === 'ping') { e.source.postMessage({ type: 'lectern-ready' }, e.origin); return; }
  if (m.type !== 'flow-deck') return;
  const li = h('li', { text: `${m.title}: receiving…` }); const list = $('#recvlist'); if (list) list.append(li);
  try {
    const pics = (m.pics || []).map(b => b ? new Blob([b], { type: 'image/jpeg' }) : null);
    const res = await importPptx(new Uint8Array(m.pptx), m.name, { from: 'flow', pictures: pics.length ? pics : null, picsSrc: 'powerpoint', title: m.title, quiet: true });
    if (!res) throw new Error('could not read the file');
    const d = res.deck;
    Object.assign(d, { title: m.title || d.title, series: m.series || d.series, seriesOrder: m.seriesOrder ?? d.seriesOrder, role: m.role === 'appendix' ? 'appendix' : d.role, talkMin: m.talkMin || d.talkMin });
    if (m.appendixOf) { const main = liveDecks().find(x => x.key === nameKey(m.appendixOf)); if (main) { d.mainId = main.id; d.title = 'Appendix: ' + main.title; } }
    d.reqName = talkFolder(d);
    await saveDeck(d);
    li.textContent = `${d.title}: ${res.duplicate ? 'already here' : plural(res.version.slides.length, 'slide') + ' with pictures'}`;
    e.source.postMessage({ type: 'flow-deck-done', idx: m.idx, ok: true, deckId: d.id, slides: res.version.slides.length, pics: pics.filter(Boolean).length, duplicate: !!res.duplicate }, e.origin);
  } catch (err) {
    li.textContent = `${m.title}: failed (${err.message})`;
    e.source.postMessage({ type: 'flow-deck-done', idx: m.idx, ok: false, error: String(err.message || err) }, e.origin);
  }
});

/* ============ two tabs open at once ============ */
// Both tabs share one store. The newest tab does the syncing; an older one pauses its syncing,
// says so, and offers a reload, so two tabs never upload the same files or work from stale copies.
function watchOtherTabs() {
  if (!('BroadcastChannel' in window)) return;
  const ch = new BroadcastChannel('lectern-tabs'), me = uid('t');
  ch.onmessage = e => {
    const m = e.data || {};
    if (m.from === me) return;
    if (m.t === 'bye') { Sync.yielded = false; updatePill(); runQueue(); return; }
    if (m.t !== 'hello') return;
    Sync.yielded = true; updatePill();
    if (document.getElementById('othertab')) return;
    document.body.append(h('div', { id: 'othertab', class: 'othertab', role: 'status' },
      h('span', { text: 'Lectern is open in another tab, so this one has paused syncing. Reload to catch up.' }),
      btn('Reload', { primary: true, onclick: () => location.reload() }),
      btn('Dismiss', { quiet: true, onclick: () => document.getElementById('othertab').remove() })));
  };
  ch.postMessage({ t: 'hello', from: me });
  window.addEventListener('pagehide', () => ch.postMessage({ t: 'bye', from: me }));
}

/* ============ start ============ */
async function init() {
  applyTheme();
  await DB.open();
  const kv = await DB.all('kv');
  Object.assign(App.prefs, kv.get('prefs') || {});
  applyTheme();
  Object.assign(App.sync, kv.get('sync') || {});
  App.queue = kv.get('queue') || [];
  App.pron.text = kv.get('pron') || ''; App.pron.rules = parsePron(App.pron.text);
  for (const [k, v] of kv) if (String(k).startsWith('req:')) App.requests.set(k.slice(4), v);
  App.decks = await DB.all('decks'); App.versions = await DB.all('versions');
  await loadDrafts();
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onKey);
  // drop files anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, Deck.d && App.ui.route && App.ui.route.name === 'd' ? Deck.d.id : null); });
  $('#sync-pill').addEventListener('click', () => Sync.yielded ? location.reload() : syncReady() ? syncNow(true) : openSettings('sync'));
  const setup = /^#sync=/.test(location.hash) ? readSetupHash() : null;
  const isScreen = /^#\/screen\//.test(location.hash);
  route();
  if (isScreen) return;   // the projector window only shows slides
  updatePill(); renderTray();
  syncInit(); runQueue(); healSync().catch(() => { });
  watchOtherTabs();
  if (setup) offerSetupLink(setup);
  else if (!App.prefs.tourDone && !liveDecks().length) showTour();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); }).catch(() => { });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  window.addEventListener('beforeunload', e => { if (Run.active || Mp3.running) { e.preventDefault(); e.returnValue = ''; } });
}
init().catch(e => { console.error(e); document.body.prepend(h('p', { class: 'fatal', text: 'Lectern couldn’t start: ' + (e.message || e) })); });
