/**
 * 地支藏干表（本气 + 中气 + 余气，带权重）
 *
 * 权重参考传统命理权重（任铁樵滴天髓原注 + 渊海子平）：
 *   本气 1.0 / 中气 0.5 / 余气 0.3
 *
 * 四仲月（子午卯酉）通常只有本气。
 * 四孟月（寅申巳亥）有本气 + 中气（长生之气）。
 * 四库月（辰戌丑未）有本气 + 中气 + 余气，须透干或冲开才能用。
 */

const CANG_GAN = {
  子: [{ gan:'癸', weight:1.0, role:'本气' }],
  丑: [{ gan:'己', weight:1.0, role:'本气' },
       { gan:'癸', weight:0.5, role:'中气' },
       { gan:'辛', weight:0.3, role:'余气' }],
  寅: [{ gan:'甲', weight:1.0, role:'本气' },
       { gan:'丙', weight:0.5, role:'中气' },
       { gan:'戊', weight:0.3, role:'余气' }],
  卯: [{ gan:'乙', weight:1.0, role:'本气' }],
  辰: [{ gan:'戊', weight:1.0, role:'本气' },
       { gan:'乙', weight:0.5, role:'中气' },
       { gan:'癸', weight:0.3, role:'余气' }],
  巳: [{ gan:'丙', weight:1.0, role:'本气' },
       { gan:'戊', weight:0.5, role:'中气' },
       { gan:'庚', weight:0.3, role:'余气' }],
  午: [{ gan:'丁', weight:1.0, role:'本气' },
       { gan:'己', weight:0.5, role:'中气' }],
  未: [{ gan:'己', weight:1.0, role:'本气' },
       { gan:'丁', weight:0.5, role:'中气' },
       { gan:'乙', weight:0.3, role:'余气' }],
  申: [{ gan:'庚', weight:1.0, role:'本气' },
       { gan:'壬', weight:0.5, role:'中气' },
       { gan:'戊', weight:0.3, role:'余气' }],
  酉: [{ gan:'辛', weight:1.0, role:'本气' }],
  戌: [{ gan:'戊', weight:1.0, role:'本气' },
       { gan:'辛', weight:0.5, role:'中气' },
       { gan:'丁', weight:0.3, role:'余气' }],
  亥: [{ gan:'壬', weight:1.0, role:'本气' },
       { gan:'甲', weight:0.5, role:'中气' }],
};

// 取地支本气
function getBenQi(zhi) {
  return CANG_GAN[zhi] && CANG_GAN[zhi][0].gan;
}

// 取地支所有藏干（带权重）
function getCangGan(zhi) {
  return CANG_GAN[zhi] || [];
}

module.exports = { CANG_GAN, getBenQi, getCangGan };
