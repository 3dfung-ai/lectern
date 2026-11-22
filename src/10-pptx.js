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
