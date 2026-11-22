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
