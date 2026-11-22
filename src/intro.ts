// The project name on start: laid out in pages that fit the 72×16 screen without scrolling, the name itself first and
// large, then the tagline after it in the small font. Pages slide up into each other.

import type { Font, Measure } from "./format.ts";

const W = 72;
const H = 16;

export type Line = { text: string; font: Font };
export type Page = { lines: Line[]; ms: number };

/** "Flipper One — Open Linux Multi-tool" → name "Flipper One", tagline "Open Linux Multi-tool". */
export function splitTitle(title: string): { name: string; tagline: string } {
  // "Name - tagline", "Name: tagline", else "Name by Someone".
  const m = title.match(/^(.{2,}?)\s+[-|]\s+(.+)$/) ?? title.match(/^(.{2,}?):\s+(.+)$/) ?? title.match(/^(.{2,}) (by .+)$/);
  return m ? { name: m[1].trim(), tagline: m[2].trim() } : { name: title.trim(), tagline: "" };
}

/** Widest line allowed: the measured width ends with the 1-px gap after the last glyph, and a pixel stays free on
 *  each side, so the ink is at most W − 2. */
const MAX_W = W - 1;

/** Words into lines no wider than the screen; a word wider than the screen on its own is cut. */
export function wrap(text: string, font: Font, measure: Measure): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let word of text.split(" ")) {
    if (word === "") continue;
    while (measure(word, font) > MAX_W) {
      // Cut the longest head that fits; whatever is left goes on.
      let n = word.length - 1;
      while (n > 1 && measure(word.slice(0, n), font) > MAX_W) n--;
      if (cur) lines.push(cur);
      lines.push(word.slice(0, n));
      cur = "";
      word = word.slice(n);
    }
    const next = cur ? cur + " " + word : word;
    if (measure(next, font) <= MAX_W) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return balance(lines, font, measure);
}

/** Two lines get the break that makes them most even, so no word is left alone on the second one. */
function balance(lines: string[], font: Font, measure: Measure): string[] {
  if (lines.length !== 2) return lines;
  const words = (lines[0] + " " + lines[1]).split(" ");
  let best = lines;
  let bestW = Math.max(measure(lines[0], font), measure(lines[1], font));
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(measure(a, font), measure(b, font));
    if (w < bestW) {
      best = [a, b];
      bestW = w;
    }
  }
  return best;
}

/** Reading time for a page: a base plus a little per character, so long taglines stay up longer. */
const pageMs = (lines: string[]) => Math.min(3200, 1100 + 45 * lines.join(" ").length);

/** Two lines a page; the name in bold when one line holds it, else in the regular font, else in the small one. */
export function buildPages(title: string, measure: Measure): Page[] {
  const { name, tagline } = splitTitle(title);
  const pages: Page[] = [];
  const add = (lines: string[], font: Font, perPage: number) => {
    for (let i = 0; i < lines.length; i += perPage) {
      const chunk = lines.slice(i, i + perPage);
      pages.push({ lines: chunk.map((text) => ({ text, font })), ms: pageMs(chunk) });
    }
  };
  // The name on one page if at all possible: bold, regular in two lines, small in two; only then over pages.
  const normal = wrap(name, "normal", measure);
  const smallLines = wrap(name, "small", measure);
  if (measure(name, "bold") <= MAX_W) add([name], "bold", 1);
  else if (normal.length <= 2) add(normal, "normal", 2);
  else if (smallLines.length <= 2) add(smallLines, "small", 2);
  else if (normal.length <= 4) add(normal, "normal", 2);
  else add(smallLines, "small", 2);
  if (tagline) add(wrap(tagline, "small", measure), "small", 2);
  // A very long title stops after four pages: the numbers matter more.
  return pages.slice(0, 4);
}

/** Glyph rows of each font, and the text element's y that puts the top of the glyphs on row 0. */
const INK_H: Record<Font, number> = { tiny: 5, small: 5, condensed: 7, normal: 7, bold: 7 };
const Y_TO_INK: Record<Font, number> = { tiny: -1, small: -2, condensed: -2, normal: -2, bold: -2 };

export type Placed = { text: string; font: Font; x: number; y: number };

/** A page's lines centred on the screen, as a block, `shift` pixels down (negative: up). */
export function placePage(page: Page, shift: number, measure: Measure): Placed[] {
  const gap = page.lines[0]?.font === "small" ? 3 : 2;
  const heights = page.lines.map((l) => INK_H[l.font]);
  const block = heights.reduce((a, b) => a + b, 0) + gap * (page.lines.length - 1);
  let top = Math.floor((H - block) / 2);
  return page.lines.map((l, i) => {
    const w = measure(l.text, l.font) - 1;
    const placed = { text: l.text, font: l.font, x: Math.max(0, Math.floor((W - w) / 2)), y: top + Y_TO_INK[l.font] + shift };
    top += heights[i] + gap;
    return placed;
  });
}

/** Ease in and out, 0..1 → 0..1. */
export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
