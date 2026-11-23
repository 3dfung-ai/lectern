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
/* one word for where a talk stands; the full pipeline lives in How it works and the talk's status */
function statusWord(d) {
  const v = deckVer(d), p = d.prep || {}, t = d.think, days = daysTo(d.date);
  if (!v && t) return t.stage === 'building' ? ['Building', 'part'] : ['Thinking', 'part'];
  if (!v) return ['No slides', ''];
  if (draftCount(d)) return ['Unsaved', 'warn'];
  if (v.picsState === 'failed') return ['Needs PDF', 'warn'];
  if (p.presented) return ['Given', 'done'];
  if (!p.timed) return ['Rehearse', ''];
  if (openRequests(d)) return ['Flagged', 'warn'];
  if (!p.printed && (days === null || days <= 14)) return ['Rehearse', ''];
  if (days !== null && days < 0) return ['Given?', 'warn'];
  return ['Ready', 'done'];
}
function statusTag(d, tag) { const [w, c] = statusWord(d); return h(tag || 'span', { class: 'st' + (c ? ' st-' + c : ''), title: pipeline(d).next.text, text: w }); }
function openAt(d) { const v = deckVer(d); return d.pos && v && d.pos.n > 1 && d.pos.n <= v.slides.length ? d.pos.n : 1; }
function whenText(d) {
  const days = daysTo(d.date);
  if (days === null) return '';
  if (days === 0) return 'Today'; if (days === 1) return 'Tomorrow';
  return fmtDate(d.date);
}
function talkRow(d) {
  const v = deckVer(d), mins = talkMinutes(d);
  return h('a', { class: 'trow', href: `#/d/${d.id}/${openAt(d)}` },
    h('span', { class: 'tthumb' }, v ? slideImage(v, 1, false) : h('div', { class: 'pic textpic' })),
    h('span', { class: 'ttitle', text: d.title }),
    h('span', { class: 'tmeta', text: v ? `${plural(v.slides.length, 'slide')}${mins ? ', ' + fmtMin(mins) : ''}` : mins ? fmtMin(mins) : '' }),
    h('span', { class: 'tdate', text: (d.prep || {}).presented ? '' : whenText(d) }),
    statusTag(d));
}
function upNext() {
  const decks = liveDecks().filter(d => d.role !== 'appendix');
  const upcoming = decks.filter(d => d.date && daysTo(d.date) >= 0 && !(d.prep || {}).presented).sort((a, b) => a.date.localeCompare(b.date))[0];
  const recent = decks.filter(d => d.pos && d.pos.at && Date.now() - new Date(d.pos.at) < 21 * 86400000).sort((a, b) => String(b.pos.at).localeCompare(a.pos.at))[0];
  const d = upcoming || recent;
  if (!d) return null;
  const days = upcoming ? daysTo(d.date) : null, nx = pipeline(d).next;
  const when = upcoming ? (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`) : 'Last opened';
  return h('section', { class: 'upnext', 'aria-label': 'Up next' },
    h('p', { class: 'unk' }, h('b', { text: 'Up next' }), h('span', { text: when })),
    h('a', { class: 'untitle', href: `#/d/${d.id}/${openAt(d)}`, text: d.title }),
    nx.label ? btn(nx.label, { primary: true, title: nx.text, onclick: nx.fn }) : btn(openAt(d) > 1 ? `Open at slide ${openAt(d)}` : 'Open', { primary: true, title: nx.text, onclick: () => go(`#/d/${d.id}/${openAt(d)}`) }));
}
function renderLibrary() {
  const main = $('#main');
  const head = h('header', { class: 'libhead' },
    h('h1', { class: 'brand' }, 'Lectern'),
    h('label', { class: 'search' }, icon('search'), h('input', { id: 'libq', type: 'search', placeholder: 'Search every slide and note', 'aria-label': 'Search every slide and note', value: Lib.q, autocomplete: 'off', spellcheck: 'false',
      oninput: debounce(e => { Lib.q = e.target.value; renderLibraryBody(); }, 120), onkeydown: e => { if (e.key === 'Enter') { const f = $('.hit') || $('.results .trow'); if (f) f.click(); } } }), h('kbd', { text: '/' })),
    h('div', { class: 'headbtns' },
      btn('Add a talk', { icon: 'plus', quiet: true, title: 'Add a PowerPoint or PDF (or drop it anywhere)', onclick: () => pickFiles('.pptx,.pdf') }),
      btn('How it works', { icon: 'help', iconOnly: true, quiet: true, title: 'How it works (?)', onclick: () => openHelp() }),
      btn('Settings', { icon: 'gear', iconOnly: true, quiet: true, title: 'Settings', onclick: () => openSettings() }),
      syncPill()));
  main.replaceChildren(head, h('div', { id: 'libbody' }));
  renderLibraryBody();
}
function renderLibraryBody() {
  const body = $('#libbody'); if (!body) return;
  const decks = liveDecks();
  if (Lib.q.trim()) { body.replaceChildren(searchResults(Lib.q.trim())); return; }
  if (!decks.length) { body.replaceChildren(emptyLibrary()); return; }
  const out = [upNext()];
  const groups = seriesGroups();
  for (const [series, list] of groups) {
    const k = series || '_';
    const coll = !!Lib.collapsed[k];
    out.push(h('section', { class: 'group' },
      h('button', { type: 'button', class: 'ghead', 'aria-expanded': String(!coll), onclick: () => { Lib.collapsed[k] = !coll; renderLibraryBody(); } },
        h('h2', { text: series || (groups.length > 1 ? 'Other talks' : 'Talks') }), h('span', { class: 'gcount', text: list.length })),
      coll ? null : h('div', { class: 'tlist' }, list.map(talkRow))));
  }
  body.replaceChildren(...out.filter(Boolean));
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
  if (talks.length) wrap.append(h('h2', { text: plural(talks.length, 'talk') }), h('div', { class: 'tlist' }, talks.map(talkRow)));
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

