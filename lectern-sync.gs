/**
 * Lectern sync: keeps your talks in your own Google Drive.
 *
 *   My Drive / 00_Apps / Lectern /
 *     Talks/<talk>/ status.md (Claude keeps it current), spine.md, ideas.md, questions.md, Pack/ (the talk's PDFs)
 *     Inbox/        drop a .pptx here (you, or Claude) and Lectern imports it
 *     Decks/        the current .pptx of each talk; edit it in PowerPoint and Lectern notices
 *     Decks/_versions/  every earlier version, kept
 *     Audio/        talk MP3s
 *     Requests/     <talk>.md change requests you flag while rehearsing (Claude reads these)
 *     Pronunciations.txt   how the voice says HbA1c, eGFR, ...
 *     _data/        Lectern's own files (index, slide pictures). Leave alone.
 *
 * One-time setup
 *   1. Run "setup" once (Run button). Allow access when Google asks.
 *   2. Copy the sync key from the Execution log.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *   4. Paste the Web app link (ends in /exec) and the key into Lectern > Settings > Drive sync.
 *
 * The script answers only requests that carry your sync key. The key lives in this
 * script's properties, never in the public Lectern page. File operations are limited
 * to files inside the Lectern folder.
 */
var APP = 'lectern-sync', VERSION = 1;
var ROOT_PATH = ['00_Apps', 'Lectern'];
var INDEX_FILE = 'lectern-index.json';
var KEEP_BACKUPS = 30, AUTO_BACKUP_HOURS = 20;
var CHUNK = 3 * 1024 * 1024;           // multiple of 256 KiB, as Drive's resumable upload requires
var PRON_DEFAULT = [
  '# How Lectern\'s voice should say things. One per line: written = spoken',
  '# Lines starting with # are ignored. Lectern and Claude can both add lines.',
  'HbA1c = H B A one C', 'eGFR = e G F R', 'POCT = P O C T', 'INR = I N R', 'HPLC = H P L C',
  'SPE = S P E', 'IFE = I F E', 'iCa = ionised calcium', 'pCO2 = P C O two', 'pO2 = P O two',
  'mmol/L = millimoles per litre', 'umol/L = micromoles per litre', 'µmol/L = micromoles per litre',
  'g/L = grams per litre', 'mg/dL = milligrams per decilitre', 'CA 19-9 = C A nineteen nine',
  'e.g. = for example', 'i.e. = that is', 'vs = versus', 'ICU = I C U', 'ED = E D',
  'CLSI = C L S I', 'IFCC = I F C C', 'EFLM = E F L M', 'NICE = nice', 'WHO = W H O'
].join('\n') + '\n';

function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SYNC_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SYNC_KEY', key);
  }
  ['Talks', 'Inbox', 'Decks', 'Audio', 'Requests', '_data'].forEach(function (n) { sub_(n); });
  sub_('_data/pics'); sub_('_data/tmp'); sub_('_data/backups'); sub_('Decks/_versions');
  pronFile_();
  indexFile_();
  // Touch the Drive API once so Google asks for every permission now, not later.
  driveApi_('GET', 'files/' + root_().getId() + '?fields=id');
  Logger.log('Lectern sync is ready.');
  Logger.log('Sync key: ' + key);
  Logger.log('Folder: ' + root_().getUrl());
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Paste the Web app link and this key into Lectern.');
}

/* Run this only if a setup link was shared by mistake. Every device then needs the new key. */
function newKey() {
  PropertiesService.getScriptProperties().deleteProperty('SYNC_KEY');
  setup();
}

function doGet() {
  return json_({ ok: true, app: APP, v: VERSION, note: 'Lectern sync is running. Use this link inside Lectern.' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  var key = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  if (!key || !req || typeof req.key !== 'string' || req.key !== key) return json_({ ok: false, error: 'bad_key' });
  try {
    switch (req.op) {
      case 'ping': return json_({ ok: true, app: APP, v: VERSION });
      case 'sync': return locked_(function () { return sync_(req); });
      case 'info': return json_(info_());
      case 'scan': return json_(scan_());
      case 'upBegin': return json_(upBegin_(req));
      case 'upPart': return json_(upPart_(req));
      case 'down': return json_(down_(req));
      case 'convert': return json_(convert_(req));
      case 'adopt': return json_(adopt_(req));
      case 'setMaster': return json_(setMaster_(req));
      case 'trash': return json_(trash_(req));
      case 'readText': return json_(readText_(req));
      case 'writeText': return locked_(function () { return writeText_(req); });
      case 'appendText': return locked_(function () { return appendText_(req); });
      case 'claim': return locked_(function () { return claim_(req); });
      case 'claimMaster': return locked_(function () { return claimMaster_(req); });
      case 'snapshot': return json_(snapshot_(req));

      default: return json_({ ok: false, error: 'bad_op' });
    }
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code, detail: err.detail || '' });
    return json_({ ok: false, error: 'server', detail: String((err && err.message) || err).slice(0, 300) });
  }
}

function locked_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: 'busy' });
  try { return json_(fn()); } finally { lock.releaseLock(); }
}

/* ---------- index sync (records with revisions; same pattern as Quotes) ---------- */
function sync_(req) {
  var file = indexFile_();
  var store = readStore_(file);
  var recs = store.records, now = Date.now();
  var device = String(req.device || '').slice(0, 60);
  var changes = Array.isArray(req.changes) ? req.changes : [];
  var accepted = [], conflicts = [], apply = [], done = {};
  for (var i = 0; i < changes.length; i++) {
    var ch = changes[i];
    if (!ch || typeof ch.id !== 'string' || !ch.id || ch.id.length > 200 || done[ch.id]) continue;
    done[ch.id] = true;
    if (!ch.data || typeof ch.data !== 'object') continue;
    var cur = recs[ch.id];
    var base = ch.baseRev === undefined ? null : ch.baseRev;
    if (cur && cur.rev !== base) { conflicts.push({ id: ch.id, rev: cur.rev, device: cur.device || '', data: cur.data }); continue; }
    apply.push(ch);
  }
  if (apply.length) {
    var due = !store.lastBackupAt || now - store.lastBackupAt > AUTO_BACKUP_HOURS * 3600 * 1000;
    if (due && Object.keys(recs).length) { backup_(file); store.lastBackupAt = now; }
    for (var j = 0; j < apply.length; j++) {
      var c = apply[j];
      store.rev += 1;
      recs[c.id] = { rev: store.rev, updated: now, device: device, data: c.data };
      accepted.push({ id: c.id, rev: store.rev });
    }
    store.savedAt = new Date(now).toISOString();
    store.savedBy = device;
    file.setContent(JSON.stringify(store));
  }
  var have = req.have && typeof req.have === 'object' ? req.have : {};
  var skip = {};
  accepted.forEach(function (a) { skip[a.id] = true; });
  conflicts.forEach(function (c) { skip[c.id] = true; });
  var updates = [];
  Object.keys(recs).forEach(function (id) {
    var r = recs[id];
    if (skip[id] || have[id] === r.rev) return;
    updates.push({ id: id, rev: r.rev, device: r.device || '', data: r.data });
  });
  return { ok: true, accepted: accepted, conflicts: conflicts, updates: updates, serverRev: store.rev,
    count: Object.keys(recs).length, savedAt: store.savedAt || null, savedBy: store.savedBy || '' };
}

function info_() {
  var store = readStore_(indexFile_());
  return { ok: true, app: APP, v: VERSION, folderUrl: root_().getUrl(), count: Object.keys(store.records).length,
    serverRev: store.rev, savedAt: store.savedAt || null, savedBy: store.savedBy || '' };
}

function backup_(file) {
  var folder = sub_('_data/backups');
  var stamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
  folder.createFile('lectern-index_' + stamp + '.json', file.getBlob().getDataAsString(), 'application/json');
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
}

function emptyStore_() { return { app: APP, schema: 1, rev: 0, records: {} }; }
function readStore_(file) {
  var raw = file.getBlob().getDataAsString();
  if (!raw || !raw.trim()) return emptyStore_();
  var s;
  try { s = JSON.parse(raw); } catch (err) { throw { code: 'corrupt_store' }; }   // never overwrite an unreadable file
  if (!s || typeof s !== 'object' || (s.records && typeof s.records !== 'object')) throw { code: 'corrupt_store' };
  s.records = s.records || {}; s.rev = s.rev || 0; s.app = APP; s.schema = 1;
  return s;
}

/* ---------- what is in Drive: Inbox drops, masters edited in PowerPoint, shared text files ---------- */
function scan_() {
  var out = { ok: true, inbox: [], decks: [] };
  out.inbox = list_(sub_('Inbox').getId(), "mimeType != 'application/vnd.google-apps.folder'");
  out.decks = list_(sub_('Decks').getId(), "mimeType != 'application/vnd.google-apps.folder'");
  var pron = pronFile_(), req = sub_('Requests');
  out.pron = { id: pron.getId(), modified: pron.getLastUpdated().toISOString() };
  out.requests = list_(req.getId(), "mimeType != 'application/vnd.google-apps.folder'");
  // Talks/<talk>/status.md: Claude's note of where each talk is, read so Lectern can show it
  out.talks = list_(sub_('Talks').getId(), "mimeType = 'application/vnd.google-apps.folder'").map(function (t) {
    var files = list_(t.id, ''), o = { id: t.id, name: t.name, status: '', statusModified: '', spine: '', spineModified: '', pack: 0, packId: '' };
    files.forEach(function (f) {
      if (f.name === 'status.md') { o.statusModified = f.modified; o.status = DriveApp.getFileById(f.id).getBlob().getDataAsString().slice(0, 4000); }
      if (f.name === 'spine.md') { o.spine = f.id; o.spineModified = f.modified; }
      if (f.name === 'questions.md') { o.questions = f.id; o.questionsModified = f.modified; }
      if (f.name === 'Pack' && f.mime === 'application/vnd.google-apps.folder') { o.packId = f.id; o.pack = list_(f.id, "mimeType = 'application/pdf'").length; }
    });
    return o;
  });
  return out;
}

function list_(folderId, extra) {
  var q = "'" + folderId + "' in parents and trashed = false" + (extra ? ' and ' + extra : '');
  var files = [], token = '';
  do {
    var res = driveApi_('GET', 'files?pageSize=500&fields=nextPageToken,files(id,name,size,md5Checksum,modifiedTime,mimeType)&q=' + encodeURIComponent(q) + (token ? '&pageToken=' + token : ''));
    files = files.concat(res.files || []); token = res.nextPageToken || '';
  } while (token && files.length < 3000);
  return files.map(function (f) {
    return { id: f.id, name: f.name, size: Number(f.size || 0), md5: f.md5Checksum || '', modified: f.modifiedTime, mime: f.mimeType };
  });
}

/* ---------- uploads: resumable, in 3 MB parts, straight into Drive ---------- */
function upBegin_(req) {
  var name = safeName_(req.name), size = Number(req.size) || 0, mime = String(req.mime || 'application/octet-stream');
  if (!name || size <= 0) throw { code: 'bad_upload' };
  var url, meta = { name: name, mimeType: mime };
  if (req.replaceId) {
    inside_(req.replaceId);
    url = 'https://www.googleapis.com/upload/drive/v3/files/' + req.replaceId + '?uploadType=resumable&fields=id,name,size,md5Checksum,modifiedTime';
    meta = { name: name };
    var r = UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': mime }, muteHttpExceptions: true });
  } else {
    var folder = sub_(String(req.folder || '_data/tmp'));
    meta.parents = [folder.getId()];
    url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,modifiedTime';
    var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': mime }, muteHttpExceptions: true });
  }
  if (r.getResponseCode() !== 200) throw { code: 'drive', detail: 'upload start ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200) };
  var session = r.getHeaders()['Location'] || r.getHeaders()['location'];
  var id = Utilities.getUuid();
  CacheService.getScriptCache().put('up:' + id, JSON.stringify({ s: session, size: size, mime: mime }), 21600);
  return { ok: true, uploadId: id, chunk: CHUNK };
}

function upPart_(req) {
  var raw = CacheService.getScriptCache().get('up:' + String(req.uploadId || ''));
  if (!raw) throw { code: 'upload_expired' };
  var up = JSON.parse(raw), offset = Number(req.offset) || 0;
  var bytes = Utilities.base64Decode(String(req.b64 || ''));
  if (!bytes.length) throw { code: 'bad_upload' };
  var end = offset + bytes.length - 1;
  var r = UrlFetchApp.fetch(up.s, { method: 'put', payload: Utilities.newBlob(bytes, up.mime),
    headers: { 'Content-Range': 'bytes ' + offset + '-' + end + '/' + up.size }, muteHttpExceptions: true });
  var code = r.getResponseCode();
  if (code === 308) return { ok: true, done: false, next: end + 1 };
  if (code === 200 || code === 201) {
    CacheService.getScriptCache().remove('up:' + req.uploadId);
    var f = JSON.parse(r.getContentText());
    return { ok: true, done: true, file: { id: f.id, name: f.name, size: Number(f.size || 0), md5: f.md5Checksum || '', modified: f.modifiedTime } };
  }
  throw { code: 'drive', detail: 'upload part ' + code + ' ' + r.getContentText().slice(0, 200) };
}

/* ---------- downloads, 3 MB at a time ---------- */
function down_(req) {
  var id = String(req.fileId || '');
  var meta = inside_(id);
  var size = Number(meta.size || 0), offset = Number(req.offset) || 0;
  var end = Math.min(size, offset + CHUNK) - 1;
  if (size === 0) return { ok: true, b64: '', size: 0, next: 0, done: true, name: meta.name, md5: meta.md5Checksum || '' };
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + offset + '-' + end }, muteHttpExceptions: true });
  var code = r.getResponseCode();
  if (code !== 206 && code !== 200) throw { code: 'drive', detail: 'download ' + code };
  return { ok: true, b64: Utilities.base64Encode(r.getContent()), size: size, next: end + 1, done: end + 1 >= size,
    name: meta.name, md5: meta.md5Checksum || '', modified: meta.modifiedTime };
}

/* ---------- Google redraws the slides: .pptx -> Slides -> PDF ---------- */
function convert_(req) {
  var id = String(req.fileId || '');
  inside_(id);
  var tmp = sub_('_data/tmp');
  var copy = driveApi_('POST', 'files/' + id + '/copy?fields=id', { name: 'lectern-convert-' + Date.now(), mimeType: 'application/vnd.google-apps.presentation', parents: [tmp.getId()] });
  try {
    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + copy.id + '/export?mimeType=application/pdf', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) {
      var t = r.getContentText();
      if (/exportSizeLimitExceeded|too large/i.test(t)) throw { code: 'too_big_for_google' };
      throw { code: 'drive', detail: 'export ' + r.getResponseCode() + ' ' + t.slice(0, 200) };
    }
    var pdf = tmp.createFile(r.getBlob().setName('lectern-pictures-' + Date.now() + '.pdf'));
    return { ok: true, pdfId: pdf.getId(), size: pdf.getSize() };
  } finally {
    try { DriveApp.getFileById(copy.id).setTrashed(true); } catch (e) { }
  }
}

/* An Inbox file becomes a kept version: moved into Decks/_versions/<talk>/ */
function adopt_(req) {
  var id = String(req.fileId || '');
  inside_(id);
  var folder = sub_('Decks/_versions/' + safeName_(req.folderName || 'Talk'));
  var f = driveApi_('PATCH', 'files/' + id + '?fields=id,name,size,md5Checksum,modifiedTime,parents&addParents=' + folder.getId() +
    '&removeParents=' + encodeURIComponent((DriveApp.getFileById(id).getParents().next()).getId()), { name: safeName_(req.name || DriveApp.getFileById(id).getName()) });
  return { ok: true, file: { id: f.id, name: f.name, size: Number(f.size || 0), md5: f.md5Checksum || '', modified: f.modifiedTime } };
}

/* Put a copy of a kept version in Decks/ as the talk's current .pptx, replacing the old one. */
function setMaster_(req) {
  var src = String(req.fileId || '');
  inside_(src);
  var decks = sub_('Decks');
  var f = driveApi_('POST', 'files/' + src + '/copy?fields=id,name,size,md5Checksum,modifiedTime', { name: safeName_(req.name || 'Talk.pptx'), parents: [decks.getId()] });
  if (req.oldId && req.oldId !== f.id) { try { inside_(req.oldId); DriveApp.getFileById(req.oldId).setTrashed(true); } catch (e) { } }
  return { ok: true, file: { id: f.id, name: f.name, size: Number(f.size || 0), md5: f.md5Checksum || '', modified: f.modifiedTime } };
}

function trash_(req) {
  var id = String(req.fileId || '');
  inside_(id);
  DriveApp.getFileById(id).setTrashed(true);
  return { ok: true };
}

/* Shared plain-text files: Pronunciations.txt and Requests/<talk>.md */
function readText_(req) {
  var f = textFile_(req, false);
  if (!f) return { ok: true, exists: false, text: '' };
  return { ok: true, exists: true, id: f.getId(), text: f.getBlob().getDataAsString(), modified: f.getLastUpdated().toISOString() };
}
function writeText_(req) {
  var f = textFile_(req, true);
  f.setContent(String(req.text || ''));
  return { ok: true, id: f.getId(), modified: f.getLastUpdated().toISOString() };
}
function appendText_(req) {
  var f = textFile_(req, true);
  var cur = f.getBlob().getDataAsString();
  var head = String(req.header || '');
  if (!cur.trim() && head) cur = head;
  var line = String(req.text || '').replace(/\s+$/, '');
  f.setContent(cur.replace(/\s*$/, '\n') + line + '\n');
  return { ok: true, id: f.getId(), text: f.getBlob().getDataAsString(), modified: f.getLastUpdated().toISOString() };
}

/* Only one device imports an Inbox file: the first to claim it moves it out of the Inbox. */
function claim_(req) {
  var id = String(req.fileId || '');
  var meta = inside_(id), inbox = sub_('Inbox').getId();
  if ((meta.parents || []).indexOf(inbox) < 0) return { ok: true, taken: true };
  var tmp = sub_('_data/tmp').getId();
  driveApi_('PATCH', 'files/' + id + '?addParents=' + tmp + '&removeParents=' + inbox + '&fields=id', {});
  return { ok: true, taken: false, name: meta.name, size: Number(meta.size || 0), md5: meta.md5Checksum || '' };
}

/* Only one device turns an edit made in PowerPoint into a new version. */
function claimMaster_(req) {
  var props = PropertiesService.getScriptProperties(), k = 'master:' + String(req.fileId || '');
  if (props.getProperty(k) === String(req.md5 || '')) return { ok: true, taken: true };
  props.setProperty(k, String(req.md5 || ''));
  return { ok: true, taken: false };
}

/* Keep a copy of a file (the edited master) as a version. */
function snapshot_(req) {
  var id = String(req.fileId || '');
  inside_(id);
  var folder = sub_('Decks/_versions/' + safeName_(req.folderName || 'Talk'));
  var f = driveApi_('POST', 'files/' + id + '/copy?fields=id,name,size,md5Checksum,modifiedTime', { name: safeName_(req.name || 'version.pptx'), parents: [folder.getId()] });
  return { ok: true, file: { id: f.id, name: f.name, size: Number(f.size || 0), md5: f.md5Checksum || '', modified: f.modifiedTime } };
}

function textFile_(req, create) {
  if (req.which === 'pron') return pronFile_();
  if (['ideas', 'spine', 'status', 'questions'].indexOf(req.which) >= 0) {
    var tf = sub_('Talks/' + safeName_(req.name || 'Talk')), tn = req.which + '.md';
    var ti = tf.getFilesByName(tn);
    if (ti.hasNext()) return ti.next();
    return create ? tf.createFile(tn, '', 'text/markdown') : null;
  }
  if (req.which === 'request') {
    var folder = sub_('Requests'), name = safeName_(req.name || 'Talk').replace(/\.md$/i, '') + '.md';
    var it = folder.getFilesByName(name);
    if (it.hasNext()) return it.next();
    return create ? folder.createFile(name, '', 'text/markdown') : null;
  }
  throw { code: 'bad_text' };
}

/* ---------- helpers ---------- */
function driveApi_(method, path, body) {
  var opt = { method: method.toLowerCase(), headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) { opt.contentType = 'application/json; charset=UTF-8'; opt.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/' + path, opt);
  var code = r.getResponseCode();
  if (code >= 300) throw { code: code === 404 ? 'not_found' : 'drive', detail: method + ' ' + path.split('?')[0] + ' ' + code + ' ' + r.getContentText().slice(0, 200) };
  var t = r.getContentText();
  return t ? JSON.parse(t) : {};
}

/* Only files inside My Drive/00_Apps/Lectern may be read, changed or trashed. */
function inside_(id) {
  if (!id) throw { code: 'not_found' };
  var rootId = root_().getId();
  var meta = driveApi_('GET', 'files/' + id + '?fields=id,name,size,md5Checksum,modifiedTime,parents,trashed');
  var parents = meta.parents || [], seen = 0;
  while (parents.length && seen < 8) {
    if (parents.indexOf(rootId) >= 0) return meta;
    var p = driveApi_('GET', 'files/' + parents[0] + '?fields=id,parents');
    parents = p.parents || []; seen++;
  }
  throw { code: 'outside_lectern' };
}

function root_() {
  var cache = CacheService.getScriptCache(), id = cache.get('root');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var folder = DriveApp.getRootFolder();
  ROOT_PATH.forEach(function (name) {
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  cache.put('root', folder.getId(), 21600);
  return folder;
}

function sub_(path) {
  var folder = root_();
  String(path).split('/').forEach(function (name) {
    if (!name) return;
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

function indexFile_() {
  var folder = sub_('_data'), it = folder.getFilesByName(INDEX_FILE);
  if (it.hasNext()) return it.next();
  return folder.createFile(INDEX_FILE, JSON.stringify(emptyStore_()), 'application/json');
}

function pronFile_() {
  var folder = root_(), it = folder.getFilesByName('Pronunciations.txt');
  if (it.hasNext()) return it.next();
  return folder.createFile('Pronunciations.txt', PRON_DEFAULT, 'text/plain');
}

function safeName_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
