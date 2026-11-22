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
        syncReady() ? btn('Set up your phone', { onclick: showPhoneQR }) : null,
        syncReady() ? btn('Copy setup link for another computer', { onclick: () => copyText(setupLink(), 'Setup link copied. Open it in Brave on the other computer. It contains your key: send it only to yourself.') }) : null), msg,
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

/* ============ phone setup: a QR code of the setup link ============ */
function loadScript(src) {
  return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = h('script', { src }); s.onload = res; s.onerror = rej; document.head.append(s); });
}
async function showPhoneQR() {
  try { await loadScript('vendor/qrcode.js'); } catch (e) { toast('Couldn’t load the QR maker. Use Copy setup link instead.'); return; }
  const qr = qrcode(0, 'M'); qr.addData(setupLink()); qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + q * 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="260" height="260" shape-rendering="crispEdges" role="img" aria-label="QR code with this device's setup link"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  const box = h('div', { class: 'qrbox' }); box.innerHTML = svg;
  modal({
    title: 'Set up your phone',
    body: [box,
      h('ol', { class: 'qrsteps' },
        h('li', { text: 'Point your phone’s camera at the code and tap the link.' }),
        h('li', { text: 'Lectern opens and asks to turn on sync. Say yes, on Wi-Fi: the slide pictures are a big first download.' }),
        h('li', { text: 'Then Share › Add to Home Screen, so it opens like an app.' })),
      h('p', { class: 'hint', text: 'The code contains your sync key. Close this when you’re done.' })],
  });
}

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
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => { });
    // a new version took over: offer a reload, never force one (it could land mid-run)
    // (a fresh page load already has the new version, so only a long-open page is told)
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && performance.now() > 20000) toast('Lectern has been updated.', { ms: 15000, action: { label: 'Reload', fn: () => location.reload() } }); });
  }
  window.addEventListener('beforeunload', e => { if (Run.active || Mp3.running) { e.preventDefault(); e.returnValue = ''; } });
}
init().catch(e => { console.error(e); document.body.prepend(h('p', { class: 'fatal', text: 'Lectern couldn’t start: ' + (e.message || e) })); });
