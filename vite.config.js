import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { proxyLLM } from './proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'ui',
  envDir: __dirname, // load .env from project root, not from ui/
  resolve: {
    alias: {
      'voice-agent': resolve(__dirname, 'src/index.js'),
    },
  },
  optimizeDeps: {
    // These ship their own WASM — exclude from Vite pre-bundling
    exclude: ['@moonshine-ai/moonshine-js', 'kokoro-js'],
  },
  plugins: [
    {
      name: 'llm-proxy',
      configureServer(server) {
        // Intercept /api/llm/* and forward to the real LLM endpoint server-side.
        // This avoids CORS issues with APIs that don't allow browser-side requests.
        server.middlewares.use('/api/llm', proxyLLM);
      },
    },
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
