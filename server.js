import http from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT ?? 3333);
const GLOBAL_RATE = 5;
const CLIENT_WINDOW_MS = 1000;

const queue = [];
setInterval(() => {
  const next = queue.shift();
  if (next) next();
}, 1000 / GLOBAL_RATE).unref();

const waitTurn = () => new Promise((resolve) => queue.push(resolve));

const lastHitByClient = new Map();

setInterval(() => {
  const cutoff = Date.now() - CLIENT_WINDOW_MS;
  for (const [client, ts] of lastHitByClient) {
    if (ts < cutoff) lastHitByClient.delete(client);
  }
}, 10_000).unref();

export async function searchInnerTube(query, limit = 5) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00' } },
      query,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`InnerTube respondeu HTTP ${res.status}`);
  const data = await res.json();

  const results = [];
  (function walk(node) {
    if (results.length >= limit || node === null || typeof node !== 'object') return;
    if (!Array.isArray(node) && node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      results.push({
        videoId: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: v.title?.runs?.map((r) => r.text).join('') ?? '',
        channel: v.ownerText?.runs?.[0]?.text ?? '',
        duration: v.lengthText?.simpleText ?? '',
      });
      return;
    }
    for (const child of Object.values(node)) walk(child);
  })(data);
  return results;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

export async function handleSearch(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = url.searchParams.get('q')?.trim();
  if (!query) {
    return sendJson(res, 400, { error: 'Parâmetro q é obrigatório' });
  }

  const client =
    req.headers['x-client-id'] ??
    req.headers['x-forwarded-for']?.split(',')[0].trim() ??
    req.socket.remoteAddress;
  const now = Date.now();
  const lastHit = lastHitByClient.get(client) ?? 0;
  if (now - lastHit < CLIENT_WINDOW_MS) {
    return sendJson(res, 419, {
      error: `Mesmo cliente bateu 2x em menos de ${CLIENT_WINDOW_MS}ms`,
      client,
      retryAfterMs: CLIENT_WINDOW_MS - (now - lastHit),
    });
  }
  lastHitByClient.set(client, now);

  await waitTurn();

  try {
    const results = await searchInnerTube(query);
    sendJson(res, 200, { query, results });
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

export function createApp() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== 'GET' || url.pathname !== '/search') {
      return sendJson(res, 404, { error: 'Use GET /search?q=<busca>' });
    }
    return handleSearch(req, res);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(PORT, () => {
    console.log(`InnerTube demo ouvindo em http://localhost:${PORT}/search?q=...`);
  });
}
