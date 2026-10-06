// Search result text: Google shows about 155 characters of a description and
// about 60 of a title, and cuts the rest mid-word. No imports, so tests run it.

/** The description cut to `max`: at the last full sentence when one ends late enough, else at a word, with an ellipsis. */
export function clipDescription(text, max = 155) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), /[.!?]$/.test(head) ? head.length - 1 : -1);
  if (end >= max * 0.6) return head.slice(0, end + 1);
  const word = t.slice(0, max).replace(/[\s,;:.]+\S*$/, '');
  return `${word}…`;
}

/** The first title that fits in `max` characters, or the last (shortest) one. */
export const fitTitle = (candidates, max = 60) => candidates.find((c) => c.length <= max) || candidates[candidates.length - 1];
