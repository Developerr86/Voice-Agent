import { MoonshineSTT } from './stt/moonshine.js';
import { KokoroTTSWrapper, playAudio } from './tts/kokoro.js';
import { OpenAILLM } from './llm/openai.js';
import { MicLevelMonitor } from './vad.js';

class EventEmitter {
  constructor() { this._listeners = new Map(); }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners.get(event) || [];
    this._listeners.set(event, list.filter((l) => l !== fn));
    return this;
  }

  emit(event, ...args) {
    for (const fn of this._listeners.get(event) || []) fn(...args);
  }
}

export class VoiceAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this._stt  = new MoonshineSTT(config.stt || {});
    this._tts  = new KokoroTTSWrapper(config.tts || {});
    this._llm  = new OpenAILLM(config.llm || {});
    this._vad  = null;
    this._running    = false;
    this._processing = false;
    this._respondAbort   = null;
    this._pendingTranscript = '';
  }

  async start() {
    if (this._running) return;
    this._running = true;

    this._tts.init((progress) => this.emit('tts_progress', progress))
      .then(() => this.emit('tts_ready'))
      .catch((err) => this.emit('error', err));

    this._pendingTranscript = '';

    // Moonshine accumulates text; VAD decides when to send to LLM.
    this._stt.onPartial((text) => this.emit('partial', text));
    this._stt.onTranscript((text) => {
      if (!text.trim()) return;
      this._pendingTranscript += (this._pendingTranscript ? ' ' : '') + text;
      this.emit('transcript', this._pendingTranscript);
    });

    await this._stt.start();

    // VAD: barge-in detection + silence-triggered LLM call.
    try {
      this._vad = new MicLevelMonitor({
        threshold: this.config.vad?.threshold ?? 0.02,
        onsetMs:   this.config.vad?.onsetMs   ?? 300,
        silenceMs: this.config.vad?.silenceMs ?? 7000,
      });

      this._vad.on('level', (level) => this.emit('level', level));

      this._vad.on('speech_start', () => {
        this.emit('speech_start');
        // Barge-in: user started speaking while agent is talking → stop TTS.
        if (this._processing) this.interrupt();
        this._pendingTranscript = '';
      });

      this._vad.on('speech_end', () => {
        this.emit('speech_end');
        const text = this._pendingTranscript.trim();
        this._pendingTranscript = '';
        if (text && !this._processing) {
          this._respond(text);
        }
      });

      await this._vad.start();
    } catch (err) {
      // VAD is optional — if mic permission is denied, fall back to
      // Moonshine-commit-driven mode (old behavior: each committed phrase
      // is sent to the LLM immediately).
      console.warn('[agent] VAD unavailable, falling back to commit-driven mode:', err.message);
      this._vad = null;
      this._stt.onTranscript((text) => {
        if (!text.trim()) return;
        this.emit('transcript', text);
        this._respond(text);
      });
    }

    this.emit('ready');
  }

  stop() {
    this._running = false;
    this._stt.stop();
    this._vad?.stop();
    this._vad = null;
    this.interrupt();
    this._pendingTranscript = '';
    this.emit('stopped');
  }

  // Stop ongoing TTS + LLM stream immediately (barge-in or user stops).
  interrupt() {
    if (this._respondAbort) {
      this._respondAbort.abort();
      this._respondAbort = null;
    }
    this._processing = false;
    this.emit('interrupted');
  }

  async _respond(userText) {
    if (this._processing) return;
    this._processing = true;

    const ac = new AbortController();
    this._respondAbort = ac;
    let fullResponse = '';

    try {
      const splitter     = this._tts.newSplitter();
      const audioStream  = await this._tts.getStream(splitter);

      // Pump LLM tokens into the splitter concurrently with audio playback.
      const pump = (async () => {
        try {
          for await (const chunk of this._llm.chat(userText, ac.signal)) {
            if (ac.signal.aborted) break;
            fullResponse += chunk;
            this.emit('response_chunk', chunk);
            splitter.push(chunk);
          }
        } finally {
          splitter.close();
        }
      })();

      for await (const { audio } of audioStream) {
        if (ac.signal.aborted) break;
        this.emit('synthesizing');
        await playAudio(audio, ac.signal);
      }

      try { await pump; } catch {} // pump may reject if aborted

      if (!ac.signal.aborted) {
        this.emit('response', fullResponse);
      }
    } catch (err) {
      if (!ac.signal.aborted) this.emit('error', err);
    } finally {
      this._processing = false;
      if (this._respondAbort === ac) this._respondAbort = null;
    }
  }

  updateConfig(patch) {
    if (patch.llm) this._llm.updateConfig(patch.llm);
    if (patch.tts) Object.assign(this._tts, patch.tts);
    if (patch.vad && this._vad) {
      if (patch.vad.threshold !== undefined) this._vad.threshold = patch.vad.threshold;
      if (patch.vad.onsetMs   !== undefined) this._vad.onsetMs   = patch.vad.onsetMs;
      if (patch.vad.silenceMs !== undefined) this._vad.silenceMs = patch.vad.silenceMs;
    }
    if (patch.stt?.model) {
      const wasRunning = !!this._stt._transcriber;
      this._stt.stop();
      this._stt = new MoonshineSTT({ ...this.config.stt, ...patch.stt });
      this._stt.onPartial((text) => this.emit('partial', text));
      this._stt.onTranscript((text) => {
        if (!text.trim()) return;
        if (this._vad) {
          this._pendingTranscript += (this._pendingTranscript ? ' ' : '') + text;
          this.emit('transcript', this._pendingTranscript);
        } else {
          this.emit('transcript', text);
          this._respond(text);
        }
      });
      if (wasRunning) this._stt.start().catch((err) => this.emit('error', err));
    }
    this.config = { ...this.config, ...patch };
  }

  clearHistory() {
    this._llm.clearHistory();
  }
}
