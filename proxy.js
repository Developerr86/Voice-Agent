/**
 * LLM reverse proxy — routes browser requests through Node.js to avoid CORS.
 *
 * The browser client sends requests to /api/llm/* (same origin).
 * The real target URL is carried in the X-LLM-Base header so the proxy
 * destination can be changed at runtime without restarting the server.
 *
 * Used by both vite.config.js (dev) and server.js (production).
 */
import https from 'https';
import http from 'http';
import { URL } from 'url';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-LLM-Base',
};

export function proxyLLM(req, res) {
  // X-LLM-Base carries the real API root set by the browser OpenAI client.
  // Falls back to env vars so the proxy works even when the header is absent.
  const rawTarget =
    req.headers['x-llm-base'] ||
    process.env.VITE_LLM_BASE_URL ||
    process.env.LLM_BASE_URL ||
    'https://api.openai.com/v1';

  let base;
  try {
    base = new URL(rawTarget);
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ error: `Invalid LLM base URL: ${rawTarget}` }));
    return;
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // req.url is already the subpath after the mount point (e.g. /chat/completions?stream=true)
  const targetPath = base.pathname.replace(/\/$/, '') + (req.url || '/');
  const isHttps = base.protocol === 'https:';
  const lib = isHttps ? https : http;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['x-llm-base']; // Strip before forwarding to the real API

  const options = {
    hostname: base.hostname,
    port: base.port || (isHttps ? 443 : 80),
    path: targetPath,
    method: req.method,
    headers,
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, ...CORS });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  req.pipe(proxyReq);
}
