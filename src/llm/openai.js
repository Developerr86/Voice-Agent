import OpenAI from 'openai';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful voice assistant. Respond naturally and conversationally, ' +
  'as if speaking aloud. Match your response length to the question: brief and direct ' +
  'for simple questions, thorough when the topic warrants it. ' +
  'Never use markdown, bullet points, numbered lists, code blocks, or special symbols — ' +
  'speak in plain, complete sentences the way a knowledgeable friend would explain something.';

// Read from process.env when running in Node.js
const _env = typeof process !== 'undefined' ? (process.env || {}) : {};

export class OpenAILLM {
  constructor(config = {}) {
    this.model         = config.model        || _env.LLM_MODEL         || 'gpt-4o';
    this.systemPrompt  = config.systemPrompt || _env.LLM_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
    this.temperature   = config.temperature  ?? 0.7;
    this.maxTokens     = config.maxTokens    || 512;
    this.maxTurns      = config.maxTurns     || 50; // Cap history to prevent unbounded growth (#5)
    this.history = [];

    this._apiKey  = config.apiKey  || _env.LLM_API_KEY  || '';
    this._baseURL = config.baseURL || _env.LLM_BASE_URL || undefined;
    this._client  = this._makeClient();
  }

  _makeClient() {
    const isBrowser = typeof window !== 'undefined';

    if (isBrowser) {
      // Route all requests through the local proxy (/api/llm/*) to avoid CORS.
      // The real API root is carried in X-LLM-Base so the proxy can forward correctly,
      // and so runtime base URL changes (via settings drawer) take effect immediately.
      const effectiveBase = this._baseURL || 'https://api.openai.com/v1';
      return new OpenAI({
        apiKey:                  this._apiKey || 'no-key',
        baseURL:                 `${window.location.origin}/api/llm`,
        dangerouslyAllowBrowser: true,
        defaultHeaders:          { 'X-LLM-Base': effectiveBase },
      });
    }

    return new OpenAI({
      apiKey:   this._apiKey || 'no-key',
      baseURL:  this._baseURL || undefined,
    });
  }

  get hasApiKey() { return !!this._apiKey; }

  async *chat(userMessage, signal) {
    if (!this._apiKey) {
      throw new Error('No API key set. Open Settings (⚙) and enter your API key.');
    }
    const userEntry = { role: 'user', content: userMessage };
    this.history.push(userEntry);

    // Trim history to stay within maxTurns (#5)
    while (this.history.length > this.maxTurns * 2) {
      this.history.shift();
    }

    const stream = await this._client.chat.completions.create({
      model:       this.model,
      messages:    [{ role: 'system', content: this.systemPrompt }, ...this.history],
      temperature: this.temperature,
      max_tokens:  this.maxTokens,
      stream:      true,
      ...(signal ? { signal } : {}),
    });

    let fullResponse = '';
    try {
      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) { fullResponse += delta; yield delta; }
      }
    } catch (err) {
      if (!signal?.aborted) throw err;
    } finally {
      if (fullResponse) {
        this.history.push({ role: 'assistant', content: fullResponse });
      } else {
        // Remove the specific user entry by reference instead of blind pop() (#6)
        const idx = this.history.indexOf(userEntry);
        if (idx !== -1) this.history.splice(idx, 1);
      }
    }
  }

  clearHistory() {
    this.history = [];
  }

  updateConfig(config) {
    if (config.model        !== undefined) this.model        = config.model;
    if (config.systemPrompt !== undefined) this.systemPrompt = config.systemPrompt;
    if (config.temperature  !== undefined) this.temperature  = config.temperature;
    if (config.maxTokens    !== undefined) this.maxTokens    = config.maxTokens;
    if (config.maxTurns     !== undefined) this.maxTurns     = config.maxTurns;
    if (config.apiKey       !== undefined) this._apiKey      = config.apiKey;
    if (config.baseURL      !== undefined) this._baseURL     = config.baseURL || undefined;
    if (config.apiKey !== undefined || config.baseURL !== undefined) {
      this._client = this._makeClient();
    }
  }
}
