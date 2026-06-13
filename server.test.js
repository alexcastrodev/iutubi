import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from './server.js';

let app;
let baseUrl;

before(async () => {
  app = createApp();
  await new Promise((resolve) => app.listen(0, resolve));
  baseUrl = `http://localhost:${app.address().port}`;
});

after(() => app.close());

// Resposta fake da InnerTube com um videoRenderer, pros testes que não precisam de rede.
const fakePayload = {
  contents: [
    {
      videoRenderer: {
        videoId: 'dQw4w9WgXcQ',
        title: { runs: [{ text: 'Vídeo Fake' }] },
        ownerText: { runs: [{ text: 'Canal Fake' }] },
        lengthText: { simpleText: '3:33' },
      },
    },
  ],
};

// Resposta fake do /browse de playlist no formato novo (lockupViewModel).
const fakePlaylistPayload = {
  metadata: { playlistMetadataRenderer: { title: 'Playlist Fake' } },
  contents: [
    {
      lockupViewModel: {
        contentId: 'KAljnUezZFk',
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        contentImage: {
          thumbnailViewModel: {
            overlays: [
              {
                thumbnailOverlayBadgeViewModel: {
                  thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '6:15' } }],
                },
              },
            ],
          },
        },
        metadata: {
          lockupMetadataViewModel: {
            title: { content: 'Nightmare' },
            metadata: {
              contentMetadataViewModel: {
                metadataRows: [
                  { metadataParts: [{ text: { content: 'Avenged Sevenfold' } }] },
                ],
              },
            },
          },
        },
      },
    },
    {
      lockupViewModel: {
        contentId: 'aWxBrI0g1kg',
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        metadata: {
          lockupMetadataViewModel: {
            title: { content: 'Hail to the King' },
            metadata: {
              contentMetadataViewModel: {
                metadataRows: [
                  { metadataParts: [{ text: { content: 'Avenged Sevenfold' } }] },
                ],
              },
            },
          },
        },
      },
    },
  ],
};

// Resposta fake do /next, usado pra resolver mixes (list=RD...).
const fakeMixPayload = {
  contents: {
    twoColumnWatchNextResults: {
      playlist: {
        playlist: {
          title: 'Mix Fake',
          contents: [
            {
              playlistPanelVideoRenderer: {
                videoId: '7NK_JOkuSVY',
                title: { simpleText: 'Lost' },
                shortBylineText: { runs: [{ text: 'Linkin Park' }] },
                lengthText: { simpleText: '3:19' },
              },
            },
            {
              playlistPanelVideoRenderer: {
                videoId: 'eVTXPUF4Oz4',
                title: { simpleText: 'In The End' },
                shortBylineText: { runs: [{ text: 'Linkin Park' }] },
                lengthText: { simpleText: '3:36' },
              },
            },
          ],
        },
      },
    },
  },
};

// Intercepta só as chamadas pro YouTube (pelo hostname, pra não engolir
// requests ao servidor local que carregam "youtube.com" no query string).
function mockInnerTube(t) {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname.endsWith('youtube.com')) {
      const payload = url.pathname.includes('/browse')
        ? fakePlaylistPayload
        : url.pathname.includes('/next')
          ? fakeMixPayload
          : fakePayload;
      return Promise.resolve({ ok: true, json: async () => payload });
    }
    return realFetch(input, init);
  });
}

const PLAYLIST_URL =
  'https://www.youtube.com/watch?v=KAljnUezZFk&list=PLgF5KLwzxU-17Fjn6-viXiHGnlrDgMixu';

function search(query, clientId) {
  return fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}`, {
    headers: { 'X-Client-Id': clientId },
  });
}

test('rota desconhecida responde 404 com type error', async () => {
  const res = await fetch(`${baseUrl}/outra-rota`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.type, 'error');
  assert.ok(body.response.error);
});

test('busca sem q responde 400 com type error', async () => {
  const res = await fetch(`${baseUrl}/search`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.type, 'error');
});

test('texto de busca resolve com type search', async (t) => {
  mockInnerTube(t);
  const res = await search('musica qualquer', 'cliente-busca');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'search');
  assert.equal(body.response.query, 'musica qualquer');
  assert.deepEqual(body.response.results, [
    {
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Vídeo Fake',
      channel: 'Canal Fake',
      duration: '3:33',
    },
  ]);
});

test('URL com list resolve a playlist com type playlist', async (t) => {
  mockInnerTube(t);
  const res = await search(PLAYLIST_URL, 'cliente-playlist');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'playlist');
  assert.equal(body.response.playlistId, 'PLgF5KLwzxU-17Fjn6-viXiHGnlrDgMixu');
  assert.equal(body.response.title, 'Playlist Fake');
  assert.deepEqual(body.response.videos, [
    {
      videoId: 'KAljnUezZFk',
      url: 'https://www.youtube.com/watch?v=KAljnUezZFk',
      title: 'Nightmare',
      channel: 'Avenged Sevenfold',
      duration: '6:15',
    },
    {
      videoId: 'aWxBrI0g1kg',
      url: 'https://www.youtube.com/watch?v=aWxBrI0g1kg',
      title: 'Hail to the King',
      channel: 'Avenged Sevenfold',
      duration: '',
    },
  ]);
});

test('URL de playlist colada sem encodar também resolve a playlist', async (t) => {
  mockInnerTube(t);
  // sem encodeURIComponent: o &list= viraria parâmetro do nosso endpoint
  const res = await fetch(`${baseUrl}/search?q=${PLAYLIST_URL}`, {
    headers: { 'X-Client-Id': 'cliente-sem-encode' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'playlist');
  assert.equal(body.response.playlistId, 'PLgF5KLwzxU-17Fjn6-viXiHGnlrDgMixu');
});

const MIX_URL =
  'https://www.youtube.com/watch?v=7NK_JOkuSVY&list=RDEMww6ZEHgLhQ-8eu_x7Z-FJw';

test('URL de mix (list=RD...) resolve via /next', async (t) => {
  mockInnerTube(t);
  const res = await search(MIX_URL, 'cliente-mix');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'playlist');
  assert.equal(body.response.playlistId, 'RDEMww6ZEHgLhQ-8eu_x7Z-FJw');
  assert.equal(body.response.title, 'Mix Fake');
  assert.deepEqual(body.response.videos, [
    {
      videoId: '7NK_JOkuSVY',
      url: 'https://www.youtube.com/watch?v=7NK_JOkuSVY',
      title: 'Lost',
      channel: 'Linkin Park',
      duration: '3:19',
    },
    {
      videoId: 'eVTXPUF4Oz4',
      url: 'https://www.youtube.com/watch?v=eVTXPUF4Oz4',
      title: 'In The End',
      channel: 'Linkin Park',
      duration: '3:36',
    },
  ]);
});

test('URL sem parâmetro list cai na busca comum', async (t) => {
  mockInnerTube(t);
  const res = await search('https://www.youtube.com/watch?v=KAljnUezZFk', 'cliente-sem-list');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'search');
});

test('mesmo cliente 2x em menos de 1s recebe 419', async (t) => {
  mockInnerTube(t);
  const primeira = await search('a', 'cliente-419');
  const segunda = await search('b', 'cliente-419');
  assert.equal(primeira.status, 200);
  assert.equal(segunda.status, 419);
  const body = await segunda.json();
  assert.equal(body.type, 'error');
  assert.ok(body.response.retryAfterMs > 0 && body.response.retryAfterMs <= 1000);
});

test('clientes diferentes na mesma janela de 1s passam', async (t) => {
  mockInnerTube(t);
  const [resA, resB] = await Promise.all([
    search('a', 'cliente-a'),
    search('a', 'cliente-b'),
  ]);
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
});

test('mesmo cliente passa de novo após 1s', async (t) => {
  mockInnerTube(t);
  const primeira = await search('a', 'cliente-reset');
  await delay(1100);
  const segunda = await search('b', 'cliente-reset');
  assert.equal(primeira.status, 200);
  assert.equal(segunda.status, 200);
});

test('fila global resolve no máximo 5 buscas por segundo', async (t) => {
  mockInnerTube(t);
  const inicio = Date.now();
  const tempos = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const res = await search('burst', `cliente-burst-${i}`);
      assert.equal(res.status, 200);
      return Date.now() - inicio;
    }),
  );
  const noPrimeiroSegundo = tempos.filter((t) => t < 1000).length;
  assert.ok(
    noPrimeiroSegundo <= 5,
    `${noPrimeiroSegundo} buscas resolvidas no primeiro segundo (máximo 5)`,
  );
  const total = Math.max(...tempos);
  assert.ok(total >= 1500, `10 buscas a 5/s deveriam levar ~2s, levaram ${total}ms`);
});

test('integração: busca real na InnerTube', async () => {
  const res = await search('avenged sevenfold death', 'cliente-integracao');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'search');
  assert.ok(body.response.results.length > 0, 'esperava ao menos um resultado real');
  for (const r of body.response.results) {
    assert.match(r.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(r.url, `https://www.youtube.com/watch?v=${r.videoId}`);
    assert.ok(r.title.length > 0);
  }
});

test('integração: resolve o mix real via /next', async () => {
  const res = await search(MIX_URL, 'cliente-mix-integracao');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'playlist');
  assert.equal(body.response.playlistId, 'RDEMww6ZEHgLhQ-8eu_x7Z-FJw');
  assert.ok(body.response.videos.length > 0, 'esperava ao menos um vídeo no mix');
  for (const v of body.response.videos) {
    assert.match(v.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.ok(v.title.length > 0);
  }
  assert.ok(
    body.response.videos.some((v) => v.videoId === '7NK_JOkuSVY'),
    'esperava encontrar o vídeo semente (7NK_JOkuSVY) no mix',
  );
});

test('integração: resolve a playlist real', async () => {
  const res = await search(PLAYLIST_URL, 'cliente-playlist-integracao');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'playlist');
  assert.equal(body.response.playlistId, 'PLgF5KLwzxU-17Fjn6-viXiHGnlrDgMixu');
  assert.ok(body.response.videos.length > 0, 'esperava ao menos um vídeo na playlist');
  for (const v of body.response.videos) {
    assert.match(v.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(v.url, `https://www.youtube.com/watch?v=${v.videoId}`);
    assert.ok(v.title.length > 0);
  }
  assert.ok(
    body.response.videos.some((v) => v.videoId === 'KAljnUezZFk'),
    'esperava encontrar o vídeo da URL (KAljnUezZFk) na playlist',
  );
});
