import { Resolver } from './resolver.js';
import { innerTube } from './innertube.js';

function findDuration(node) {
  if (node === null || typeof node !== 'object') return '';
  const text = node.thumbnailBadgeViewModel?.text;
  if (typeof text === 'string' && /^\d+:\d{2}/.test(text)) return text;
  for (const child of Object.values(node)) {
    const found = findDuration(child);
    if (found) return found;
  }
  return '';
}

export class PlaylistResolver extends Resolver {
  type = 'playlist';

  matches(input) {
    return this.playlistId(input) !== null;
  }

  playlistId(input) {
    try {
      return new URL(input).searchParams.get('list');
    } catch {
      return null;
    }
  }

  async resolve(input, limit = 100) {
    const playlistId = this.playlistId(input);
    return playlistId.startsWith('RD')
      ? this.resolveMix(input, playlistId, limit)
      : this.resolveBrowse(playlistId, limit);
  }

  // Mixes (list=RD...) não são navegáveis pelo /browse ("This playlist type is
  // unviewable"); o player os resolve pelo /next com o vídeo semente.
  async resolveMix(input, playlistId, limit) {
    const videoId = new URL(input).searchParams.get('v') ?? undefined;
    const data = await innerTube('next', { videoId, playlistId });

    let title = '';
    const videos = [];
    (function walk(node) {
      if (videos.length >= limit || node === null || typeof node !== 'object') return;
      if (!Array.isArray(node)) {
        if (node.playlist?.playlist?.title) {
          title = node.playlist.playlist.title;
        }
        const v = node.playlistPanelVideoRenderer;
        if (v?.videoId) {
          videos.push({
            videoId: v.videoId,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            title: v.title?.simpleText ?? '',
            channel: v.shortBylineText?.runs?.[0]?.text ?? '',
            duration: v.lengthText?.simpleText ?? '',
          });
          return;
        }
      }
      for (const child of Object.values(node)) walk(child);
    })(data);
    return { playlistId, title, videos };
  }

  async resolveBrowse(playlistId, limit) {
    const data = await innerTube('browse', { browseId: `VL${playlistId}` });

    let title = '';
    const videos = [];
    (function walk(node) {
      if (videos.length >= limit || node === null || typeof node !== 'object') return;
      if (!Array.isArray(node)) {
        if (node.playlistMetadataRenderer?.title) {
          title = node.playlistMetadataRenderer.title;
        }
        const lockup = node.lockupViewModel;
        if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && lockup.contentId) {
          const meta = lockup.metadata?.lockupMetadataViewModel;
          videos.push({
            videoId: lockup.contentId,
            url: `https://www.youtube.com/watch?v=${lockup.contentId}`,
            title: meta?.title?.content ?? '',
            channel:
              meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]
                ?.metadataParts?.[0]?.text?.content ?? '',
            duration: findDuration(lockup.contentImage),
          });
          return;
        }
      }
      for (const child of Object.values(node)) walk(child);
    })(data);
    return { playlistId, title, videos };
  }
}
