const INTERNAL_SCOPES = new Set(['full', 'fallback', 'fallback-head', 'season', 'month', 'focused']);

function cleanLabel(value) {
  return String(value || '')
    .replace(/^heading:/, '')
    .replace(/^#{1,6}\s*/g, '')
    .replace(/^>\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSource(source) {
  const parts = String(source || '')
    .split(/\s*·\s*/)
    .map(cleanLabel)
    .filter(Boolean);
  const [book = '', ...rest] = parts;
  return {
    book,
    chapter: rest.length ? rest.join(' · ') : null,
  };
}

function normalizeScope(scope, chapter) {
  const normalized = cleanLabel(scope).replace(/(?:^|·)focused$/u, '').trim();
  if (!normalized || INTERNAL_SCOPES.has(normalized)) return null;
  if (chapter && (chapter === normalized || chapter.includes(normalized))) return null;
  return normalized;
}

function normalizeParagraph(text) {
  return String(text || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s+/gm, '· ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripLeadingLabels(text, labels) {
  let lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length) {
    const first = cleanLabel(lines[0]);
    if (!first || !labels.has(first)) break;
    lines = lines.slice(1);
    while (lines.length && !lines[0].trim()) lines = lines.slice(1);
  }
  return lines.join('\n').trim();
}

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map(normalizeParagraph)
    .filter(Boolean);
}

export function buildClassicsDisplayItem(item) {
  const { book, chapter } = splitSource(item?.source);
  const section = normalizeScope(item?.scope, chapter);
  const cleanedText = stripLeadingLabels(item?.text, new Set([book, chapter, section].filter(Boolean)));
  const paragraphs = splitParagraphs(cleanedText);

  return {
    book,
    chapter,
    section,
    match: String(item?.match || '').trim(),
    paragraphs,
  };
}
