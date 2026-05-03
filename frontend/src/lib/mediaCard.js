/** Helpers for rendering answer artifact cards.
 *
 *  - Search jump URLs (网易云 / 豆瓣)
 *  - Cover fetch via backend /api/media/cover for songs / movies.
 *  - Weather and scent are local semantic cards; they never hit external APIs.
 */

export const MEDIA_LABELS = {
  song: '歌曲',
  movie: '电影',
  book: '书籍',
  weather: '天气',
  scent: '气味',
};

export function buildSearchUrl(kind, title, subtitle) {
  const q = (subtitle ? `${title} ${subtitle}` : title).trim();
  const enc = encodeURIComponent(q);
  if (kind === 'song') {
    return {
      url: `https://music.163.com/#/search/m/?s=${enc}&type=1`,
      label: '网易云搜索',
    };
  }
  if (kind === 'movie') {
    return {
      url: `https://search.douban.com/movie/subject_search?search_text=${enc}`,
      label: '豆瓣搜索',
    };
  }
  if (kind === 'book') {
    return {
      url: `https://search.douban.com/book/subject_search?search_text=${enc}`,
      label: '豆瓣搜索',
    };
  }
  return { url: '', label: '' };
}

const coverCache = new Map();

/** Fetch a media cover (url + dominant colors + optional year) from the backend.
 *  Supports ``kind`` ∈ { song, movie }. Other card kinds fall back locally.
 *  Returns null on any failure so the caller can render the icon-only fallback.
 *  Memoised across the session so repeated mentions don't re-hit the backend. */
export async function fetchMediaCover(kind, title, subtitle) {
  if (kind !== 'song' && kind !== 'movie') return null;
  const q = `${kind}|${title}|${subtitle || ''}`;
  if (coverCache.has(q)) return coverCache.get(q);

  const params = new URLSearchParams({
    type: kind,
    title,
    ...(subtitle ? { artist: subtitle } : {}),
  });
  const promise = (async () => {
    try {
      const r = await fetch(`/api/media/cover?${params.toString()}`, { credentials: 'include' });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data || !data.url) return null;
      return data;
    } catch {
      return null;
    }
  })();
  coverCache.set(q, promise);
  return promise;
}
