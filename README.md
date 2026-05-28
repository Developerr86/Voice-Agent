# voice-agent

Private npm package bundling **Moonshine STT** + **Kokoro TTS** + any **OpenAI-compatible LLM** into a minimal, streaming voice agent with a built-in web UI.

---

## Quick start

```bash
npm run ui        # open the test UI at http://localhost:5173
```

Fill in your API key and LLM endpoint in the Settings panel, then click **Start Listening**.

---

## Install in your own project

```bash
npm install /path/to/voice-agent
```

```js
import { VoiceAgent } from 'voice-agent';

const agent = new VoiceAgent({
  llm: {
    apiKey: 'sk-...',
    baseURL: 'https://api.openai.com/v1',   // any OpenAI-compatible endpoint
    model: 'gpt-4o',
    systemPrompt: 'You are a helpful assistant.',
    temperature: 0.7,
    maxTokens: 512,
  },
  tts: {
    voice: 'af_heart',   // see voice list below
    speed: 1.0,
  },
  stt: {
    model: 'moonshine/tiny',   // or 'moonshine/base'
  },
});

agent.on('transcript', (text) => console.log('You:', text));
agent.on('response_chunk', (chunk) => process.stdout.write(chunk));
agent.on('response', (text) => console.log('\nAgent:', text));
agent.on('error', (err) => console.error(err));

await agent.start();   // requests mic permission; downloads models on first run
```

---

## Pipeline

```
Mic → Moonshine STT (WASM, browser-only) → text
    → OpenAI-compatible LLM (streaming) → token chunks
    → Kokoro TTS (WASM, browser + Node) → audio per sentence → speaker
```

Streaming is end-to-end: LLM tokens flow immediately into the TTS splitter, so audio playback begins before the full LLM response is complete.

---

## Config reference

### LLM
| key | type | default | description |
|-----|------|---------|-------------|
| `apiKey` | string | `'no-key'` | API key for the LLM endpoint |
| `baseURL` | string | OpenAI default | Base URL for any OpenAI-compatible API |
| `model` | string | `'gpt-4o'` | Model ID |
| `systemPrompt` | string | `'You are a helpful assistant.'` | System prompt |
| `temperature` | number | `0.7` | Sampling temperature |
| `maxTokens` | number | `512` | Max response tokens |

### TTS (Kokoro)
| key | type | default | description |
|-----|------|---------|-------------|
| `voice` | string | `'af_heart'` | Voice ID |
| `speed` | number | `1.0` | Speech rate multiplier |
| `dtype` | string | `'q8'` | ONNX quantization (`fp32`, `fp16`, `q8`, `q4`) |
| `device` | string | `'webgpu'` / `'cpu'` | Inference device |

Available voices: `af_heart`, `af_bella`, `af_sarah`, `am_adam`, `am_michael`, `bf_emma`, `bm_george`

### STT (Moonshine)
| key | type | default | description |
|-----|------|---------|-------------|
| `model` | string | `'moonshine/tiny'` | Model size — `moonshine/tiny` or `moonshine/base` |
| `vadThreshold` | number | `0.5` | VAD sensitivity (>0 enables VAD) |

---

## Events

| event | payload | description |
|-------|---------|-------------|
| `ready` | — | Agent started, mic active |
| `partial` | `string` | Live STT partial transcript |
| `transcript` | `string` | Committed STT transcript (full utterance) |
| `response_chunk` | `string` | Streamed LLM token |
| `response` | `string` | Full LLM response (after TTS finishes) |
| `tts_progress` | `object` | Kokoro model download progress |
| `error` | `Error` | Any pipeline error |
| `stopped` | — | Agent stopped |

---

## Methods

```js
await agent.start()          // start listening (downloads models on first run)
agent.stop()                 // stop listening
agent.updateConfig(patch)    // hot-update any config slice
agent.clearHistory()         // reset conversation history
```

---

## Notes

- **Moonshine STT** runs entirely in the browser via WASM — no server needed for transcription. First load downloads model weights (~35 MB for tiny, ~65 MB for base) and caches them.
- **Kokoro TTS** (82M params ONNX) also downloads on first use (~80–300 MB depending on dtype) and is cached by the browser.
- A **secure context** (HTTPS or `localhost`) is required for microphone access.
- The Vite dev server (`npm run ui`) adds the required `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers for SharedArrayBuffer support. The Express server (`npm run serve`) does the same.
- In Node.js environments, STT is unavailable; LLM and TTS work as normal.
