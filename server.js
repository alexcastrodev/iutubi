import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { PlaylistResolver } from './playlist-resolver.js';
import { SpotifyResolver } from './spotify-resolver.js';
import { SearchResolver } from './search-resolver.js';

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

const resolvers = [new PlaylistResolver(), new SpotifyResolver(), new SearchResolver()];

function sendJson(res, status, type, response) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ type, response }, null, 2));
}

function rateLimitClient(req, res) {
  const client =
    req.headers['x-client-id'] ??
    req.headers['x-forwarded-for']?.split(',')[0].trim() ??
    req.socket.remoteAddress;
  const now = Date.now();
  const lastHit = lastHitByClient.get(client) ?? 0;
  if (now - lastHit < CLIENT_WINDOW_MS) {
    sendJson(res, 419, 'error', {
      error: `Mesmo cliente bateu 2x em menos de ${CLIENT_WINDOW_MS}ms`,
      client,
      retryAfterMs: CLIENT_WINDOW_MS - (now - lastHit),
    });
    return false;
  }
  lastHitByClient.set(client, now);
  return true;
}

// q é sempre o último parâmetro da nossa API, então tudo depois de q= pertence
// a ele — inclusive &list=... de uma URL do YouTube colada sem encodar.
function extractQuery(reqUrl) {
  const match = reqUrl.match(/[?&]q=(.*)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

export async function handleSearch(req, res) {
  const query = extractQuery(req.url);
  if (!query) {
    return sendJson(res, 400, 'error', { error: 'Parâmetro q é obrigatório' });
  }

  if (!rateLimitClient(req, res)) return;
  await waitTurn();

  const resolver = resolvers.find((r) => r.matches(query));
  try {
    sendJson(res, 200, resolver.type, await resolver.resolve(query));
  } catch (err) {
    sendJson(res, 502, 'error', { error: err.message });
  }
}

export function createApp() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== 'GET' || url.pathname !== '/search') {
      return sendJson(res, 404, 'error', { error: 'Use GET /search?q=<busca ou url de playlist>' });
    }
    return handleSearch(req, res);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(PORT, () => {
    console.log(`InnerTube demo ouvindo em http://localhost:${PORT}/search?q=...`);
  });
}
