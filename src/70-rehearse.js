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
  trayItem(tid, { title: `MP3: ${d.title}`, step: 'Starting', p: 0 });
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
