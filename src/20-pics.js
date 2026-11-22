/* ============ slide pictures: from a PDF, from PowerPoint's own images, and small thumbnails ============ */
let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import('./vendor/pdf.min.mjs');
  _pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
  return _pdfjs;
}
function canvasBlob(c, type, q) { return new Promise(res => c.toBlob(res, type || 'image/jpeg', q || 0.86)); }
async function makeThumb(blob, w) {
  w = w || 400;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * bmp.height / bmp.width);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  return canvasBlob(c, 'image/jpeg', 0.8);
}
/* Render every page of a PDF to a 1920-wide picture. onPage(i, total) reports progress. */
async function pdfToPictures(buf, onPage) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = 1920 / v1.width;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    out.push(await canvasBlob(c, 'image/jpeg', 0.86));
    page.cleanup();
    if (onPage) onPage(i, doc.numPages);
  }
  doc.destroy();
  return out;
}
/* Match picture pages to slides: one per slide, or one per visible slide when hidden slides were left out. */
function mapPictures(count, slides) {
  if (count === slides.length) return slides.map((s, i) => i);
  const vis = slides.map((s, i) => s.hidden ? -1 : i).filter(i => i >= 0);
  if (count === vis.length) { const m = slides.map(() => -1); vis.forEach((si, k) => { m[si] = k; }); return m; }
  return slides.map((s, i) => i < count ? i : -1);
}
/* Store a picture set: full pictures and thumbnails, keyed "<picsId>/<slide n>". */
async function storePictures(picsId, blobsBySlide, onStep) {
  const entries = [], thumbs = [];
  for (let i = 0; i < blobsBySlide.length; i++) {
    const b = blobsBySlide[i]; if (!b) continue;
    entries.push([`${picsId}/${i + 1}`, b]);
    thumbs.push([`${picsId}/${i + 1}`, await makeThumb(b)]);
    if (onStep) onStep(i + 1, blobsBySlide.length);
  }
  await DB.putMany('pics', entries);
  await DB.putMany('thumbs', thumbs);
}
async function hasPictures(picsId, n) { return !!(picsId && await DB.get('thumbs', `${picsId}/${n || 1}`)); }
/* Pack pictures into one zip for Drive, and unpack. */
async function packPictures(picsId, count) {
  const zip = new JSZip();
  for (let n = 1; n <= count; n++) { const b = await DB.get('pics', `${picsId}/${n}`); if (b) zip.file(String(n).padStart(3, '0') + '.jpg', b); }
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
async function unpackPictures(picsId, bytes, onStep) {
  const zip = await JSZip.loadAsync(bytes), blobs = [];
  const names = Object.keys(zip.files).filter(n => /^\d+\.jpg$/i.test(n)).sort();
  for (const name of names) blobs[Number(name.slice(0, -4)) - 1] = new Blob([await zip.file(name).async('uint8array')], { type: 'image/jpeg' });
  await storePictures(picsId, blobs, onStep);
  return names.length;
}
/* Object URLs for pictures, cached and released when the set changes. */
async function picURL(picsId, n, full) {
  const key = `${picsId}/${n}`, cache = full ? App.picURLs : App.thumbURLs;
  if (cache.has(key)) return cache.get(key);
  const blob = await DB.get(full ? 'pics' : 'thumbs', key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  cache.set(key, url);
  if (full && cache.size > 60) { const [k, u] = cache.entries().next().value; URL.revokeObjectURL(u); cache.delete(k); }
  return url;
}
/* Fill an <img> with a slide picture, or show the slide's text when there is no picture yet. */
function slideImage(v, n, full, cls) {
  const s = v.slides[n - 1] || { title: '', text: '' };
  const wrap = h('div', { class: 'pic' + (cls ? ' ' + cls : ''), style: { aspectRatio: String(v.ratio || 16 / 9) } });
  const fallback = () => { wrap.classList.add('textpic'); wrap.replaceChildren(h('div', { class: 'tp' }, h('b', { text: s.title }), full ? h('p', { text: s.text.split('\n').slice(1, 9).join('\n') }) : null)); };
  if (!v.picsId) { fallback(); return wrap; }
  picURL(v.picsId, n, full).then(url => {
    if (!url) { fallback(); return; }
    const img = h('img', { alt: `Slide ${n}: ${s.title}`, src: url, draggable: 'false', decoding: 'async' });
    wrap.replaceChildren(img);
  });
  return wrap;
}
