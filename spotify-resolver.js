import { Resolver } from './resolver.js';

// O Spotify usa DRM, então a reprodução vem do YouTube. Este resolver só extrai
// os METADADOS (título + artista) e devolve termos de busca ("artista nome").
//
// Tudo é lido da página de embed pública (open.spotify.com/embed/<tipo>/<id>),
// que traz a trackList completa no __NEXT_DATA__ sem token nem credenciais. A
// Web API oficial não serve aqui: desde nov/2024 apps em Development mode tomam
// 403 em GET /playlists/{id}/tracks, e o embed cobre os três tipos sem isso.

// open.spotify.com/<intl-xx/>(track|playlist|album)/<id>?si=...
const SPOTIFY_URL_RE =
  /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist|album)\/([A-Za-z0-9]+)/i;

const EMBED_BASE = 'https://open.spotify.com/embed';

// Busca recursiva por uma chave em objetos/arrays aninhados. O __NEXT_DATA__
// muda de shape entre versões do embed, então não fixamos o caminho.
function findKey(obj, key) {
  if (obj === null || typeof obj !== 'object') return null;
  if (!Array.isArray(obj) && key in obj) return obj[key];
  for (const child of Object.values(obj)) {
    const found = findKey(child, key);
    if (found !== null) return found;
  }
  return null;
}

// Termo "artista nome" a partir de um objeto do embed. null se sem título.
// O artista vem do subtitle (playlist/album, vários separados por vírgula —
// usa o primeiro) ou de artists[].name (track avulsa).
function searchTerm(track) {
  if (track === null || typeof track !== 'object') return null;
  const name = String(track.title ?? '').trim();
  if (!name) return null;

  let artist = String(track.subtitle ?? '').split(',')[0].trim();
  if (!artist) artist = String(track.artists?.[0]?.name ?? '').trim();

  return [artist, name].filter(Boolean).join(' ');
}

export class SpotifyResolver extends Resolver {
  type = 'spotify';

  matches(input) {
    return SPOTIFY_URL_RE.test(input);
  }

  async resolve(input, limit = 200) {
    const [, kind, id] = input.match(SPOTIFY_URL_RE);
    const data = await this.embedData(kind.toLowerCase(), id);

    const entity = findKey(data, 'entity');
    const list = findKey(data, 'trackList');
    const tracks =
      Array.isArray(list) && list.length > 0
        ? list.map(searchTerm).filter(Boolean).slice(0, limit)
        : [searchTerm(entity)].filter(Boolean);

    return {
      kind: kind.toLowerCase(),
      id,
      title: entity?.title ?? '',
      tracks,
    };
  }

  async embedData(kind, id) {
    const res = await fetch(`${EMBED_BASE}/${kind}/${id}`, {
      // o embed só serve o HTML com __NEXT_DATA__ pra User-Agent de browser
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Spotify embed respondeu HTTP ${res.status}`);
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!match) throw new Error('Spotify embed veio sem __NEXT_DATA__');
    return JSON.parse(match[1]);
  }
}
