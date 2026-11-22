/* Test double for the Lectern Apps Script, plus a static file server for the app.
   Usage: node tests/server.js [port]   (app at http://localhost:PORT/, script at http://localhost:PORT/exec)
   Drive is simulated in memory; "convert" uses LibreOffice to stand in for Google's redraw. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process'), os = require('os');
const PORT = Number(process.argv[2] || 8799), ROOT = path.join(__dirname, '..');
const KEY = 'testkey123';
const S = { rev: 0, records: {}, files: {}, uploads: {}, props: {}, calls: [] };
let idn = 1;
const nid = () => 'f' + (idn++);
const md5 = b => crypto.createHash('md5').update(b).digest('hex');
function addFile(folder, name, bytes, mime) { const id = nid(); S.files[id] = { id, folder, name, bytes: Buffer.from(bytes), md5: md5(bytes), modified: new Date().toISOString(), mime: mime || 'application/octet-stream', trashed: false }; return S.files[id]; }
function pub(f) { return { id: f.id, name: f.name, size: f.bytes.length, md5: f.md5, modified: f.modified, mime: f.mime }; }
function inFolder(folder) { return Object.values(S.files).filter(f => !f.trashed && f.folder === folder); }
// a small PDF library: two topic folders with scope files and PDFs
const tinyPdf = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj trailer<</Root 1 0 R>>\n%%EOF');
for (const [folder, scope, n] of [['NotebookLM PDFs/01 Laboratory/S/01-S1 Macroenzymes & macro-analytes', 'Macro-TSH, macroprolactin, macro-CK: detection by PEG and gel filtration.', 3],
  ['NotebookLM PDFs/06 Diabetes/F/06-F2 HbA1c interferences', 'Haemoglobin variants and HbA1c methods.', 2]]) {
  addFile(folder, '00 Scope.md', Buffer.from('# Scope\n' + scope), 'text/markdown');
  for (let i = 0; i < n; i++) addFile(folder, `20${10 + i} - Author - Paper ${i + 1}.pdf`, tinyPdf, 'application/pdf');
}
module.exports = { S };

function op(req) {
  S.calls.push(req.op);
  if (req.key !== KEY) return { ok: false, error: 'bad_key' };
  switch (req.op) {
    case 'ping': return { ok: true, app: 'lectern-sync', v: 1 };
    case 'sync': {
      const accepted = [], conflicts = [], updates = [], done = {};
      for (const ch of req.changes || []) {
        if (done[ch.id]) continue; done[ch.id] = 1;
        const cur = S.records[ch.id], base = ch.baseRev === undefined ? null : ch.baseRev;
        if (cur && cur.rev !== base) { conflicts.push({ id: ch.id, rev: cur.rev, data: cur.data }); continue; }
        S.rev++; S.records[ch.id] = { rev: S.rev, data: ch.data, device: req.device }; accepted.push({ id: ch.id, rev: S.rev });
      }
      const skip = new Set([...accepted, ...conflicts].map(x => x.id));
      for (const [id, r] of Object.entries(S.records)) if (!skip.has(id) && (req.have || {})[id] !== r.rev) updates.push({ id, rev: r.rev, data: r.data });
      return { ok: true, accepted, conflicts, updates, serverRev: S.rev, count: Object.keys(S.records).length, savedBy: req.device };
    }
    case 'info': return { ok: true, count: Object.keys(S.records).length };
    case 'scan': {
      const names = [...new Set(Object.values(S.files).filter(f => !f.trashed && f.folder.startsWith('Lectern/Talks/')).map(f => f.folder.split('/')[2]))];
      const talks = names.map(n => { const fs_ = inFolder('Lectern/Talks/' + n); const st = fs_.find(f => f.name === 'status.md'), sp = fs_.find(f => f.name === 'spine.md'), qq = fs_.find(f => f.name === 'questions.md');
        return { id: 'tf_' + n.replace(/\W+/g, '_'), name: n, status: st ? st.bytes.toString() : '', statusModified: st ? st.modified : '', spine: sp ? sp.id : '', spineModified: sp ? sp.modified : '', questions: qq ? qq.id : '', questionsModified: qq ? qq.modified : '', pack: inFolder('Lectern/Talks/' + n + '/Pack').length, packId: '' }; });
      return { ok: true, inbox: inFolder('Lectern/Inbox').map(pub), decks: inFolder('Lectern/Decks').map(pub), pron: { id: 'pron', modified: S.pronModified || 'p0' }, requests: inFolder('Lectern/Requests').map(pub), talks };
    }
    case 'upBegin': { const id = 'u' + (idn++); S.uploads[id] = { name: req.name, size: req.size, mime: req.mime, folder: 'Lectern/' + (req.folder || '_data/tmp'), replaceId: req.replaceId, parts: [] }; return { ok: true, uploadId: id, chunk: 3 * 1024 * 1024 }; }
    case 'upPart': {
      const u = S.uploads[req.uploadId]; if (!u) return { ok: false, error: 'upload_expired' };
      u.parts.push(Buffer.from(req.b64, 'base64'));
      const got = u.parts.reduce((a, b) => a + b.length, 0);
      if (got < u.size) return { ok: true, done: false, next: got };
      const bytes = Buffer.concat(u.parts);
      let f;
      if (u.replaceId && S.files[u.replaceId]) { f = S.files[u.replaceId]; f.bytes = bytes; f.md5 = md5(bytes); f.modified = new Date().toISOString(); f.name = u.name; }
      else f = addFile(u.folder, u.name, bytes, u.mime);
      delete S.uploads[req.uploadId];
      return { ok: true, done: true, file: pub(f) };
    }
    case 'down': {
      const f = S.files[req.fileId]; if (!f || f.trashed) return { ok: false, error: 'not_found' };
      const CH = 3 * 1024 * 1024, off = req.offset || 0, part = f.bytes.subarray(off, off + CH);
      return { ok: true, b64: part.toString('base64'), size: f.bytes.length, next: off + part.length, done: off + part.length >= f.bytes.length, name: f.name, md5: f.md5 };
    }
    case 'convert': {
      const f = S.files[req.fileId]; if (!f) return { ok: false, error: 'not_found' };
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-'));
      fs.writeFileSync(path.join(dir, 'in.pptx'), f.bytes);
      execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'in.pptx')], { timeout: 120000, stdio: 'ignore' });
      const pdf = addFile('Lectern/_data/tmp', 'lectern-pictures.pdf', fs.readFileSync(path.join(dir, 'in.pdf')), 'application/pdf');
      return { ok: true, pdfId: pdf.id, size: pdf.bytes.length };
    }
    case 'claim': { const f = S.files[req.fileId]; if (!f || f.folder !== 'Lectern/Inbox') return { ok: true, taken: true }; f.folder = 'Lectern/_data/tmp'; return { ok: true, taken: false }; }
    case 'claimMaster': { const k = 'm:' + req.fileId; if (S.props[k] === req.md5) return { ok: true, taken: true }; S.props[k] = req.md5; return { ok: true, taken: false }; }
    case 'adopt': { const f = S.files[req.fileId]; f.folder = 'Lectern/Decks/_versions/' + req.folderName; f.name = req.name; return { ok: true, file: pub(f) }; }
    case 'snapshot': { const f = S.files[req.fileId]; const c = addFile('Lectern/Decks/_versions/' + req.folderName, req.name, f.bytes, f.mime); return { ok: true, file: pub(c) }; }
    case 'setMaster': { const f = S.files[req.fileId]; const c = addFile('Lectern/Decks', req.name, f.bytes, f.mime); if (req.oldId && S.files[req.oldId]) S.files[req.oldId].trashed = true; return { ok: true, file: pub(c) }; }
    case 'trash': { const f = S.files[req.fileId]; if (f) f.trashed = true; return { ok: true }; }
    case 'readText': case 'writeText': case 'appendText': {
      const talkFile = ['ideas', 'spine', 'status', 'questions'].includes(req.which);
      const folder = req.which === 'pron' ? 'Lectern' : talkFile ? 'Lectern/Talks/' + req.name : 'Lectern/Requests';
      const name = req.which === 'pron' ? 'Pronunciations.txt' : talkFile ? req.which + '.md' : String(req.name).replace(/\.md$/, '') + '.md';
      let f = inFolder(folder).find(x => x.name === name);
      if (req.op === 'readText') return f ? { ok: true, exists: true, text: f.bytes.toString(), modified: f.modified } : { ok: true, exists: false, text: req.which === 'pron' ? 'HbA1c = H B A one C\n' : '' };
      if (!f) f = addFile(folder, name, Buffer.from(''), 'text/plain');
      let text = req.op === 'writeText' ? String(req.text) : ((f.bytes.toString().trim() ? f.bytes.toString() : (req.header || '')).replace(/\s*$/, '\n') + req.text + '\n');
      f.bytes = Buffer.from(text); f.md5 = md5(f.bytes); f.modified = new Date().toISOString() + (idn++);
      if (req.which === 'pron') S.pronModified = f.modified;
      return { ok: true, text, modified: f.modified };
    }
    case 'topics': {
      const scopes = Object.values(S.files).filter(f => f.name === '00 Scope.md');
      return { ok: true, at: new Date().toISOString(), topics: scopes.map(f => ({ id: 'folder:' + f.folder, name: f.folder.split('/').pop(), path: f.folder.split('/').join(' / '), scope: f.bytes.toString().replace(/^#.*\n/, ''), pdfs: inFolder(f.folder).filter(x => x.mime === 'application/pdf').length })) };
    }
    case 'libSetRoot': S.props.lib = req.folderId; return { ok: true };
    case 'libList': return { ok: true, id: 'root', name: 'NotebookLM PDFs', items: [] };
    default: return { ok: false, error: 'bad_op' };
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.gs': 'text/plain' };
http.createServer((rq, rs) => {
  rs.setHeader('Access-Control-Allow-Origin', '*');
  if (rq.method === 'OPTIONS') { rs.writeHead(204, { 'Access-Control-Allow-Headers': '*' }); rs.end(); return; }
  if (rq.url.startsWith('/exec')) {
    let body = ''; rq.on('data', c => body += c); rq.on('end', () => {
      let out; try { out = op(JSON.parse(body)); } catch (e) { out = { ok: false, error: 'server', detail: String(e.message) }; }
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(out));
    });
    return;
  }
  if (rq.url.startsWith('/__state')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ records: S.records, files: Object.values(S.files).map(f => Object.assign(pub(f), { folder: f.folder, trashed: f.trashed })), calls: S.calls })); return; }
  if (rq.url.startsWith('/__put')) {   // test hook: drop a file into a Drive folder, or replace a file's content
    const u = new URL(rq.url, 'http://x'); const chunks = []; rq.on('data', c => chunks.push(c)); rq.on('end', () => {
      const bytes = Buffer.concat(chunks); let f;
      if (u.searchParams.get('replace')) { f = S.files[u.searchParams.get('replace')]; f.bytes = bytes; f.md5 = md5(bytes); f.modified = new Date().toISOString(); }
      else f = addFile(u.searchParams.get('folder'), u.searchParams.get('name'), bytes);
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(pub(f)));
    });
    return;
  }
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { rs.writeHead(404); rs.end('nf'); return; }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(rs);
}).listen(PORT, () => console.log('test server on ' + PORT));
