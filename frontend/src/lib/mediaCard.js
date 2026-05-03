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

export const ATMOSPHERE_ASSETS = {
  weather: [
    {
      id: 'first-snow',
      src: '/static/card-atmospheres/weather/first-snow.jpg',
      keywords: ['初雪', '雪', '下雪', '新雪', '薄雪', '冷白'],
    },
    {
      id: 'morning-fog',
      src: '/static/card-atmospheres/weather/morning-fog.jpg',
      keywords: ['雾', '晨雾', '大雾', '雾气', '迷雾', '朦胧'],
    },
    {
      id: 'partly-cloudy',
      src: '/static/card-atmospheres/weather/partly-cloudy.jpg',
      keywords: ['晴间多云', '多云', '云影', '半晴', '晴云'],
    },
    {
      id: 'typhoon-eve',
      src: '/static/card-atmospheres/weather/typhoon-eve.jpg',
      keywords: ['台风', '风暴', '暴风', '大风', '风雨', '前夜'],
    },
    {
      id: 'plum-rain',
      src: '/static/card-atmospheres/weather/plum-rain.jpg',
      keywords: ['梅雨', '连雨', '潮湿', '湿润', '阴雨', '雨季'],
    },
    {
      id: 'sunset-glow',
      src: '/static/card-atmospheres/weather/sunset-glow.jpg',
      keywords: ['夕照', '晚霞', '落日', '日落', '黄昏', '余晖'],
    },
    {
      id: 'after-rain',
      src: '/static/card-atmospheres/weather/after-rain.jpg',
      keywords: ['雨后', '放晴', '初霁', '新晴', '积水', '水洼'],
    },
    {
      id: 'dry-wind',
      src: '/static/card-atmospheres/weather/dry-wind.jpg',
      keywords: ['干风', '风干', '干燥', '秋风', '风起'],
    },
    {
      id: 'humid-night',
      src: '/static/card-atmospheres/weather/humid-night.jpg',
      keywords: ['湿夜', '潮夜', '闷热', '夜雨', '水汽', '回南天'],
    },
    {
      id: 'clear-cold',
      src: '/static/card-atmospheres/weather/clear-cold.jpg',
      keywords: ['晴冷', '冷晴', '清冷', '冷空气', '霜', '冷冽'],
    },
    {
      id: 'spring-shower',
      src: '/static/card-atmospheres/weather/spring-shower.jpg',
      keywords: ['春雨', '小雨', '阵雨', '细雨', '雨滴'],
    },
    {
      id: 'summer-heat',
      src: '/static/card-atmospheres/weather/summer-heat.jpg',
      keywords: ['盛夏', '热浪', '炎热', '高温', '暑气', '夏日'],
    },
    {
      id: 'autumn-cloud',
      src: '/static/card-atmospheres/weather/autumn-cloud.jpg',
      keywords: ['秋云', '阴云', '云层', '秋天', '秋日'],
    },
    {
      id: 'winter-sun',
      src: '/static/card-atmospheres/weather/winter-sun.jpg',
      keywords: ['冬阳', '冬日', '暖阳', '阳光', '日光', '晴天'],
    },
    {
      id: 'distant-thunder',
      src: '/static/card-atmospheres/weather/distant-thunder.jpg',
      keywords: ['雷', '雷雨', '远雷', '闷雷', '乌云', '暴雨'],
    },
  ],
  scent: [
    {
      id: 'cold-tea',
      src: '/static/card-atmospheres/scent/cold-tea.jpg',
      keywords: ['冷茶', '清茶', '绿茶', '凉茶', '冷泡茶'],
    },
    {
      id: 'white-flower',
      src: '/static/card-atmospheres/scent/white-flower.jpg',
      keywords: ['白花', '栀子', '茉莉', '花香', '白色花'],
    },
    {
      id: 'sandalwood',
      src: '/static/card-atmospheres/scent/sandalwood.jpg',
      keywords: ['檀木', '檀香', '木质', '木香', '沉木'],
    },
    {
      id: 'rain-stone',
      src: '/static/card-atmospheres/scent/rain-stone.jpg',
      keywords: ['雨后石板', '石板', '石头', '矿物', '雨后', '湿石'],
    },
    {
      id: 'citrus-peel',
      src: '/static/card-atmospheres/scent/citrus-peel.jpg',
      keywords: ['柑橘皮', '柑橘', '橘皮', '橙皮', '佛手柑', '青柠'],
    },
    {
      id: 'incense',
      src: '/static/card-atmospheres/scent/incense.jpg',
      keywords: ['焚香', '香火', '线香', '烟', '烟感', '香灰'],
    },
    {
      id: 'fig-leaf',
      src: '/static/card-atmospheres/scent/fig-leaf.jpg',
      keywords: ['无花果', ' fig', '绿叶', '叶香', '奶绿'],
    },
    {
      id: 'iris-powder',
      src: '/static/card-atmospheres/scent/iris-powder.jpg',
      keywords: ['鸢尾', '粉感', '脂粉', '紫罗兰', '粉质'],
    },
    {
      id: 'sea-salt',
      src: '/static/card-atmospheres/scent/sea-salt.jpg',
      keywords: ['海盐', '盐', '海风', '海水', '咸'],
    },
    {
      id: 'black-tea',
      src: '/static/card-atmospheres/scent/black-tea.jpg',
      keywords: ['红茶', '黑茶', '茶汤', '深茶', '琥珀茶'],
    },
    {
      id: 'cedar-closet',
      src: '/static/card-atmospheres/scent/cedar-closet.jpg',
      keywords: ['雪松', '衣柜', '棉布', '干净衣物', '木柜'],
    },
    {
      id: 'rose-pepper',
      src: '/static/card-atmospheres/scent/rose-pepper.jpg',
      keywords: ['玫瑰', '胡椒', '粉红胡椒', '辛香', '花椒'],
    },
    {
      id: 'mint-rain',
      src: '/static/card-atmospheres/scent/mint-rain.jpg',
      keywords: ['薄荷', '雨水', '清凉', '凉感', '绿感'],
    },
    {
      id: 'amber-skin',
      src: '/static/card-atmospheres/scent/amber-skin.jpg',
      keywords: ['琥珀', '暖肤', '体温', '暖香', '树脂'],
    },
    {
      id: 'paper-musk',
      src: '/static/card-atmospheres/scent/paper-musk.jpg',
      keywords: ['纸', '麝香', '书页', '棉纸', '干净', '皂感'],
    },
  ],
};

function stableIndex(input, length) {
  let hash = 0;
  const str = String(input || '');
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
}

export function pickAtmosphereAsset(kind, title, subtitle) {
  const assets = ATMOSPHERE_ASSETS[kind];
  if (!assets?.length) return null;
  const haystack = `${title || ''} ${subtitle || ''}`.toLowerCase();
  const matched = assets.find((asset) => (
    asset.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))
  ));
  return matched || assets[stableIndex(haystack, assets.length)];
}

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
