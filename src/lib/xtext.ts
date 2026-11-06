// X counts characters by weight, not length: most Latin text counts 1,
// emoji and CJK count 2, and every link counts 23 no matter how long.

export const LIMIT_STANDARD = 280;
export const LIMIT_LONG = 25_000;

const URL_RE =
  /\bhttps?:\/\/[^\s]+|\b(?:www\.)?[a-z0-9-]+\.(?:com|io|co|net|org|ai|app|dev|me|xyz|bg|so|gg|link|ly)(?:\/[^\s]*)?/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function codePointWeight(cp: number): number {
  if (
    (cp >= 0 && cp <= 4351) ||
    (cp >= 8192 && cp <= 8205) ||
    (cp >= 8208 && cp <= 8223) ||
    (cp >= 8242 && cp <= 8247)
  ) {
    return 1;
  }
  return 2;
}

function textWeight(text: string): number {
  let total = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (EMOJI_RE.test(segment)) {
      total += 2;
      continue;
    }
    for (const ch of segment) total += codePointWeight(ch.codePointAt(0)!);
  }
  return total;
}

export function weightedLength(raw: string): number {
  const text = raw.normalize("NFC");
  let total = 0;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    total += textWeight(text.slice(last, m.index)) + 23;
    last = m.index! + m[0].length;
  }
  return total + textWeight(text.slice(last));
}

export function hasLink(text: string): boolean {
  URL_RE.lastIndex = 0;
  return new RegExp(URL_RE.source, "i").test(text);
}

// The part of a long post that shows in the feed before "Show more".
export function feedCut(raw: string, limit = LIMIT_STANDARD): { visible: string; truncated: boolean } {
  if (weightedLength(raw) <= limit) return { visible: raw, truncated: false };
  let out = "";
  for (const { segment } of segmenter.segment(raw)) {
    if (weightedLength(out + segment) > limit - 1) break;
    out += segment;
  }
  return { visible: out.trimEnd(), truncated: true };
}
