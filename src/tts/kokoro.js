import { KokoroTTS, TextSplitterStream } from 'kokoro-js';

// Shared AudioContext — reused across chunks to avoid per-chunk creation overhead.
let _ctx = null;
function getCtx(sampleRate) {
  const AudioCtx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio API not available');
  if (!_ctx || _ctx.state === 'closed') _ctx = new AudioCtx({ sampleRate });
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// Tracks the currently playing BufferSource so it can be stopped on barge-in.
let _currentSource = null;

export function stopAudio() {
  if (_currentSource) {
    try { _currentSource.stop(); } catch {}
    _currentSource = null;
  }
}

/**
 * Play a Kokoro audio chunk. Accepts an optional AbortSignal for barge-in support.
 *
 * kokoro-js stream() yields { audio: Float32Array, sampling_rate } (RawAudio).
 * generate() returns AudioOutput with .play() — both cases handled.
 */
export async function playAudio(audio, signal) {
  if (signal?.aborted) return;

  const samples   = audio?.audio;
  const sampleRate = audio?.sampling_rate ?? 24000;

  if (!samples) {
    if (typeof audio?.play === 'function') return audio.play();
    console.warn('[kokoro] playAudio: unexpected audio format', audio);
    return;
  }

  const pcm    = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const ctx    = getCtx(sampleRate);
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  buffer.copyToChannel(pcm, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  _currentSource = source;

  return new Promise((resolve) => {
    source.onended = () => {
      if (_currentSource === source) _currentSource = null;
      resolve();
    };
    if (signal) {
      signal.addEventListener('abort', () => {
        try { source.stop(); } catch {}
        if (_currentSource === source) _currentSource = null;
        resolve();
      }, { once: true });
    }
    source.start(0);
  });
}

// Detect the best available backend at module load time.
// q8 quantization produces garbled audio on WebGPU — only clean on WASM/CPU.
// WebGPU + fp32 is both faster and artifact-free.
const _hasWebGPU    = typeof navigator !== 'undefined' && !!navigator.gpu;
const _defaultDevice = _hasWebGPU ? 'webgpu' : 'wasm';
const _defaultDtype  = _hasWebGPU ? 'fp32'   : 'q8';

export class KokoroTTSWrapper {
  constructor(config = {}) {
    this.voice  = config.voice  || 'af_heart';
    this.speed  = config.speed  || 1.0;
    this.device = config.device || _defaultDevice;
    this.dtype  = config.dtype  || _defaultDtype;
    this._tts  = null;
    this._initPromise = null;
    console.info(`[kokoro] backend: ${this.device}, dtype: ${this.dtype}`);
  }

  async init(onProgress) {
    if (this._tts) return this._tts;
    if (this._initPromise) return this._initPromise;

    this._initPromise = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: this.dtype,
      device: this.device,
      ...(onProgress ? { progress_callback: onProgress } : {}),
    }).then((tts) => {
      this._tts = tts;
      console.info(`[kokoro] model ready on ${this.device}`);
      return tts;
    });

    return this._initPromise;
  }

  async speak(text) {
    const tts   = await this.init();
    const audio = await tts.generate(text, { voice: this.voice, speed: this.speed });
    return playAudio(audio);
  }

  newSplitter() {
    return new TextSplitterStream();
  }

  async getStream(splitter) {
    const tts = await this.init();
    return tts.stream(splitter, { voice: this.voice, speed: this.speed });
  }
}
