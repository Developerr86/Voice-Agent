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
