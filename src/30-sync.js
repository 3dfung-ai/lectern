/* ============ Drive sync: this device first, then your own Apps Script and Drive folder ============ */
/*
  Everything is saved on this device at once, so Lectern works with no internet.
  The shared list of talks is one JSON file in your Drive (00_Apps/Lectern/_data/lectern-index.json),
  kept by a small Apps Script in your account that answers only requests carrying your key.
  Files (the .pptx, slide pictures, MP3s) travel separately, 3 MB at a time, in the background.
*/
const Sync = { busy: false, again: false, timer: 0, err: null, detail: '', fails: 0, scanAt: 0, qBusy: false, qErr: null, qNow: null };
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
  if (Sync.qBusy || !App.queue.length || !syncReady() || navigator.onLine === false) { updatePill(); return; }
  Sync.qBusy = true;
  try {
    while (App.queue.length && navigator.onLine !== false) {
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
  else if (Sync.busy) { txt = 'Syncing…'; cls = 'busy'; }
  else if (Sync.qNow) { txt = (JOB_LABEL[Sync.qNow.t] || 'Working') + (q > 1 ? ` (+${q - 1})` : ''); cls = 'busy'; }
  else if (Sync.err && !['offline'].includes(Sync.err)) { txt = Sync.err === 'bad_key' ? 'Sync key wrong' : 'Sync problem'; cls = 'warn'; }
  else if (q) { txt = `${q} waiting for Drive`; cls = 'warn'; }
  else if (dirty) { txt = 'Saving…'; cls = 'busy'; }
  else { txt = 'Synced with Drive'; cls = 'ok'; }
  p.className = 'pill ' + cls; p.querySelector('span').textContent = txt;
  p.title = syncReady() ? (App.sync.lastSync ? 'Last synced ' + new Date(App.sync.lastSync).toLocaleTimeString() : 'Not synced yet') + '. Click to sync now.' : 'Set up Drive sync so your talks reach your other devices.';
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
    // files made before sync was on still need to reach Drive
    for (const v of App.versions.values()) {
      if (!v.origId && await DB.get('files', 'orig/' + v.id)) enqueue({ t: 'upOrig', verId: v.id });
      if (v.picsId && !v.picsZipId && await hasPictures(v.picsId, 1)) enqueue({ t: 'upPics', verId: v.id, picsId: v.picsId });
    }
  }
  await saveKV('sync');
  await loadPron();
  await syncNow(false);
  if (!Sync.err) toast(`Drive sync is on. ${plural(liveDecks().length, 'talk')} on this device.`);
  return true;
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
