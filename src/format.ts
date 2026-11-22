// Number and time formatting for a 72-pixel-wide screen. Pure functions: the text width comes in as a parameter, so
// the same code runs on the bar and in Node (dev/check-format.ts).

export type Font = "tiny" | "small" | "condensed" | "normal" | "bold";
export type Measure = (text: string, font: Font) => number;

/** Currencies with a glyph in the bar's fonts. Others show their ISO code after the number: $ and ¥ alone are
 *  ambiguous (CA$, AU$, CN¥), and ₹ ₩ ₪ and the like are missing from the fonts altogether. */
const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", RUB: "₽" };

export type Money = { prefix: string; code: string };

/** How an amount in `currency` is labelled: a symbol before the number, or the code after it. */
export function moneyLabel(currency: string): Money {
  const symbol = SYMBOLS[currency];
  return symbol ? { prefix: symbol, code: "" } : { prefix: "", code: currency };
}

const SUFFIXES = ["", "K", "M", "B", "T"];

/** 4882784.36 → "4,882,784". Fractions are dropped, never rounded up: the screen never claims more than was pledged. */
export function grouped(n: number): string {
  const s = Math.floor(n).toFixed(0);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

/**
 * 4882784 with 3 significant digits → "4.88M"; with 2 → "4.8M". Truncated, not rounded: 999,999 is "999K", not "1M",
 * so a goal never looks reached before it is. Trailing zeros go ("1.00M" → "1M"). Past 999T it switches to "1.2e15".
 */
export function compact(n: number, digits: number): string {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  let tier = 0;
  let v = n;
  while (v >= 1000 && tier < SUFFIXES.length - 1) {
    v /= 1000;
    tier++;
  }
  if (v >= 1000) {
    // Beyond trillions: mantissa and exponent.
    const exp = Math.floor(Math.log10(n));
    let mant = n / Math.pow(10, exp);
    // log10 can land one off for exact powers of ten.
    if (mant >= 10) mant /= 10;
    const dec = Math.max(0, digits - 1);
    const scaled = Math.floor(mant * Math.pow(10, dec) + 1e-9);
    return withPoint(scaled, dec) + "e" + exp;
  }
  const intDigits = v >= 100 ? 3 : v >= 10 ? 2 : 1;
  const dec = Math.max(0, digits - intDigits);
  // Divide the integer, not the scaled-down float, so 4.88 does not come out as 4.87999.
  const scaled = Math.floor(n / Math.pow(10, tier * 3 - dec) + 1e-9);
  return withPoint(scaled, dec) + SUFFIXES[tier];
}

/** 488 with 2 decimals → "4.88"; trailing zeros dropped. */
function withPoint(scaled: number, dec: number): string {
  let s = String(scaled);
  if (dec === 0) return s;
  while (s.length <= dec) s = "0" + s;
  let int = s.slice(0, s.length - dec);
  let frac = s.slice(s.length - dec);
  while (frac.endsWith("0")) frac = frac.slice(0, -1);
  return frac ? `${int}.${frac}` : int;
}

export type Fitted = { text: string; font: Font; width: number };

/**
 * The amount as exact and as large as fits in `maxWidth` pixels. Every digit comes first, so each new pledge shows:
 * a smaller font before fewer digits. Only an amount too long even in the small font is shortened to "16.1M".
 * The width includes the currency code drawn after it in tiny, when there is one.
 */
export function fitAmount(n: number, money: Money, maxWidth: number, measure: Measure): Fitted {
  if (!isFinite(n) || n < 0) n = 0;
  const codeW = money.code ? measure(money.code, "tiny") + 1 : 0;
  const full = n < 1e15 ? grouped(n) : compact(n, 3);
  const attempts: [string, Font][] = [
    [full, "bold"],
    [full, "normal"],
    [full, "condensed"],
    [full, "small"],
    [compact(n, 4), "bold"],
    [compact(n, 3), "bold"],
    [compact(n, 3), "normal"],
    [compact(n, 2), "small"],
  ];
  for (const [digits, font] of attempts) {
    const text = money.prefix + digits;
    const width = measure(text, font) + codeW;
    if (width <= maxWidth) return { text, font, width };
  }
  const text = money.prefix + compact(n, 1);
  return { text, font: "small", width: measure(text, "small") + codeW };
}

/** Share of the goal: "87%", "8137%", "12K%". Truncated, so 99.9% stays "99%". Empty without a goal. */
export function percentText(pledged: number, goal: number): string {
  if (!(goal > 0) || !isFinite(pledged)) return "";
  const pct = Math.floor((pledged / goal) * 100 + 1e-9);
  return (pct < 10000 ? String(pct) : compact(pct, 2)) + "%";
}

/** Time left to a deadline, Kickstarter style but short: days, then hours under two days, then minutes. */
export function timeLeft(deadlineMs: number, nowMs: number): string {
  const s = Math.floor((deadlineMs - nowMs) / 1000);
  // No "ending": the bottom line has no room for the tail of the g.
  if (s <= 0) return "ended";
  if (s >= 2 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return "<1m";
}

/** A short span: "10s", "2m", "3h". */
export function durationText(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

/** A backer count that fits in `maxWidth`: grouped, then compact. */
export function fitCount(n: number, font: Font, maxWidth: number, measure: Measure): string {
  for (const t of [grouped(n), compact(n, 3), compact(n, 2)]) if (measure(t, font) <= maxWidth) return t;
  return compact(n, 1);
}
