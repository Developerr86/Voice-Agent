import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { proxyLLM } from './proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// COOP/COEP headers required for SharedArrayBuffer (WASM threads)
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// LLM proxy — avoids CORS when the browser calls external AI APIs
app.all('/api/llm/*splat', (req, res) => {
  // Strip the mount prefix so proxyLLM sees the subpath in req.url
  req.url = req.url.replace(/^\/api\/llm/, '') || '/';
  proxyLLM(req, res);
});

app.use(express.static(join(__dirname, 'ui')));
app.use('/src', express.static(join(__dirname, 'src')));
app.use('/node_modules', express.static(join(__dirname, 'node_modules')));

app.get('/*splat', (_req, res) => {
  res.sendFile(join(__dirname, 'ui', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Voice Agent UI → http://localhost:${PORT}`);
});
