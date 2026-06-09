export class MoonshineSTT {
  constructor(config = {}) {
    const raw = config.model || 'moonshine/tiny';
    this._model = raw.startsWith('moonshine/') ? raw.replace('moonshine/', 'model/') : raw;
    this._vad = config.vadThreshold !== undefined ? config.vadThreshold > 0 : true;
    this._transcriber = null;
    this._onTranscript = null;
    this._onPartial = null;
  }

  onTranscript(fn) { this._onTranscript = fn; }
  onPartial(fn) { this._onPartial = fn; }

  async start() {
    if (typeof window === 'undefined') {
      throw new Error('MoonshineSTT requires a browser environment');
    }
    if (this._transcriber) return;

    // Provide actionable error messages for mic permission issues (#8)
    let micStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Microphone permission denied. Please allow microphone access in your browser settings and try again.');
      }
      if (err.name === 'NotFoundError') {
        throw new Error('No microphone found. Please connect a microphone and try again.');
      }
      if (err.name === 'NotReadableError') {
        throw new Error('Microphone is already in use by another application. Please close other apps using the mic and try again.');
      }
      if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        throw new Error('Microphone requires a secure context (HTTPS or localhost). Please access this page via https:// or http://localhost.');
      }
      throw new Error(`Microphone error: ${err.message}`);
    }
    // Stop the test stream — Moonshine will request its own via the transcriber
    micStream.getTracks().forEach(t => t.stop());

    const Moonshine = await import('@moonshine-ai/moonshine-js');

    this._transcriber = new Moonshine.MicrophoneTranscriber(
      this._model,
      {
        onTranscriptionCommitted: (text) => this._onTranscript?.(text),
        onTranscriptionUpdated: (text) => this._onPartial?.(text),
      },
      this._vad
    );

    await this._transcriber.start();
  }

  stop() {
    this._transcriber?.stop();
    this._transcriber = null;
  }
}
