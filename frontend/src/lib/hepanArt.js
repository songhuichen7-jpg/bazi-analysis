export const HEPAN_ART_VERSION = 'v1.0-2026-05-hepan-illustrations';

const RELATION_ART = {
  '天作搭子': {
    filename: 'tianzuo.png',
    alt: '天作搭子关系插画',
  },
  '镜像搭子': {
    filename: 'mirror.png',
    alt: '镜像搭子关系插画',
  },
  '同频搭子': {
    filename: 'tongpin.png',
    alt: '同频搭子关系插画',
  },
  '滋养搭子': {
    filename: 'ziyang.png',
    alt: '滋养搭子关系插画',
  },
  '火花搭子': {
    filename: 'huohua.png',
    alt: '火花搭子关系插画',
  },
  '互补搭子': {
    filename: 'hubu.png',
    alt: '互补搭子关系插画',
  },
};

export function hepanRelationArt(category) {
  return RELATION_ART[category] || RELATION_ART['互补搭子'];
}

export function relationIllustrationSrc(category) {
  const item = hepanRelationArt(category);
  return `/static/hepan/illustrations/${item.filename}?v=${HEPAN_ART_VERSION}`;
}
