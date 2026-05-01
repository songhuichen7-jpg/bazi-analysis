import { parseRef } from '../lib/parseRef';
import { renderInlineMd } from '../lib/richText.jsx';
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
