## Voice Agent JS Package — Claude Code Plan

### Project Overview

A private npm-installable JS package (`voice-agent`) that bundles Moonshine (STT) + Kokoro (TTS) + any OpenAI-compatible LLM into a simple, configurable voice agent — with a built-in sample web UI for testing.

---

### Package Structure

```
voice-agent/
├── src/
│   ├── index.js              # Main entry point, exports VoiceAgent class
│   ├── stt/
│   │   └── moonshine.js      # Moonshine STT wrapper
│   ├── tts/
│   │   └── kokoro.js         # Kokoro TTS wrapper
│   ├── llm/
│   │   └── openai.js         # OpenAI SDK wrapper (compatible endpoint)
│   └── agent.js              # Orchestrator: STT → LLM → TTS pipeline
├── ui/
│   ├── index.html            # Sample web UI
│   ├── app.js                # UI logic (mic button, transcript, settings panel)
│   └── style.css             # Styling
├── server.js                 # Minimal Express/Vite dev server to serve the UI
├── package.json
└── README.md
```

---

### Core Modules

**`VoiceAgent` class (`agent.js`)**
- Constructor accepts a unified `config` object
- `start()` / `stop()` lifecycle methods
- Event emitters: `on('transcript', ...)`, `on('response', ...)`, `on('audio', ...)`
- Internal pipeline: mic → Moonshine → LLM stream → Kokoro → audio out

**STT config (Moonshine)**
```js
stt: {
  model: 'moonshine/base' | 'moonshine/tiny',  // model size
  language: 'en',
  vadThreshold: 0.5,   // voice activity detection sensitivity
}
```

**TTS config (Kokoro)**
```js
tts: {
  voice: 'af_heart',   // kokoro voice ID
  speed: 1.0,
  lang: 'en-us',
}
```

**LLM config (OpenAI SDK)**
```js
llm: {
  apiKey: 'your-key',
  baseURL: 'https://your-endpoint',
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful assistant.',
  temperature: 0.7,
  maxTokens: 512,
  stream: true,
}
```

---

### Pipeline Flow

```
Microphone Input
      ↓
Moonshine STT  →  transcript text
      ↓
OpenAI-compatible LLM  →  streamed text response
      ↓
Kokoro TTS  →  audio chunks
      ↓
Speaker Output
```

Streaming is used end-to-end: LLM streams tokens → sentence chunking → Kokoro synthesizes per-sentence → plays immediately. This minimizes latency.

---

### Sample Web UI

A clean single-page UI served via `npm run ui` (or `node server.js`):

- **Talk button** — hold or toggle to capture mic input
- **Live transcript panel** — shows STT output in real time
- **Agent response panel** — shows LLM response streaming in
- **Settings drawer** — form inputs to tweak all STT/TTS/LLM config at runtime (no reload needed)
- **Conversation history** — scrollable turn-by-turn log

---

### Build Steps for Claude Code

1. `npm init`, install deps: `kokoro-js`, `@usefulsensors/moonshine-js`, `openai`, `express`
2. Scaffold the folder structure above
3. Implement `moonshine.js` — mic capture via Web Audio API + Moonshine transcription
4. Implement `kokoro.js` — text-to-speech with sentence chunking for low latency
5. Implement `openai.js` — streaming chat completions via OpenAI SDK
6. Implement `agent.js` — wire the three together with the event emitter pattern
7. Implement `src/index.js` — clean public API export
8. Build the web UI (`ui/`) with the settings panel wired to agent config
9. Add `server.js` to serve the UI for local testing
10. Write `README.md` with usage, config reference, and install instructions

---

### Public API (how a consumer uses the package)

```js
import { VoiceAgent } from 'voice-agent';

const agent = new VoiceAgent({
  llm: { apiKey: '...', baseURL: '...', model: 'llama-3' },
  tts: { voice: 'af_heart', speed: 1.0 },
  stt: { model: 'moonshine/base' },
});

agent.on('transcript', (text) => console.log('You said:', text));
agent.on('response', (text) => console.log('Agent:', text));

await agent.start();
```
