/* Lectern MP3 maker: turns the voice's audio into an MP3, piece by piece. */
importScripts('vendor/lamejs.iife.js');
let enc = null;
const BLOCK = 1152;
function toInt16(f32) { const o = new Int16Array(f32.length); for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return o; }
self.onmessage = e => {
  const m = e.data;
  if (m.op === 'init') { enc = new lamejs.Mp3Encoder(1, m.sr || 24000, m.kbps || 48); return; }
  if (m.op === 'pcm') {
    const pcm = toInt16(m.pcm);
    for (let i = 0; i < pcm.length; i += BLOCK) {
      const out = enc.encodeBuffer(pcm.subarray(i, i + BLOCK));
      if (out.length) { const c = new Uint8Array(out); self.postMessage({ type: 'data', buf: c }, [c.buffer]); }
    }
    return;
  }
  if (m.op === 'end') { const out = enc.flush(); if (out.length) { const c = new Uint8Array(out); self.postMessage({ type: 'data', buf: c }, [c.buffer]); } self.postMessage({ type: 'done' }); }
};
