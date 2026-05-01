export const CARD_ART_VERSION = 'v4.1-2026-05-illustrations';

export function cardIllustrationSrc(filename) {
  return `/static/cards/illustrations/${filename}?v=${CARD_ART_VERSION}`;
}
