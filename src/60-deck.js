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
  const head = h('header', { class: 'dhead' },
    h('div', { class: 'dleft' }, h('a', { href: '#/', class: 'home', title: 'All talks' }, icon('back'), h('span', { text: 'Lectern' })),
      h('h1', { class: 'dtitle', title: d.series ? `${d.title}\n${d.series}` : d.title, text: d.title }), statusChip(d)),
    v ? h('div', { class: 'tabs', role: 'tablist' }, MODES.map(([m, label, key]) => h('button', { type: 'button', role: 'tab', class: 'tab' + (Deck.mode === m ? ' on' : ''), 'aria-selected': String(Deck.mode === m), title: `${label} (${key})`, onclick: () => setMode(m) }, label))) : h('div', { class: 'tabs empty' }),
    h('div', { class: 'dtools' }, btn('How it works', { icon: 'help', iconOnly: true, quiet: true, title: 'How it works (?)', onclick: () => openHelp() }), btn('More', { icon: 'dots', iconOnly: true, quiet: true, title: 'Talk details, versions, download…', onclick: e => deckMenu(d, e.currentTarget) }), syncPill()));
  const wrap = h('div', { class: 'deck mode-' + Deck.mode }, head);
  if (Deck.mode === 'think') wrap.append(thinkView(d));
  else if (Deck.mode === 'present') wrap.append(presentStart(d));
  else wrap.append(workArea());
  main.replaceChildren(wrap);
  if (v && Deck.mode !== 'present' && Deck.mode !== 'think') showSlide(Deck.n, true);
  renderEditBar();
}
function statusChip(d) {
  const [w, c] = statusWord(d);
  return h('button', { type: 'button', class: 'st chip' + (c ? ' st-' + c : ''), title: 'Next: ' + pipeline(d).next.text + '\nClick to see every step.', onclick: () => openStatus(d) }, h('i'), w);
}
function openStatus(d) {
  const body = h('div', { class: 'status' }, railHtml(d, false), nextHtml(d, false));
  body.addEventListener('click', e => { if (e.target.closest('button')) closeModal(); }, true);
  modal({ title: `Where “${d.title}” stands`, wide: true, body });
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
      btn('Edit notes', { icon: 'edit', key: 'E', quiet: true, cls: 'act-edit', onclick: () => startEdit() }),
      btn('Flag for Claude', { icon: 'flag', key: 'C', quiet: true, cls: 'act-flag', title: 'Flag this slide for Claude to change (C)', onclick: () => flagSlide() }),
      btn('Read aloud', { icon: 'speaker', key: 'L', quiet: true, cls: 'act-read', onclick: () => Voice.toggleSlide(Deck.d, Deck.n) })),
    Deck.mode === 'rehearse' ? rehearseCtl() : null,
    h('div', { class: 'views' },
      btn('All slides', { icon: 'grid', iconOnly: true, quiet: true, title: 'All slides (G)', onclick: () => toggleGrid() }),
      btn('Filmstrip', { icon: 'film', iconOnly: true, quiet: true, cls: 'v-film' + (App.prefs.filmstrip ? ' on' : ''), title: 'Filmstrip (T)', onclick: () => toggleFilm() }),
      btn('Notes panel', { icon: 'notes', iconOnly: true, quiet: true, cls: 'v-notes' + (App.prefs.notesOpen ? ' on' : ''), title: 'Notes panel (N)', onclick: () => toggleNotes() })));
  if (Deck.mode === 'rehearse') stage.append(h('div', { class: 'hud', id: 'hud', 'aria-live': 'off' }));
  const left = h('section', { class: 'stagecol' }, stage, film, under);
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
  $('#counter').replaceChildren(...[h('b', { text: `${n}` }), h('span', { class: 'of', text: `/ ${v.slides.length}` }),
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
    h('h2', {}, 'Notes', h('span', { class: 'smeta', text: words ? `${words} words, about ${fmtClock(words / App.prefs.wpm * 60000)}${tgt ? `; target ${fmtClock(tgt)}` : ''}` : 'No notes on this slide' })),
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
  if (!App.prefs.notesOpen) toggleNotes();
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
function toggleFilm() { App.prefs.filmstrip = !App.prefs.filmstrip; saveKV('prefs'); const f = $('#film'); if (f) { f.hidden = !App.prefs.filmstrip; showSlide(Deck.n); } const b = $('.v-film'); if (b) b.classList.toggle('on', App.prefs.filmstrip); }
function toggleNotes() { App.prefs.notesOpen = !App.prefs.notesOpen; saveKV('prefs'); const s = $('#script'); if (s) { s.hidden = !App.prefs.notesOpen; renderScript(); } const b = $('.v-notes'); if (b) b.classList.toggle('on', App.prefs.notesOpen); }
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
    appendixOf(d) ? ['Open the appendix', () => go(`#/d/${appendixOf(d).id}/1`)] : null,
    d.role === 'appendix' && d.mainId && App.decks.get(d.mainId) && !App.decks.get(d.mainId).deletedAt ? ['Back to the main talk', () => go(`#/d/${d.mainId}/${openAt(App.decks.get(d.mainId))}`)] : null,
    ['Where this talk stands', () => openStatus(d)],
    ['Claude’s list for this talk', () => openImprove(d)],
    ['Move to deleted talks', () => deleteDeck(d)],
  ].filter(Boolean);
  popMenu(anchor, items);
}
function popMenu(anchor, items, up) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  up = up || r.bottom > innerHeight * 0.6;   // near the bottom of the window: open upwards
  const m = h('div', { class: 'menu', role: 'menu', style: Object.assign(up ? { bottom: (innerHeight - r.top + 6) + 'px' } : { top: (r.bottom + 6) + 'px' }, { right: Math.max(8, innerWidth - r.right) + 'px' }) },
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
