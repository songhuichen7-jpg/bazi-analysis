/**
 * 天干地支基础常量 + 五行生克
 */

const TIAN_GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const DI_ZHI   = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

// 天干 → 五行
const GAN_WUXING = {
  甲:'木', 乙:'木',
  丙:'火', 丁:'火',
  戊:'土', 己:'土',
  庚:'金', 辛:'金',
  壬:'水', 癸:'水',
};

// 天干 → 阴阳
const GAN_YINYANG = {
  甲:'阳', 丙:'阳', 戊:'阳', 庚:'阳', 壬:'阳',
  乙:'阴', 丁:'阴', 己:'阴', 辛:'阴', 癸:'阴',
};

// 地支 → 五行（本气）
const ZHI_WUXING = {
  子:'水', 亥:'水',
  寅:'木', 卯:'木',
  巳:'火', 午:'火',
  申:'金', 酉:'金',
  辰:'土', 戌:'土', 丑:'土', 未:'土',
};

// 地支 → 阴阳
const ZHI_YINYANG = {
  子:'阳', 寅:'阳', 辰:'阳', 午:'阳', 申:'阳', 戌:'阳',
  丑:'阴', 卯:'阴', 巳:'阴', 未:'阴', 酉:'阴', 亥:'阴',
};

// 五行生克
const WUXING_SHENG = { 木:'火', 火:'土', 土:'金', 金:'水', 水:'木' }; // 生
const WUXING_KE    = { 木:'土', 土:'水', 水:'火', 火:'金', 金:'木' }; // 克

function generates(a, b) { return WUXING_SHENG[a] === b; }
function overcomes(a, b) { return WUXING_KE[a] === b; }

// 月令 → 对应地支（寅=1月，卯=2月... 丑=12月）
// BaZi 月令按节气分，非公历月份；这里只做地支→五行查询用
const DIZHI_MONTH = {
  寅:1, 卯:2, 辰:3, 巳:4, 午:5, 未:6,
  申:7, 酉:8, 戌:9, 亥:10, 子:11, 丑:12,
};

// 地支分类（用于格局判定）
const ZHI_CATEGORY = {
  子:'四仲', 午:'四仲', 卯:'四仲', 酉:'四仲',
  寅:'四孟', 申:'四孟', 巳:'四孟', 亥:'四孟',
  辰:'四库', 戌:'四库', 丑:'四库', 未:'四库',
};

module.exports = {
  TIAN_GAN, DI_ZHI,
  GAN_WUXING, GAN_YINYANG,
  ZHI_WUXING, ZHI_YINYANG,
  WUXING_SHENG, WUXING_KE,
  generates, overcomes,
  DIZHI_MONTH, ZHI_CATEGORY,
};
