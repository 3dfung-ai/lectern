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
