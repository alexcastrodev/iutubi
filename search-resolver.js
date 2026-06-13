import { Resolver } from './resolver.js';
import { innerTube } from './innertube.js';

export class SearchResolver extends Resolver {
  type = 'search';

  matches() {
    return true;
  }

  async resolve(query, limit = 5) {
    const data = await innerTube('search', { query });

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
    return { query, results };
  }
}
