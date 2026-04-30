import { parseRef } from '../lib/parseRef';
import { MediaCard } from './MediaCard';

export function RefChip({ id, label }) {
  const onClick = (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('bazi:ref-click', { detail: { id } }));
  };
  return (
    <a
      href="#"
      className="ref-chip"
      data-ref-link={id}
      onClick={onClick}
      title={id}
    >{label}</a>
  );
}

/**
 * Parse a plain-text segment containing inline markdown (**bold**, *italic*, `code`)
 * and return an array of React nodes.
 */
function renderInlineMd(text, baseKey) {
  // Pattern: **bold** | *italic* | `code`
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/gs;
  const nodes = [];
  let last = 0;
  let k = baseKey;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    if (match[0].startsWith('**')) {
      nodes.push(<strong key={k++}>{match[2]}</strong>);
    } else if (match[0].startsWith('*')) {
      nodes.push(<em key={k++}>{match[3]}</em>);
    } else {
      nodes.push(<code key={k++}>{match[4]}</code>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Convert a markdown text block into React nodes.
 * Handles: **bold**, *italic*, `code`, ## headings (stripped), > blockquote (stripped marker),
 * bullet lists (→ · prefix), and preserves newlines via white-space:pre-wrap on parent.
 */
export function renderMd(text) {
  if (!text) return null;
  // Pre-process block-level markdown before inline parsing
  const processed = String(text)
    .replace(/^#{1,6}\s*/gm, '')       // strip heading markers
    .replace(/^>\s*/gm, '')            // strip blockquote markers
    .replace(/^[-*+]\s+/gm, '· ');    // bullet list → dot

  return renderInlineMd(processed, 0);
}

/** Render a string that may contain [[ref|label]] or [[song:…|…]] markers
 *  as a mix of text + RefChip + MediaCard.
 *  ``context`` (e.g. the preceding user question) lets parseRef rescue
 *  《XX》 → media token when the question was "用一首歌/一部电影/一本书 形容…"
 *  but the LLM fell back to 书名号 instead of the structured token. */
export function RichText({ text, context }) {
  const segs = parseRef(text, { context });
  if (!segs.length) return null;
  let k = 0;
  return segs.flatMap((s, i) => {
    if (s.type === 'ref') {
      return [<RefChip key={`ref-${i}`} id={s.id} label={s.label} />];
    }
    if (s.type === 'media') {
      return [
        <MediaCard
          key={`media-${i}`}
          kind={s.kind}
          title={s.title}
          subtitle={s.subtitle}
        />,
      ];
    }
    return renderInlineMd(
      String(s.value || '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^[-*+]\s+/gm, '· '),
      k++ * 1000,
    );
  });
}
