/**
 * 城市 → 经纬度查询（用于真太阳时修正）
 *
 * 数据源：pyecharts `city_coordinates.json`（MIT 协议，~3750 条中文地名）
 *   https://github.com/pyecharts/pyecharts
 *
 * 查询策略（依次回退）：
 *   1. 精确匹配（原样）
 *   2. 去后缀规范化匹配（去掉 市/省/区/县/自治州/特别行政区 等）
 *   3. 子串/包含模糊匹配（"湖南长沙" → "长沙"；"佛山市顺德" → "顺德"）
 * 找不到返回 null；上层决定要不要 warning。
 *
 * 真太阳时只用得到经度，精度要求不高（0.1° ≈ 24 秒），数据集里的
 * 两位小数坐标足够。
 */

const fs = require('fs');
const path = require('path');

let RAW = {};
try {
  RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'cities-data.json'), 'utf8'));
} catch (_) {
  RAW = {};
}

// 海外华人集中的城市——pyecharts 数据集偏中国大陆，这里补一层。
// 形式同原数据：[lng, lat]。
const OVERSEAS = {
  // 北美
  '纽约':    [-74.006,  40.7128],
  '旧金山':  [-122.4194, 37.7749],
  '洛杉矶':  [-118.2437, 34.0522],
  '西雅图':  [-122.3321, 47.6062],
  '波士顿':  [-71.0589,  42.3601],
  '芝加哥':  [-87.6298,  41.8781],
  '华盛顿':  [-77.0369,  38.9072],
  '多伦多':  [-79.3832,  43.6532],
  '温哥华':  [-123.1207, 49.2827],
  '蒙特利尔':[-73.5673,  45.5017],
  // 欧洲
  '伦敦':    [-0.1276,   51.5074],
  '巴黎':    [2.3522,    48.8566],
  '柏林':    [13.4050,   52.5200],
  '莫斯科':  [37.6173,   55.7558],
  // 亚太 / 邻近
  '新加坡':  [103.8198,  1.3521],
  '吉隆坡':  [101.6869,  3.1390],
  '曼谷':    [100.5018,  13.7563],
  '首尔':    [126.9780,  37.5665],
  '东京':    [139.6917,  35.6895],
  '大阪':    [135.5023,  34.6937],
  '悉尼':    [151.2093, -33.8688],
  '墨尔本':  [144.9631, -37.8136],
  '奥克兰':  [174.7633, -36.8485],
};
// 覆盖到 RAW（pyecharts 里如果有同名，用这里更精确的坐标）
Object.assign(RAW, OVERSEAS);

// 后缀列表：按"长 → 短"排序，保证 "特别行政区" 在 "区" 之前尝试。
const SUFFIXES = [
  '维吾尔自治区', '回族自治区', '壮族自治区', '特别行政区',
  '藏族自治州', '彝族自治州', '白族自治州', '苗族自治州', '回族自治州',
  '土家族苗族自治州', '苗族土家族自治州', '布依族苗族自治州', '哈尼族彝族自治州',
  '自治区', '自治州', '自治县', '自治旗',
  '地区', '林区', '矿区', '新区',
  '省', '市', '区', '县', '盟', '旗',
];

function stripSuffix(s) {
  for (const suf of SUFFIXES) {
    if (s.length > suf.length && s.endsWith(suf)) {
      return s.slice(0, -suf.length);
    }
  }
  return s;
}

function normalize(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s+/g, '');
  // 连续剥两次，处理"XX市辖区"这种
  s = stripSuffix(s);
  s = stripSuffix(s);
  return s;
}

// 构建索引（模块加载时一次）
const EXACT_MAP = new Map();   // 原始名 → {lng, lat}
const NORM_MAP  = new Map();   // 规范化名 → {lng, lat, canonical}

(function buildIndex() {
  for (const [name, coords] of Object.entries(RAW)) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    EXACT_MAP.set(name, { lng, lat });
    const n = normalize(name);
    if (!n) continue;
    // 冲突时偏向原名带 市/县/区 的条目（这些通常是标准行政名）
    const prev = NORM_MAP.get(n);
    const isAdmin = /[市县区旗州盟]$/.test(name);
    if (!prev || isAdmin) {
      NORM_MAP.set(n, { lng, lat, canonical: name });
    }
  }
})();

/**
 * 解析用户输入的地名为 {lng, lat, canonical}。
 * 找不到返回 null。
 *
 * @param {string} raw
 * @returns {{lng:number, lat:number, canonical:string}|null}
 */
function getCityCoords(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s+/g, '');
  if (!s) return null;

  // 1. 精确
  if (EXACT_MAP.has(s)) {
    const { lng, lat } = EXACT_MAP.get(s);
    return { lng, lat, canonical: s };
  }

  // 2. 规范化
  const n = normalize(s);
  if (n && NORM_MAP.has(n)) return { ...NORM_MAP.get(n) };

  // 3. 子串模糊（双向），仅对长度 >= 2 的输入生效，避免单字误匹配
  if (n && n.length >= 2) {
    // 先找 "输入包含已知key"（如 "湖南长沙" 包含 "长沙"）——偏向较长的key
    let bestContained = null;
    for (const [key, val] of NORM_MAP.entries()) {
      if (key.length < 2) continue;
      if (n.includes(key) && (!bestContained || key.length > bestContained.key.length)) {
        bestContained = { key, val };
      }
    }
    if (bestContained) return { ...bestContained.val };

    // 再找 "已知key包含输入"（如输入 "浦东" 匹配到 "浦东新区"）
    for (const [key, val] of NORM_MAP.entries()) {
      if (key.includes(n)) return { ...val };
    }
  }

  return null;
}

/**
 * 供前端 autocomplete 使用的城市名列表。
 * 默认返回所有 3000+ 条；可选 limit 截断。
 * @param {number} [limit]
 * @returns {string[]}
 */
function listCityNames(limit) {
  const out = [];
  for (const k of EXACT_MAP.keys()) {
    out.push(k);
    if (limit && out.length >= limit) break;
  }
  return out;
}

// 向后兼容：旧代码 `Object.keys(CITIES)` 依赖这是一个普通对象
const CITIES = RAW;

module.exports = { CITIES, getCityCoords, listCityNames, normalize };
