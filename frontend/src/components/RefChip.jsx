import { parseRef } from '../lib/parseRef';

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

/** Render a string that may contain [[ref|label]] markers as a mix of text + RefChip. */
export function RichText({ text }) {
  const segs = parseRef(text);
  if (!segs.length) return null;
  let k = 0;
  return segs.flatMap((s, i) => {
    if (s.type === 'ref') {
      return [<RefChip key={`ref-${i}`} id={s.id} label={s.label} />];
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
