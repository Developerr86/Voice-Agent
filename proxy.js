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
import dns from 'dns';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-LLM-Base',
};

// ── SSRF protection (#1) ─────────────────────────────────────────────────────
// Reject private, loopback, and link-local IP ranges to prevent server-side
// request forgery via a malicious X-LLM-Base header.
const PRIVATE_IPV4_RE =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
const PRIVATE_IPV6_RE =
  /^(::1|fe80:|fc00:|fd)/i;

function isPrivateHostname(host) {
  // IPv4 literal (e.g. 127.0.0.1)
  if (/^\d+(\.\d+){3}$/.test(host)) return PRIVATE_IPV4_RE.test(host);
  // IPv6 literal in brackets (e.g. [::1])
  if (/^\[.+\]$/.test(host)) {
    const bare = host.slice(1, -1);
    return PRIVATE_IPV6_RE.test(bare);
  }
  // Common internal hostnames
  if (/^(localhost|localhost\..+)$/i.test(host)) return true;
  // Unknown — resolve via DNS and check the IP
  return new Promise((resolve) => {
    dns.lookup(host, (err, addr) => {
      if (err) return resolve(true); // treat DNS failures as blocked
      const v4 = PRIVATE_IPV4_RE.test(addr);
      const v6 = PRIVATE_IPV6_RE.test(addr);
      resolve(v4 || v6);
    });
  });
}

// Hop-by-hop headers that must not be forwarded (#9)
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers',
]);

export async function proxyLLM(req, res) {
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

  // Only allow HTTPS (or http for local dev on localhost)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === 'localhost')) {
    res.writeHead(403, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ error: 'Only HTTPS LLM endpoints are allowed (or http://localhost)' }));
    return;
  }

  // SSRF: block private/loopback IPs (#1)
  // Skip for localhost since the protocol check above already allows http://localhost for dev.
  const isLocalDev = base.protocol === 'http:' && base.hostname === 'localhost';
  if (!isLocalDev) {
    const blocked = await isPrivateHostname(base.hostname);
    if (blocked) {
      res.writeHead(403, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: `LLM base URL resolves to a private/reserved address: ${base.hostname}` }));
      return;
    }
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

  // Strip hop-by-hop headers and internal headers before forwarding (#9)
  const headers = {};
  for (const [key, val] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host' || lower === 'x-llm-base') continue;
    headers[key] = val;
  }

  const options = {
    hostname: base.hostname,
    port: base.port || (isHttps ? 443 : 80),
    path: targetPath,
    method: req.method,
    headers,
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    // Default statusCode to 502 if missing (#9)
    const statusCode = proxyRes.statusCode || 502;

    // Filter upstream response headers — strip hop-by-hop (#9)
    const respHeaders = {};
    for (const [key, val] of Object.entries(proxyRes.headers)) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders[key] = val;
    }
    Object.assign(respHeaders, CORS);

    res.writeHead(statusCode, respHeaders);
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
