// Kickstarter has no public API. Two pages answer without a browser challenge:
//   /projects/<creator>/<slug>/stats.json           pledged, backers, state; tiny, polled every period. Served
//                                                   from Cloudflare's cache, max-age 5 s: polling faster gains nothing
//   /projects/<creator>/<slug>/widget/card.html     the embeddable card; its HTML carries the project JSON with the
//                                                   goal, currency and deadline; ~44 KB, read once
// Both report money in the project's own currency.

const BASE = "https://www.kickstarter.com/projects/";
const TIMEOUT_MS = 15000;

/**
 * "creator/slug" from whatever was pasted: a full URL, with or without the scheme, www, a query, or a sub-page like
 * /description; or just "creator/slug". Null when it does not look like a project.
 */
export function projectPath(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^[a-z]+:\/\//i, "").replace(/^(www\.)?kickstarter\.com/i, "");
  s = s.split(/[?#]/)[0];
  s = s.replace(/^\/+/, "").replace(/^projects\//i, "");
  const parts = s.split("/").filter((p) => p !== "");
  if (parts.length < 2) return null;
  const ok = /^[A-Za-z0-9_-]+$/;
  if (!ok.test(parts[0]) || !ok.test(parts[1])) return null;
  return `${parts[0]}/${parts[1]}`;
}

/** Why a request gave no data; the screen shows a different message for each. */
export type FailKind = "notfound" | "blocked" | "network";

export class FetchError extends Error {
  readonly kind: FailKind;
  constructor(kind: FailKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** GET with a timeout; HTTP errors become a FetchError of the right kind. */
export async function getText(url: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FetchError("network", "timeout")), TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([fetch(url), expired]);
    const text = await Promise.race([res.text(), expired]);
    if (res.status === 404) throw new FetchError("notfound", "404");
    // Cloudflare answers a challenge page with 403 (or 503) when it does not trust the client.
    if (res.status === 403 || res.status === 429 || res.status === 503 || /<title>Just a moment/.test(text))
      throw new FetchError("blocked", `HTTP ${res.status}`);
    if (res.status !== 200) throw new FetchError("network", `HTTP ${res.status}`);
    return text;
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError("network", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** What changes during a campaign. */
export type Stats = {
  pledged: number;
  backers: number;
  /** submitted, started (pre-launch), live, successful, failed, canceled, suspended. */
  state: string;
};

/** What is fixed once the campaign launches. */
export type Card = {
  name: string;
  goal: number;
  currency: string;
  /** Unix ms, or 0 before launch. */
  deadline: number;
  stats: Stats;
};

export async function fetchStats(path: string): Promise<Stats> {
  const text = await getText(`${BASE}${path}/stats.json?v=1`);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new FetchError("network", "stats: not JSON");
  }
  const p = (doc as { project?: Record<string, unknown> }).project;
  if (!p) throw new FetchError("network", "stats: no project");
  const pledged = Number(p.pledged);
  const backers = Number(p.backers_count);
  if (!isFinite(pledged) || pledged < 0) throw new FetchError("network", `stats: pledged ${String(p.pledged)}`);
  return { pledged, backers: isFinite(backers) && backers >= 0 ? backers : 0, state: String(p.state ?? "") };
}

// The card escapes its JSON into an HTML attribute; the project's own fields come first, before the creator's,
// the category's and the location's, so the first match of each key is the project's.
const Q = "&quot;";

function num(html: string, key: string): number {
  const m = html.match(new RegExp(`${Q}${key}${Q}:(-?[0-9.]+(?:e[+-]?[0-9]+)?)`));
  return m ? Number(m[1]) : NaN;
}

function str(html: string, key: string): string {
  const m = html.match(new RegExp(`${Q}${key}${Q}:${Q}(.*?)${Q}`));
  return m ? m[1] : "";
}

/** HTML entities and the typographic characters the bar's fonts lack. */
export function plainText(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    // Emoji, dingbats and arrows: the bar's fonts have none of them and would draw boxes.
    .replace(/[←-⯿‍︀-️]|[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** UTF-8 bytes to a string; the runtime has no TextDecoder. Malformed bytes become U+FFFD. */
export function utf8(bytes: Uint8Array): string {
  const codes: number[] = [];
  let out = "";
  const n = bytes.length;
  for (let i = 0; i < n; ) {
    const c = bytes[i++];
    let cp = 0xfffd;
    if (c < 0x80) cp = c;
    else if (c >= 0xc0 && c < 0xe0 && i < n) cp = ((c & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (c >= 0xe0 && c < 0xf0 && i + 1 < n) cp = ((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else if (c >= 0xf0 && i + 2 < n) {
      cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      cp -= 0x10000;
      codes.push(0xd800 + (cp >> 10));
      cp = 0xdc00 + (cp & 0x3ff);
    }
    codes.push(cp);
    // Flush in slices: fromCharCode.apply on a long array overflows the engine's stack.
    if (codes.length >= 512) out += String.fromCharCode.apply(null, codes.splice(0));
  }
  return out + String.fromCharCode.apply(null, codes);
}

/**
 * The project's fields sit in the first ~8 KB of the card; the rest, 40 to 80 KB of scripts and styles, is more than
 * the bar can take in one piece: a whole card can reboot it. So the card is read as a stream and dropped as soon as
 * the last field needed has arrived.
 */
const CARD_MAX_BYTES = 16000;
const CARD_LAST_FIELD = "&quot;backers_count&quot;";

async function cardHead(url: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FetchError("network", "timeout")), TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([fetch(url), expired]);
    if (res.status === 404) throw new FetchError("notfound", "404");
    if (res.status !== 200) throw new FetchError(res.status === 403 || res.status === 429 || res.status === 503 ? "blocked" : "network", `HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new FetchError("network", "card: no stream");
    const chunks: Uint8Array[] = [];
    let total = 0;
    let tail = "";
    try {
      while (total < CARD_MAX_BYTES) {
        const { done, value } = await Promise.race([reader.read(), expired]);
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
        // The marker is ASCII, so looking for it in this chunk (plus the end of the last) needs no full decode.
        const piece = tail + String.fromCharCode.apply(null, Array.prototype.slice.call(value) as number[]);
        if (piece.indexOf(CARD_LAST_FIELD) >= 0) break;
        tail = piece.slice(-CARD_LAST_FIELD.length);
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    const html = utf8(all);
    if (/<title>Just a moment/.test(html)) throw new FetchError("blocked", "challenge");
    return html;
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError("network", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCard(path: string): Promise<Card> {
  const html = await cardHead(`${BASE}${path}/widget/card.html?v=2`);
  const goal = num(html, "goal");
  const pledged = num(html, "pledged");
  const currency = str(html, "currency");
  if (!(goal >= 0) || !(pledged >= 0) || !/^[A-Z]{3}$/.test(currency)) throw new FetchError("network", "card: no project data");
  const title = html.match(/<title>([^<]*)<\/title>/);
  const deadline = num(html, "deadline");
  const backers = num(html, "backers_count");
  return {
    name: title ? plainText(title[1]) : path.split("/")[1],
    goal,
    currency,
    deadline: deadline > 0 ? deadline * 1000 : 0,
    stats: { pledged, backers: backers >= 0 ? backers : 0, state: str(html, "state") },
  };
}

/**
 * How many `to` one `from` buys, from open.er-api.com (free, no key, updated daily). Its terms ask to keep requests
 * rare: the app reads the rates at most every few hours.
 */
export async function fetchRate(from: string, to: string): Promise<number> {
  const text = await getText(`https://open.er-api.com/v6/latest/${from}`);
  let doc: { result?: string; rates?: Record<string, number> };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new FetchError("network", "rates: not JSON");
  }
  const rate = doc.rates?.[to];
  if (doc.result !== "success" || typeof rate !== "number" || !(rate > 0)) throw new FetchError("network", `rates: no ${from}→${to}`);
  return rate;
}
