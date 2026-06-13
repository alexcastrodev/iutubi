import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { PlaylistResolver } from './playlist-resolver.js';
import { SpotifyResolver } from './spotify-resolver.js';
import { SearchResolver } from './search-resolver.js';
import { openAudioStream, streamToIterable } from './youtube-audio.js';

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

// Aceita tanto o videoId cru (11 chars) quanto uma URL do YouTube colada.
function extractVideoId(value) {
  if (!value) return undefined;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  const fromUrl = value.match(/[?&]v=([A-Za-z0-9_-]{11})/) ?? value.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return fromUrl?.[1];
}

export async function handleAudio(req, res, url) {
  const videoId = extractVideoId(url.searchParams.get('v')?.trim());
  if (!videoId) {
    return sendJson(res, 400, 'error', { error: 'Parâmetro v (videoId ou URL do YouTube) é obrigatório' });
  }

  if (!rateLimitClient(req, res)) return;
  await waitTurn();

  let audio;
  try {
    audio = await openAudioStream(videoId);
  } catch (err) {
    return sendJson(res, 502, 'error', { error: err.message });
  }

  res.writeHead(200, {
    'Content-Type': audio.mimeType,
    ...(audio.contentLength ? { 'Content-Length': audio.contentLength } : {}),
    'Content-Disposition': `inline; filename="${audio.title.replace(/[^\w.-]+/g, '_')}.m4a"`,
  });

  try {
    for await (const chunk of streamToIterable(audio.stream)) {
      if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
    }
    res.end();
  } catch (err) {
    // Cabeçalho já foi enviado; só dá pra abortar a conexão.
    res.destroy(err);
  }
}

export function createApp() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/search') {
      return handleSearch(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/audio') {
      return handleAudio(req, res, url);
    }
    return sendJson(res, 404, 'error', {
      error: 'Use GET /search?q=<busca ou url> ou GET /audio?v=<videoId ou url>',
    });
  });
}

// Vercel implanta este módulo como servidor (/var/task/server.mjs) e exige que
// o default export seja uma função ou um http.Server.
const app = createApp();
export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`InnerTube demo ouvindo em http://localhost:${PORT}/search?q=...`);
  });
}
