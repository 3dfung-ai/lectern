/* Lectern voice: Kokoro text-to-speech running inside the browser (no server). */
import { KokoroTTS, env } from './vendor/kokoro.web.js';
let tts = null;
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.op === 'load') {
      if (!tts) {
        const opts = m.device === 'webgpu' ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'q8', device: 'wasm' };
        try {
          tts = await KokoroTTS.from_pretrained(MODEL, Object.assign({ progress_callback: p => self.postMessage(Object.assign({ type: 'progress' }, p)) }, opts));
        } catch (err) {
          if (m.device !== 'webgpu') throw err;
          // graphics card route failed: fall back to the processor
          tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback: p => self.postMessage(Object.assign({ type: 'progress' }, p)) });
        }
      }
      self.postMessage({ type: 'ready' });
      return;
    }
    if (m.op === 'gen') {
      const audio = await tts.generate(m.text, { voice: m.voice || 'bm_george', speed: m.speed || 1 });
      const pcm = audio.audio instanceof Float32Array ? audio.audio : new Float32Array(audio.audio);
      self.postMessage({ type: 'audio', id: m.id, pcm, sr: audio.sampling_rate }, [pcm.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, error: String((err && err.message) || err) });
  }
};
