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
// Os itens vêm propositalmente fora de ordem no JSON: a ordem da playlist
// é dada pelo index do watchEndpoint, que o resolver deve respeitar.
const fakePlaylistContext = (videoId, index) => ({
  commandContext: {
    onTap: {
      innertubeCommand: {
        watchEndpoint: {
          videoId,
          playlistId: 'PLgF5KLwzxU-17Fjn6-viXiHGnlrDgMixu',
          index,
        },
      },
    },
  },
});

const fakePlaylistPayload = {
  metadata: { playlistMetadataRenderer: { title: 'Playlist Fake' } },
  contents: [
    {
      lockupViewModel: {
        contentId: 'aWxBrI0g1kg',
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        rendererContext: fakePlaylistContext('aWxBrI0g1kg', 1),
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
    {
      lockupViewModel: {
        contentId: 'KAljnUezZFk',
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        rendererContext: fakePlaylistContext('KAljnUezZFk', 0),
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
      // lockup de shelf de recomendação (outra playlist): deve ser ignorado
      lockupViewModel: {
        contentId: 'zzzIGNOREDz',
        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
        rendererContext: {
          commandContext: {
            onTap: {
              innertubeCommand: {
                watchEndpoint: { videoId: 'zzzIGNOREDz', playlistId: 'RDOUTRA', index: 0 },
              },
            },
          },
        },
        metadata: { lockupMetadataViewModel: { title: { content: 'Recomendado' } } },
      },
    },
  ],
};

// Resposta fake do /next, usado pra resolver mixes (list=RD...).
// Também fora de ordem no JSON, com a ordem real no index do watchEndpoint.
const fakeMixPayload = {
  contents: {
    twoColumnWatchNextResults: {
      playlist: {
        playlist: {
          title: 'Mix Fake',
          contents: [
            {
              playlistPanelVideoRenderer: {
                videoId: 'eVTXPUF4Oz4',
                navigationEndpoint: { watchEndpoint: { videoId: 'eVTXPUF4Oz4', index: 1 } },
                title: { simpleText: 'In The End' },
                shortBylineText: { runs: [{ text: 'Linkin Park' }] },
                lengthText: { simpleText: '3:36' },
              },
            },
            {
              playlistPanelVideoRenderer: {
                videoId: '7NK_JOkuSVY',
                navigationEndpoint: { watchEndpoint: { videoId: '7NK_JOkuSVY', index: 0 } },
                title: { simpleText: 'Lost' },
                shortBylineText: { runs: [{ text: 'Linkin Park' }] },
                lengthText: { simpleText: '3:19' },
              },
            },
          ],
        },
      },
    },
  },
};

// Páginas fake de embed do Spotify, com o __NEXT_DATA__ que o resolver lê.
const spotifyEmbedHtml = (nextData) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;

const fakeSpotifyPlaylistHtml = spotifyEmbedHtml({
  props: {
    pageProps: {
      state: {
        data: {
          entity: {
            title: 'Playlist Spotify Fake',
            trackList: [
              { title: 'stupid song', subtitle: 'Olivia Rodrigo' },
              { title: 'Nightmare', subtitle: 'Avenged Sevenfold, Convidado Qualquer' },
            ],
          },
        },
      },
    },
  },
});

const fakeSpotifyTrackHtml = spotifyEmbedHtml({
  props: {
    pageProps: {
      state: {
        data: {
          entity: {
            title: 'Bat Country',
            artists: [{ name: 'Avenged Sevenfold' }],
          },
        },
      },
    },
  },
});

// Intercepta só as chamadas externas (YouTube e Spotify, pelo hostname, pra não
// engolir requests ao servidor local que carregam essas URLs no query string).
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
    if (url.hostname.endsWith('spotify.com')) {
      const html = url.pathname.includes('/track/')
        ? fakeSpotifyTrackHtml
        : fakeSpotifyPlaylistHtml;
      return Promise.resolve({ ok: true, text: async () => html });
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

const SPOTIFY_PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

test('URL de playlist do Spotify resolve os nomes com type spotify', async (t) => {
  mockInnerTube(t);
  const res = await search(SPOTIFY_PLAYLIST_URL, 'cliente-spotify');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'spotify');
  assert.equal(body.response.kind, 'playlist');
  assert.equal(body.response.id, '37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(body.response.title, 'Playlist Spotify Fake');
  assert.deepEqual(body.response.tracks, [
    'Olivia Rodrigo stupid song',
    'Avenged Sevenfold Nightmare',
  ]);
});

test('URL de track do Spotify resolve um único nome', async (t) => {
  mockInnerTube(t);
  const res = await search(
    'https://open.spotify.com/intl-pt/track/5dRQUolXAVX3BbCiIxmSsf?si=abc123',
    'cliente-spotify-track',
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'spotify');
  assert.equal(body.response.kind, 'track');
  assert.deepEqual(body.response.tracks, ['Avenged Sevenfold Bat Country']);
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

test('integração: resolve a playlist real do Spotify', async () => {
  const res = await search(SPOTIFY_PLAYLIST_URL, 'cliente-spotify-integracao');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'spotify');
  assert.equal(body.response.kind, 'playlist');
  assert.ok(body.response.title.length > 0, 'esperava o título da playlist');
  assert.ok(body.response.tracks.length > 0, 'esperava ao menos uma faixa');
  for (const term of body.response.tracks) {
    assert.equal(typeof term, 'string');
    assert.ok(term.trim().length > 0);
  }
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

test('/audio sem parâmetro v responde 400 com type error', async () => {
  const res = await fetch(`${baseUrl}/audio`, { headers: { 'X-Client-Id': 'audio-sem-v' } });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.type, 'error');
});

test('/audio com v inválido responde 400 com type error', async () => {
  const res = await fetch(`${baseUrl}/audio?v=naoehumid`, { headers: { 'X-Client-Id': 'audio-id-ruim' } });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.type, 'error');
});

const AUDIO_VIDEO_ID = 'jNQXAC9IVRw'; // "Me at the zoo", primeiro vídeo do YouTube (~19s)

test('integração: /audio entrega o m4a do vídeo', async () => {
  const res = await fetch(`${baseUrl}/audio?v=${AUDIO_VIDEO_ID}`, {
    headers: { 'X-Client-Id': 'audio-integracao' },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^audio\/mp4/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 50_000, `esperava um m4a com conteúdo, veio com ${buf.length} bytes`);
  // Assinatura de container ISO/MP4: bytes 4-8 são "ftyp".
  assert.equal(buf.subarray(4, 8).toString(), 'ftyp');
});

test('integração: /audio aceita URL do YouTube colada em v', async () => {
  const res = await fetch(
    `${baseUrl}/audio?v=${encodeURIComponent(`https://www.youtube.com/watch?v=${AUDIO_VIDEO_ID}`)}`,
    { headers: { 'X-Client-Id': 'audio-url-colada' } },
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^audio\/mp4/);
});

test('integração: /audio anuncia Accept-Ranges e responde 206 a um Range', async () => {
  const res = await fetch(`${baseUrl}/audio?v=${AUDIO_VIDEO_ID}`, {
    headers: { 'X-Client-Id': 'audio-range', Range: 'bytes=0-99999' },
  });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  const total = Number(res.headers.get('content-range').match(/\/(\d+)$/)[1]);
  assert.equal(res.headers.get('content-range'), `bytes 0-99999/${total}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, 100000);
});

test('integração: /audio responde 416 a um Range fora do arquivo', async () => {
  const res = await fetch(`${baseUrl}/audio?v=${AUDIO_VIDEO_ID}`, {
    headers: { 'X-Client-Id': 'audio-range-416', Range: 'bytes=999999999-' },
  });
  assert.equal(res.status, 416);
  assert.match(res.headers.get('content-range'), /^bytes \*\/\d+$/);
});
