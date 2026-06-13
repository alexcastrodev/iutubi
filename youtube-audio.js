import vm from 'node:vm';
import { Innertube, Platform, Utils } from 'youtubei.js';
import { BG } from 'bgutils-js';
import { Window } from 'happy-dom';

// O YouTube cifra as URLs de stream e estrangula o download a ~0,04 MB/s para
// quem não apresenta um PoToken (atestação BotGuard). Com ele, o client IOS
// devolve URLs diretas e o download vai a full speed. Aqui montamos esse cliente.

// youtubei.js (>=v17) não traz um avaliador de JS embutido por questões de
// segurança nas plataformas que não têm sandbox; no Node usamos a vm nativa.
Platform.shim.eval = (data) =>
  vm.runInNewContext(`(() => { ${data.output} })()`, {}, { timeout: 5000 });

// Chave pública do app web do YouTube usada pelo BotGuard. É um valor fixo e
// público (o mesmo que o player carrega no browser), não um segredo.
const BG_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

// O PoToken é caro de gerar (roda o BotGuard) e vale para a sessão inteira,
// então geramos uma vez e reaproveitamos. Recriamos sob demanda se falhar.
let clientPromise;

async function buildClient() {
  // Sessão temporária só para obter o visitorData, que identifica a sessão e
  // amarra o PoToken a ela.
  const seed = await Innertube.create({ retrieve_player: false });
  const visitorData = seed.session.context.client.visitorData;

  // O BotGuard espera um ambiente de browser; happy-dom faz o papel de DOM
  // falso (mais leve que jsdom e ESM puro, evitando o erro de require() de ESM
  // ao rodar em serverless). O interpretador roda em escopo global e procura
  // por `window`/`document`, então os expomos no globalThis durante a geração.
  const win = new Window({ url: 'https://www.youtube.com/' });
  globalThis.window = win;
  globalThis.document = win.document;
  const globalObj = globalThis;

  const bgConfig = { fetch, globalObj, identifier: visitorData, requestKey: BG_REQUEST_KEY };
  const challenge = await BG.Challenge.create(bgConfig);
  if (!challenge) throw new Error('BotGuard não devolveu challenge');

  // Executa o interpretador do BotGuard, que injeta no escopo global a função
  // usada para gerar o PoToken.
  const interpreter =
    challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (interpreter) new Function(interpreter)();

  const { poToken } = await BG.PoToken.generate({
    program: challenge.program,
    globalName: challenge.globalName,
    bgConfig,
  });

  return Innertube.create({ retrieve_player: true, po_token: poToken, visitor_data: visitorData });
}

function getClient() {
  if (!clientPromise) {
    clientPromise = buildClient().catch((err) => {
      clientPromise = undefined; // permite nova tentativa no próximo request
      throw err;
    });
  }
  return clientPromise;
}

// Lê os metadados do melhor formato de áudio (m4a/AAC) sem baixar nada.
// Precede openAudioStream para que o servidor saiba o tamanho total antes de
// decidir o intervalo de um header Range.
export async function getAudioMeta(videoId) {
  const yt = await getClient();
  const info = await yt.getBasicInfo(videoId, { client: 'IOS' });
  const format = info.chooseFormat({ type: 'audio', quality: 'best' });
  return {
    totalLength: Number(format.content_length) || undefined,
    mimeType: format.mime_type ?? 'audio/mp4',
    title: info.basic_info.title ?? videoId,
  };
}

// Abre o ReadableStream de áudio já decifrado. Com `range` ({ start, end }) o
// youtubei.js baixa só aquele intervalo de bytes — usado para responder a
// requisições com header Range (seek no player).
export async function openAudioStream(videoId, range) {
  const yt = await getClient();
  return yt.download(videoId, {
    type: 'audio',
    quality: 'best',
    client: 'IOS',
    ...(range ? { range } : {}),
  });
}

export const streamToIterable = Utils.streamToIterable;
