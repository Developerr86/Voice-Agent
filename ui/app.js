import { VoiceAgent } from '../src/index.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusBadge    = document.getElementById('status-badge');
const loadingBar     = document.getElementById('loading-bar');
const loadingFill    = document.getElementById('loading-fill');
const loadingLabel   = document.getElementById('loading-label');
const micBar         = document.getElementById('mic-bar');
const micBarFill     = document.getElementById('mic-bar-fill');
const micBarThreshold = document.getElementById('mic-bar-threshold');
const conversation   = document.getElementById('conversation');
const liveArea       = document.getElementById('live-area');
const liveTranscript = document.getElementById('live-transcript');
const liveResponse   = document.getElementById('live-response');
const talkBtn        = document.getElementById('talk-btn');
const talkLabel      = document.getElementById('talk-label');
const clearBtn       = document.getElementById('clear-btn');
const settingsBtn    = document.getElementById('settings-btn');
const settingsDrawer = document.getElementById('settings-drawer');
const settingsClose  = document.getElementById('settings-close');
const applyBtn       = document.getElementById('apply-settings');

// ── State ─────────────────────────────────────────────────────────────────────
let agent = null;
let listening = false;
let currentResponse = '';
let currentVadThreshold = 0.02; // kept in sync with config so the level handler is always current

// Display scale for the mic bar: levels above MAX_DISPLAY pin to 100%.
const MIC_MAX = 0.1;

const STORE_KEY = 'voice-agent-config';

// ── UI helpers ────────────────────────────────────────────────────────────────
function setStatus(label, cls) {
  statusBadge.textContent = label;
  statusBadge.className = `badge badge--${cls}`;
}

function showLoading(label, pct) {
  loadingBar.classList.remove('hidden');
  loadingLabel.textContent = label;
  loadingFill.style.width = `${Math.min(100, pct)}%`;
}

function hideLoading() {
  loadingBar.classList.add('hidden');
}

function showMicBar(threshold) {
  micBar.classList.remove('hidden');
  // Position the threshold marker based on the configured threshold value.
  const pct = Math.min(95, (threshold / MIC_MAX) * 100);
  micBarThreshold.style.left = `${pct}%`;
}

function hideMicBar() {
  micBar.classList.add('hidden');
}

function updateMicLevel(level, threshold) {
  const pct = Math.min(100, (level / MIC_MAX) * 100);
  micBarFill.style.width = `${pct}%`;
  if (level >= threshold) {
    micBarFill.classList.add('above-threshold');
  } else {
    micBarFill.classList.remove('above-threshold');
  }
}

function addTurn(role, text) {
  const turn = document.createElement('div');
  turn.className = `turn turn--${role}`;
  turn.innerHTML = `<span class="turn__label">${role === 'user' ? 'You' : 'Agent'}</span>
    <p class="turn__text">${escapeHtml(text)}</p>`;
  conversation.appendChild(turn);
  conversation.scrollTop = conversation.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearLive() {
  liveTranscript.textContent = '';
  liveResponse.textContent = '';
  currentResponse = '';
}

// ── Config persistence (localStorage) ────────────────────────────────────────
function saveConfig(config) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      apiKey:       config.llm.apiKey       || '',
      baseURL:      config.llm.baseURL      || '',
      model:        config.llm.model,
      systemPrompt: config.llm.systemPrompt,
      temperature:  config.llm.temperature,
      maxTokens:    config.llm.maxTokens,
      voice:        config.tts.voice,
      speed:        config.tts.speed,
      sttModel:     config.stt.model,
      vadThreshold: config.vad.threshold,
      vadOnset:     config.vad.onsetMs,
      vadSilence:   config.vad.silenceMs,
    }));
  } catch { /* localStorage unavailable */ }
}

function applyStoredConfig() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch {}
  const set = (id, val) => { if (val != null && val !== '') document.getElementById(id).value = val; };
  set('cfg-apiKey',       stored.apiKey);
  set('cfg-baseURL',      stored.baseURL);
  set('cfg-model',        stored.model);
  set('cfg-systemPrompt', stored.systemPrompt);
  set('cfg-temperature',  stored.temperature);
  set('cfg-maxTokens',    stored.maxTokens);
  set('cfg-voice',        stored.voice);
  set('cfg-speed',        stored.speed);
  set('cfg-vadThreshold', stored.vadThreshold);
  set('cfg-vadOnset',     stored.vadOnset);
  set('cfg-vadSilence',   stored.vadSilence != null ? stored.vadSilence / 1000 : null);
  if (stored.sttModel) {
    const sel = document.getElementById('cfg-sttModel');
    const opt = [...sel.options].find(o => o.value === stored.sttModel);
    if (opt) sel.value = stored.sttModel;
  }
}

function applyEnv() {
  const e = import.meta.env;
  const set = (id, val) => { if (val) document.getElementById(id).value = val; };
  set('cfg-apiKey',       e.VITE_LLM_API_KEY);
  set('cfg-baseURL',      e.VITE_LLM_BASE_URL);
  set('cfg-model',        e.VITE_LLM_MODEL);
  set('cfg-systemPrompt', e.VITE_LLM_SYSTEM_PROMPT);
  set('cfg-temperature',  e.VITE_LLM_TEMPERATURE);
  set('cfg-maxTokens',    e.VITE_LLM_MAX_TOKENS);
  set('cfg-voice',        e.VITE_TTS_VOICE);
  set('cfg-speed',        e.VITE_TTS_SPEED);
  if (e.VITE_STT_MODEL) {
    const sel = document.getElementById('cfg-sttModel');
    const opt = [...sel.options].find(o => o.value === e.VITE_STT_MODEL);
    if (opt) sel.value = e.VITE_STT_MODEL;
  }
}

function readConfig() {
  return {
    llm: {
      apiKey:       document.getElementById('cfg-apiKey').value.trim(),
      baseURL:      document.getElementById('cfg-baseURL').value.trim() || undefined,
      model:        document.getElementById('cfg-model').value.trim(),
      systemPrompt: document.getElementById('cfg-systemPrompt').value,
      temperature:  parseFloat(document.getElementById('cfg-temperature').value),
      maxTokens:    parseInt(document.getElementById('cfg-maxTokens').value, 10),
    },
    tts: {
      voice: document.getElementById('cfg-voice').value,
      speed: parseFloat(document.getElementById('cfg-speed').value),
    },
    stt: {
      model: document.getElementById('cfg-sttModel').value,
    },
    vad: {
      threshold: parseFloat(document.getElementById('cfg-vadThreshold').value),
      onsetMs:   parseInt(document.getElementById('cfg-vadOnset').value, 10),
      silenceMs: Math.round(parseFloat(document.getElementById('cfg-vadSilence').value) * 1000),
    },
  };
}

// ── Agent setup ───────────────────────────────────────────────────────────────
function createAgent(config) {
  agent = new VoiceAgent(config);

  agent.on('tts_progress', (progress) => {
    if (progress.status === 'progress') {
      const pct = Math.min(100, Math.round((progress.progress || 0) * 100));
      const label = pct >= 100 ? 'Initializing TTS model…' : `Loading TTS model… ${pct}%`;
      showLoading(label, pct);
    } else if (progress.status === 'initiate') {
      showLoading('Downloading TTS model…', 5);
    }
  });

  agent.on('tts_ready', () => hideLoading());

  agent.on('ready', () => {
    setStatus('Ready', 'ready');
    talkBtn.disabled = false;
    talkLabel.textContent = 'Start Listening';
    hideLoading();
    // If we auto-booted into listening mode, show the mic bar now.
    if (listening) showMicBar(currentVadThreshold);
  });

  // Mic level → update the visualizer bar.
  agent.on('level', (level) => updateMicLevel(level, currentVadThreshold));

  agent.on('speech_start', () => {
    setStatus('Listening…', 'listening');
    clearLive();
  });

  agent.on('speech_end', () => {
    if (!agent._processing) setStatus('Thinking…', 'thinking');
  });

  agent.on('partial', (text) => {
    liveTranscript.textContent = text;
  });

  agent.on('transcript', (text) => {
    liveTranscript.textContent = text;
    currentResponse = '';
    liveResponse.textContent = '';
    setStatus('Thinking…', 'thinking');
  });

  agent.on('response_chunk', (chunk) => {
    currentResponse += chunk;
    liveResponse.textContent = currentResponse;
  });

  agent.on('synthesizing', () => {
    setStatus('Speaking…', 'speaking');
  });

  agent.on('response', (fullText) => {
    const userText = liveTranscript.textContent;
    if (userText) addTurn('user', userText);
    addTurn('agent', fullText);
    clearLive();
    setStatus('Listening…', 'listening');
  });

  agent.on('interrupted', () => {
    clearLive();
    setStatus('Listening…', 'listening');
  });

  agent.on('error', (err) => {
    console.error('VoiceAgent error:', err);
    addTurn('agent', `⚠ ${err?.message || String(err)}`);
    setStatus('Ready', 'ready');
    hideLoading();
  });

  agent.on('stopped', () => {
    setStatus('Idle', 'idle');
    talkBtn.classList.remove('active');
    talkLabel.textContent = 'Start Listening';
    listening = false;
    liveArea.classList.add('hidden');
    hideMicBar();
  });
}

async function bootAgent() {
  setStatus('Loading…', 'loading');
  showLoading('Starting STT model…', 10);
  talkBtn.disabled = true;
  talkLabel.textContent = 'Loading…';

  const cfg = readConfig();
  currentVadThreshold = cfg.vad.threshold;
  createAgent(cfg);

  try {
    await agent.start();
  } catch (err) {
    console.error('Failed to start agent:', err);
    setStatus('Error', 'idle');
    hideLoading();
    talkBtn.disabled = false;
    talkLabel.textContent = 'Retry';
  }
}

// ── Talk button ───────────────────────────────────────────────────────────────
talkBtn.addEventListener('click', async () => {
  if (!agent) return;

  if (!listening) {
    listening = true;
    talkBtn.classList.add('active');
    talkLabel.textContent = 'Stop Listening';
    liveArea.classList.remove('hidden');
    showMicBar(readConfig().vad.threshold);
    setStatus('Listening…', 'listening');

    if (!agent._running) {
      try {
        await agent.start();
      } catch (err) {
        console.error(err);
        agent.emit('error', err);
        listening = false;
        talkBtn.classList.remove('active');
        talkLabel.textContent = 'Start Listening';
      }
    }
  } else {
    agent.stop();
  }
});

// ── Clear button ──────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  conversation.innerHTML = '';
  agent?.clearHistory();
});

// ── Settings drawer ───────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => settingsDrawer.classList.toggle('hidden'));
settingsClose.addEventListener('click', () => settingsDrawer.classList.add('hidden'));

applyBtn.addEventListener('click', () => {
  if (!agent) return;
  const config = readConfig();
  agent.updateConfig(config);
  saveConfig(config);
  currentVadThreshold = config.vad.threshold;
  if (!micBar.classList.contains('hidden')) showMicBar(config.vad.threshold);
  settingsBtn.classList.remove('needs-config');
  settingsDrawer.classList.add('hidden');
});

// ── Boot ──────────────────────────────────────────────────────────────────────
applyStoredConfig();
applyEnv();

const apiKeyInput = document.getElementById('cfg-apiKey');
if (!apiKeyInput.value.trim()) {
  settingsDrawer.classList.remove('hidden');
  settingsBtn.classList.add('needs-config');
  apiKeyInput.focus();
}

apiKeyInput.addEventListener('input', () => {
  if (apiKeyInput.value.trim()) settingsBtn.classList.remove('needs-config');
}, { once: true });

bootAgent();
