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

// Intercepta só as chamadas pro YouTube; o fetch que os testes usam
// pra falar com o servidor local continua real (mesmo processo).
function mockInnerTube(t) {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('youtube.com')) {
      return Promise.resolve({ ok: true, json: async () => fakePayload });
    }
    return realFetch(input, init);
  });
}

function search(query, clientId) {
  return fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}`, {
    headers: { 'X-Client-Id': clientId },
  });
}

test('rota desconhecida responde 404', async () => {
  const res = await fetch(`${baseUrl}/outra-rota`);
  assert.equal(res.status, 404);
});

test('busca sem q responde 400', async () => {
  const res = await fetch(`${baseUrl}/search`);
  assert.equal(res.status, 400);
});

test('busca retorna os resultados da InnerTube', async (t) => {
  mockInnerTube(t);
  const res = await search('musica qualquer', 'cliente-busca');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.query, 'musica qualquer');
  assert.deepEqual(body.results, [
    {
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Vídeo Fake',
      channel: 'Canal Fake',
      duration: '3:33',
    },
  ]);
});

test('mesmo cliente 2x em menos de 1s recebe 419', async (t) => {
  mockInnerTube(t);
  const primeira = await search('a', 'cliente-419');
  const segunda = await search('b', 'cliente-419');
  assert.equal(primeira.status, 200);
  assert.equal(segunda.status, 419);
  const body = await segunda.json();
  assert.ok(body.retryAfterMs > 0 && body.retryAfterMs <= 1000);
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
  assert.ok(body.results.length > 0, 'esperava ao menos um resultado real');
  for (const r of body.results) {
    assert.match(r.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(r.url, `https://www.youtube.com/watch?v=${r.videoId}`);
    assert.ok(r.title.length > 0);
  }
});
