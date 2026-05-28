export class MicLevelMonitor {
  constructor({ threshold = 0.02, silenceMs = 7000, onsetMs = 300 } = {}) {
    this.threshold = threshold;
    this.silenceMs = silenceMs;
    this.onsetMs   = onsetMs;   // level must stay above threshold this long before speech_start fires
    this._stream   = null;
    this._ctx      = null;
    this._analyser = null;
    this._data     = null;
    this._rafId       = null;
    this._onsetTimer  = null;  // fires after sustained above-threshold → confirm speech
    this._silenceTimer = null; // fires after sustained below-threshold → confirm silence
    this._speaking = false;
    this._active   = false;
    this._listeners = new Map();
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return this;
  }

  _emit(event, ...args) {
    for (const fn of (this._listeners.get(event) || [])) fn(...args);
  }

  async start() {
    // Separate mic stream with echo cancellation so the agent's TTS output
    // doesn't trigger the barge-in threshold.
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const AudioCtx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    this._ctx = new AudioCtx();
    const source = this._ctx.createMediaStreamSource(this._stream);
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    source.connect(this._analyser);
    this._data = new Float32Array(this._analyser.fftSize);
    this._active = true;
    this._tick();
  }

  _tick() {
    if (!this._active) return;
    this._analyser.getFloatTimeDomainData(this._data);
    let sum = 0;
    for (const s of this._data) sum += s * s;
    const level = Math.sqrt(sum / this._data.length);
    this._emit('level', level);

    if (level >= this.threshold) {
      // Above threshold: cancel any pending silence timer.
      if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }

      if (!this._speaking && !this._onsetTimer) {
        // Start the onset hold timer — only confirm speech after sustained above-threshold.
        // This filters out short transient spikes (coughs, clicks, background pops).
        this._onsetTimer = setTimeout(() => {
          this._onsetTimer = null;
          this._speaking = true;
          this._emit('speech_start');
        }, this.onsetMs);
      }
    } else {
      // Below threshold: cancel the onset timer (was just a spike, not real speech).
      if (this._onsetTimer) { clearTimeout(this._onsetTimer); this._onsetTimer = null; }

      if (this._speaking && !this._silenceTimer) {
        this._silenceTimer = setTimeout(() => {
          this._silenceTimer = null;
          this._speaking     = false;
          this._emit('speech_end');
        }, this.silenceMs);
      }
    }

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  stop() {
    this._active = false;
    if (this._rafId)       { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._onsetTimer)  { clearTimeout(this._onsetTimer);  this._onsetTimer  = null; }
    if (this._silenceTimer){ clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    this._speaking = false;
    this._stream?.getTracks().forEach(t => t.stop());
    this._ctx?.close().catch(() => {});
    this._stream = null;
    this._ctx    = null;
  }
}
