import * as bar from "./bar.ts";
import { registerFontMaps, textWidth } from "@busy-app/busy-lib";
import { bold, condensed, normal, small, tiny } from "@busy-app/busy-lib/fonts";
import manifest from "./appmeta/manifest.json";
import { compact, fitAmount, fitCount, grouped, moneyLabel, percentText, timeLeft, type Font } from "./format.ts";
import { buildPages, ease, placePage, type Page } from "./intro.ts";
import { FetchError, fetchCard, fetchRate, fetchStats, projectPath, type Card, type FailKind, type Stats } from "./kickstarter.ts";
import { DEFAULTS, loadSettings, type Settings } from "./settings.ts";

for (const f of [tiny, small, condensed, normal, bold]) registerFontMaps(f);

const APP = manifest.id;
const W = 72;

const KS_GREEN = "#05CE78FF";
const WHITE = "#FFFFFFFF";
const GRAY = "#8A8A8AFF";
const RED = "#FF3B30FF";
const TRACK = "#262626FF";
/** The time left, a step down from the numbers. */
const DIM = "#B0B0B0FF";

/**
 * The fonts leave empty rows above the glyphs. These offsets put the bottom of the digits on row 6 for the top line
 * (7-px fonts fill rows 0–6, 5-px ones rows 2–6) and on row 15 for the bottom line. The 1-px bar sits on row 9, under the commas
 * (they hang down to row 8) and a row above the bottom line.
 */
const TOP_Y: Record<Font, number> = { tiny: 1, small: 0, condensed: -2, normal: -2, bold: -2 };
const BAR_Y = 9;
const BAR_H = 1;
const BOTTOM_Y = 9;

/** A text wider than the screen scrolls, at this many pixels a minute. */
const SCROLL_RATE = 1500;
/** Intro: pages of the name slide up into each other this fast, then the amount counts up from zero this long. */
const SLIDE_MS = 350;
const COUNT_MS = 1200;
/** Pause between animation frames; each frame is one request to the bar's display, so the real rate is lower. */
const FRAME_MS = 15;
/** A new amount rolls in: the changed tail of the number slides out and the new one in, in ROLL_MS. When the number
 *  changes length or font, it counts across instead, in COUNT_STEP_MS. */
const ROLL_MS = 350;
const COUNT_STEP_MS = 700;
/** How far a digit travels when it rolls: its 7 rows and the gap to the next. */
const ROLL_TRAVEL = 9;
/** Layers, bottom to top. While digits roll, a black mask under the bar hides them on their way out. */
const Z_AMOUNT = 2;
const Z_MASK = 3;
const Z_BAR = 4;
const Z_TEXT = 7;
/** The rise of the amount is counted over this sliding window, whatever the update period. */
const DELTA_WINDOW_MS = 60000;
/** Rates change once a day; the free API asks clients to keep requests rare. */
const RATE_TTL_MS = 6 * 3600 * 1000;
/** First retries of the card come quickly, then back off to the update period. */
const RETRY_FIRST_MS = 5000;

/** The bottom-left slot moves on to the next of its items (the last minute's rise, the backers, the share of the
 *  goal) this often. */
const ALTERNATE_MS = 4000;

/** The rolling tail of the amount: from character `i` on, the old text out, the new one in. */
type Roll = { i: number; from: string; to: string; fromX: number; toX: number; delay: number };

/** An animation of the amount, prepared when it starts so each frame has little to work out. */
type Plan = {
  start: number;
  end: number;
  /** The first frame also sends `fixed`: the characters that stay put, and the mask. */
  first: boolean;
  fixed: string[];
  rolls: Roll[];
  font: Font;
  y0: number;
  color: string;
  up: boolean;
  /** A count across instead of a roll; `k` turns a display amount back into the project's currency. */
  count: { from: number; to: number; prefix: string; full: boolean; right: number; goal: number; k: number } | null;
};

/** A display element, as the firmware's draw API takes it. */
type Element = { id: string; type: string; [key: string]: unknown };
type Elements = Element[];

function rect(id: string, x: number, y: number, width: number, height: number, color: string, z = 1): Element {
  return { id, type: "rectangle", x, y, width, height, radius: 0, border_width: 0, fill: "solid", fill_colors: [color], z_index: z };
}

function text(id: string, value: string, font: Font, x: number, y: number, color: string, z = 2): Element {
  return { id, type: "text", x, y, align: "top_left", font, text: value, color, z_index: z };
}

// The same elements as JSON, put together by hand: during an animation every frame counts, and JSON.stringify of
// whole objects is slow on the bar's engine.
const textJson = (id: string, value: string, font: Font, x: number, y: number, color: string, z: number) =>
  `{"id":"${id}","type":"text","x":${x},"y":${y},"align":"top_left","font":"${font}","text":${JSON.stringify(value)},"color":"${color}","z_index":${z}}`;
const rectJson = (id: string, x: number, y: number, w: number, h: number, color: string, z: number) =>
  `{"id":"${id}","type":"rectangle","x":${x},"y":${y},"width":${w},"height":${h},"radius":0,"border_width":0,"fill":"solid","fill_colors":["${color}"],"z_index":${z}}`;

/** A line centred when it fits, scrolled by the firmware when it does not. */
function line(id: string, value: string, color: string, font: Font = "normal"): Element {
  const w = textWidth(value, font);
  // Vertically centred: the 7-px fonts sit on rows 4–10, the 5-px small font on rows 6–10 with room for descenders.
  const base = { id, type: "text", y: font === "small" ? 7 : 6, align: "mid_left", font, text: value, color, z_index: 2 } as const;
  if (w <= W) return { ...base, x: Math.floor((W - w) / 2) };
  return { ...base, x: 0, width: W, scroll_rate: SCROLL_RATE, scroll_start_delay: 600, scroll_repeat_delay: 1200 };
}

const MESSAGES: Record<FailKind | "badlink" | "loading", string> = {
  loading: "Loading...",
  badlink: "Check the project link in settings",
  notfound: "Project not found",
  blocked: "Kickstarter refused, retrying",
  network: "No connection, retrying",
};


function main(): void {
  let settings: Settings = DEFAULTS;
  let path: string | null = null;
  let stopped = false;

  let card: Card | null = null;
  let stats: Stats | null = null;
  /** Multiplier from the project's currency to the display currency, and when it was read. */
  let rate = 1;
  let rateCurrency = "";
  let rateAt = 0;

  /** The last request for this kind of data failed: the screen keeps the last values and marks them stale. */
  let statsFailing = false;
  /** What the screen says while there is nothing to show yet. */
  let message: keyof typeof MESSAGES = "loading";

  /** The intro: its pages, and when it started (0 while there is no card yet, -1 once it is over or skipped). */
  let pages: Page[] = [];
  let introStart = 0;
  /** The amount as last drawn at rest, to see when it changes. */
  let restText = "";
  let restFont: Font = "bold";
  let restValue = 0;
  /** The animation of the amount under way, worked out once when it starts (see makeRoll and makeCount). */
  let plan: Plan | null = null;
  const animating = () => introStart > 0 || (plan !== null && Date.now() < plan.end);
  /** Amounts read in the last DELTA_WINDOW_MS, oldest first, plus the last one before it as the base. */
  const history: { t: number; pledged: number }[] = [];

  const remember = (t: number, pledged: number) => {
    history.push({ t, pledged });
    // Keep a single sample at or before the start of the window.
    while (history.length > 2 && history[1].t <= t - DELTA_WINDOW_MS) history.shift();
  };

  /** How much the amount rose over the last minute, in the project's currency. Recomputed each second, so old
   *  pledges drop out as the window slides. */
  const lastMinute = (now: number): number => {
    if (history.length === 0) return 0;
    const latest = history[history.length - 1];
    // The base: the last sample at or before the start of the window, else the oldest one there is.
    let base = history[0];
    for (const h of history) if (h.t <= now - DELTA_WINDOW_MS) base = h;
    return Math.max(0, latest.pledged - base.pledged);
  };

  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
      if (!stopped) fn();
    }, ms);
    timers.push(t);
  };

  const displayCurrency = () => {
    if (!card) return "";
    const want = settings.currency === "PROJECT" ? card.currency : settings.currency;
    // Until the rate is in, amounts stay in the project's currency rather than showing a wrong number.
    return want === card.currency || rateCurrency === want ? want : card.currency;
  };
  const toDisplay = (amount: number) => (card && displayCurrency() !== card.currency ? amount * rate : amount);

  // ---- Screen ----

  /** The right of the bottom line: the time left while live, the outcome after. */
  const statusOf = (): string => {
    const state = stats?.state ?? card?.stats.state ?? "";
    switch (state) {
      case "live":
        return card && card.deadline > 0 ? timeLeft(card.deadline, Date.now()) : "live";
      case "successful":
        return "funded";
      case "submitted":
      case "started":
        return "soon";
      case "suspended":
        // The bottom line sits on the last row: no room for the tails of p, g, y.
        return "halted";
      default:
        // failed, canceled
        return state;
    }
  };

  /**
   * A roll from `from` to `to` (same length, same font): everything from the first changed character on rolls as one
   * piece, the old tail out and the new one in, two elements a frame however many digits changed; the head stays put.
   */
  const makeRoll = (from: string, to: string, font: Font, x: number, color: string, up: boolean, now: number): Plan => {
    let i = 0;
    while (i < to.length && from[i] === to[i]) i++;
    const y0 = TOP_Y[font];
    const fixed: string[] = [];
    if (i > 0) fixed.push(textJson("r0", to.slice(0, i), font, x, y0, color, Z_AMOUNT));
    fixed.push(rectJson("mask", 0, BAR_Y, W, 16 - BAR_Y, "#000000FF", Z_MASK));
    const roll: Roll = { i, from: from.slice(i), to: to.slice(i), fromX: x + textWidth(from.slice(0, i), font), toX: x + textWidth(to.slice(0, i), font), delay: 0 };
    return { start: now, end: now + ROLL_MS, first: true, fixed, rolls: [roll], font, y0, color, up, count: null };
  };

  /** A count across from one amount to another: the number runs, right-aligned to where it ends; the bar follows. */
  const makeCount = (c: Card, from: number, to: number, prefix: string, full: boolean, font: Font, right: number, ms: number, now: number): Plan => {
    // From the display currency back to the project's, for the bar and the colour.
    const k = c.stats.pledged > 0 || (stats && stats.pledged > 0) ? to / ((stats ?? c.stats).pledged || 1) : 1;
    return {
      start: now,
      end: now + ms,
      first: true,
      fixed: [],
      rolls: [],
      font,
      y0: TOP_Y[font],
      color: WHITE,
      up: to >= from,
      count: { from, to, prefix, full, right, goal: c.goal, k: k || 1 },
    };
  };

  /** One frame of the plan: only what moves, as ready JSON. */
  const planFrame = (p: Plan, now: number): [string, string][] => {
    const t = now - p.start;
    const out: [string, string][] = [];
    if (p.first) for (const j of p.fixed) out.push([j.slice(7, j.indexOf('"', 7)), j]);
    if (p.count) {
      const q = p.count;
      const v = q.from + (q.to - q.from) * ease(t / (p.end - p.start));
      const txt = q.prefix + (q.full ? grouped(v) : compact(v, 3));
      const native = v / q.k;
      const color = q.goal > 0 && native >= q.goal ? KS_GREEN : WHITE;
      out.push(["amount", textJson("amount", txt, p.font, q.right - textWidth(txt, p.font), p.y0, color, Z_AMOUNT)]);
      const fill = q.goal > 0 ? Math.max(1, Math.floor(W * Math.min(1, native / q.goal))) : 1;
      out.push(["fill", rectJson("fill", 0, BAR_Y, fill, BAR_H, KS_GREEN, Z_BAR + 1)]);
      return out;
    }
    for (const r of p.rolls) {
      const d = Math.round(ROLL_TRAVEL * ease((t - r.delay) / ROLL_MS));
      // Growing: the old digit drops away and the new one comes down from above; shrinking: the other way round.
      out.push([`o${r.i}`, textJson(`o${r.i}`, r.from, p.font, r.fromX, p.up ? p.y0 + d : p.y0 - d, p.color, Z_AMOUNT)]);
      out.push([`n${r.i}`, textJson(`n${r.i}`, r.to, p.font, r.toX, p.up ? p.y0 - ROLL_TRAVEL + d : p.y0 + ROLL_TRAVEL - d, p.color, Z_AMOUNT)]);
    }
    return out;
  };

  /**
   * The main screen. `intro` is "preview" while the last page of the name slides up over it (the amount at zero), and
   * "count" once to start counting up from zero.
   */
  const projectFrame = (c: Card, s: Stats, intro: "" | "preview" | "count" = ""): Elements => {
    const cur = displayCurrency();
    const money = moneyLabel(cur);
    const now = Date.now();
    const target = toDisplay(s.pledged);

    // Top line: the amount, every digit when it fits.
    const amount = fitAmount(target, money, W, textWidth);
    const amountW = textWidth(amount.text, amount.font);
    // Centred, together with the currency code when there is one. The measured width ends with the 1-px gap that
    // follows every glyph; the ink is a pixel narrower.
    const amountX = Math.max(0, Math.floor((W - (amount.width - 1)) / 2));
    const full = amount.text === money.prefix + grouped(target);
    const funded = c.goal > 0 && s.pledged >= c.goal;
    const color = funded ? KS_GREEN : WHITE;

    // What the amount and the bar show in this frame: at rest, the real ones; at the start of an animation, the old.
    let shownText = amount.text;
    let shownX = amountX;
    let shownNative = s.pledged;
    if (intro) {
      shownText = money.prefix + "0";
      shownX = amountX + amountW - textWidth(shownText, amount.font);
      shownNative = 0;
      if (intro === "count") {
        plan = makeCount(c, 0, target, money.prefix, full, amount.font, amountX + amountW, COUNT_MS, now);
        later(draw, FRAME_MS);
      }
    } else if (restText && amount.text !== restText) {
      // The amount changed: roll the digits that differ, or count across when the length or the font changed.
      plan =
        amount.text.length === restText.length && amount.font === restFont
          ? makeRoll(restText, amount.text, amount.font, amountX, color, target >= restValue, now)
          : makeCount(c, restValue, target, money.prefix, full, amount.font, amountX + amountW, COUNT_STEP_MS, now);
      shownText = restText;
      shownX = amountX + amountW - textWidth(restText, amount.font);
      later(draw, FRAME_MS);
    }
    if (!intro || intro === "count") {
      restText = amount.text;
      restFont = amount.font;
      restValue = target;
    }

    const out: Elements = [
      text("amount", shownText, amount.font, shownX, TOP_Y[amount.font], intro ? WHITE : color, Z_AMOUNT),
      text("code", money.code || " ", "tiny", amountX + amountW + 1, TOP_Y.tiny, GRAY, Z_AMOUNT),
      rect("mask", 0, BAR_Y, W, 16 - BAR_Y, "#00000000", Z_MASK),
    ];

    // The bar: pledged against the goal, full past it.
    const share = c.goal > 0 ? shownNative / c.goal : 0;
    let fill = Math.floor(W * Math.min(1, share));
    if (shownNative > 0 && fill === 0) fill = 1;
    out.push(rect("track", 0, BAR_Y, W, BAR_H, TRACK, Z_BAR));
    out.push(rect("fill", 0, BAR_Y, Math.max(1, fill), BAR_H, fill > 0 ? KS_GREEN : TRACK, Z_BAR + 1));

    // Bottom line: on the left a number with a grey caption saying what it is, on the right the time left.
    const status = statusOf();
    // Flush right: the measured width ends with the 1-px gap after the last glyph, which would leave the edge column dark.
    const statusW = textWidth(status, "small") - 1;
    out.push(text("status", status, "small", W - statusW, BOTTOM_Y, DIM, Z_TEXT));
    const room = W - statusW - 3;
    let value: string;
    let caption: string;
    const pct = percentText(s.pledged, c.goal);
    // The slot takes turns: the last minute's rise always, then the backers and the share of the goal if they are on.
    const slots: ("rise" | "backers" | "percent")[] = ["rise"];
    if (settings.showBackers) slots.push("backers");
    if (settings.showPercent && pct) slots.push("percent");
    const slot = slots[Math.floor(now / ALTERNATE_MS) % slots.length];
    if (slot === "rise") {
      // "+$1,240 in 1m": the rise over a sliding minute, recounted every second.
      // Always "in 1m": in the first minute after start the window is shorter and the rise reads low, on purpose.
      const rise = lastMinute(now);
      const d = toDisplay(rise);
      const sign = "+" + money.prefix;
      const tail = money.code ? " " + money.code : "";
      value = sign + (d > 0 && d < 1 ? "<1" : fitCount(d, "small", room - textWidth(sign + tail, "small"), textWidth)) + tail;
      caption = "in 1m";
    } else if (slot === "percent") {
      value = pct;
      caption = "funded";
    } else {
      value = fitCount(s.backers, "small", room, textWidth);
      caption = s.backers === 1 ? "backer" : "backers";
    }
    const valueW = textWidth(value, "small");
    // The caption goes when it does not fit; the number stays.
    if (valueW + 2 + textWidth(caption, "small") > room) caption = "";
    out.push(text("left", value, "small", 0, BOTTOM_Y, WHITE, Z_TEXT));
    out.push(text("caption", caption || " ", "small", valueW + 2, BOTTOM_Y, GRAY, Z_TEXT));

    // A red dot in the corner: the numbers are from an earlier update, the latest one failed.
    out.push(rect("stale", W - 1, 0, 1, 1, statsFailing ? RED : "#00000000", Z_TEXT));
    return out;
  };

  /** Where the intro is: a page and how far it has slid into the next, or "count" once the pages are through. */
  const introAt = (now: number): { page: number; slide: number } | "count" | null => {
    if (introStart <= 0) return null;
    let t = now - introStart;
    for (let i = 0; i < pages.length; i++) {
      if (t < pages[i].ms) return { page: i, slide: 0 };
      t -= pages[i].ms;
      if (t < SLIDE_MS) return { page: i, slide: t / SLIDE_MS };
      t -= SLIDE_MS;
    }
    introStart = -1;
    return "count";
  };

  /** A page of the name, `shift` pixels down; the next one slides in from below the screen. */
  const pageElements = (index: number, shift: number): Elements =>
    placePage(pages[index], shift, textWidth).map((l, i) => text(`p${index}_${i}`, l.text, l.font, l.x, l.y, WHITE));

  const frame = (): Elements => {
    const at = card ? introAt(Date.now()) : null;
    if (card && at && at !== "count") {
      const shift = Math.round(16 * ease(at.slide));
      const out = pageElements(at.page, -shift);
      // The last page slides out over the main screen, its amount at zero.
      if (at.slide > 0)
        out.push(...(at.page + 1 < pages.length ? pageElements(at.page + 1, 16 - shift) : projectFrame(card, stats ?? card.stats, "preview").map((e) => ({ ...e, y: (e.y as number) + 16 - shift }))));
      return out;
    }
    if (card && at === "count") return projectFrame(card, stats ?? card.stats, "count");
    if (card) return projectFrame(card, stats ?? card.stats);
    if (message === "loading") return [line("msg", MESSAGES.loading, KS_GREEN, "small")];
    return [line("msg", MESSAGES[message], message === "network" || message === "blocked" ? GRAY : RED)];
  };

  /** After the last frame of an animation, one full frame puts the screen back at rest. */
  const settle = () => {
    if (plan === null) return;
    plan = null;
    later(draw, FRAME_MS);
  };

  /** What each element id last looked like on the device: a frame sends only what changed and clears what went. */
  let sent: Record<string, string> = {};
  let drawing = false;
  let dirty = false;

  const draw = () => {
    if (stopped) return;
    if (drawing) {
      dirty = true;
      return;
    }
    dirty = false;
    const now = Date.now();
    const elements: string[] = [];
    let gone: string[] = [];
    if (plan && now < plan.end) {
      // An animation frame: only what moves. The first one also takes the amount at rest away.
      for (const [id, json] of planFrame(plan, now)) {
        if (sent[id] !== json) {
          sent[id] = json;
          elements.push(json);
        }
      }
      if (plan.first && !plan.count && sent["amount"]) {
        gone = ["amount"];
        delete sent["amount"];
      }
      plan.first = false;
    } else {
      if (plan) plan = null;
      const ids: Record<string, true> = {};
      for (const el of frame()) {
        ids[el.id] = true;
        const json = JSON.stringify(el);
        if (sent[el.id] !== json) {
          sent[el.id] = json;
          elements.push(json);
        }
      }
      gone = Object.keys(sent).filter((id) => !ids[id]);
      for (const id of gone) delete sent[id];
    }
    if (elements.length === 0 && gone.length === 0) {
      // Nothing moved this frame (a page holding still): the intro still needs the next one.
      if (animating()) later(draw, 40);
      else settle();
      return;
    }
    drawing = true;
    const cleared = gone.length ? bar.clear(APP, gone) : Promise.resolve("");
    cleared
      .then(() => (elements.length ? bar.draw(APP, elements) : ""))
      .catch(() => {
        // The device state is unknown now: send everything next time.
        sent = {};
      })
      .then(() => {
        drawing = false;
        if (dirty) draw();
        // While the intro runs, the next frame follows as soon as this one is on screen.
        else if (animating()) later(draw, FRAME_MS);
        else settle();
      });
  };

  // ---- Data ----

  const failKind = (err: unknown): FailKind => (err instanceof FetchError ? err.kind : "network");

  /** The card holds the goal, currency and deadline. Retried with a growing pause until it comes. */
  const loadCard = (retryMs: number) => {
    if (!path) return;
    fetchCard(path)
      .then((c) => {
        if (stopped) return;
        const first = card === null;
        card = c;
        if (first) remember(Date.now(), c.stats.pledged);
        if (first) {
          pages = buildPages(c.name, textWidth);
          introStart = Date.now();
          loadRate();
          schedulePoll(settings.intervalMs);
        }
        draw();
      })
      .catch((err) => {
        if (stopped) return;
        message = failKind(err);
        draw();
        later(() => loadCard(Math.min(settings.intervalMs, retryMs * 2)), retryMs);
      });
  };

  /** The exchange rate, when the display currency is not the project's. */
  const loadRate = () => {
    if (!card) return;
    const want = settings.currency;
    if (want === "PROJECT" || want === card.currency) return;
    if (rateCurrency === want && Date.now() - rateAt < RATE_TTL_MS) return;
    fetchRate(card.currency, want)
      .then((r) => {
        rate = r;
        rateCurrency = want;
        rateAt = Date.now();
        draw();
      })
      // The amounts stay in the project's currency until the rate comes; the next poll asks again.
      .catch(() => undefined);
  };

  let polling = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const schedulePoll = (ms: number) => {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollStats, ms);
  };

  /** Pledged amount, backers and state, every period. One request at a time. */
  const pollStats = () => {
    if (stopped || !path || !card || polling) return;
    polling = true;
    const started = Date.now();
    fetchStats(path)
      .then((s) => {
        if (stopped) return;
        remember(Date.now(), s.pledged);
        // A project that launched since the card was read: read it again for the deadline.
        if (card && card.deadline === 0 && s.state === "live") loadCard(RETRY_FIRST_MS);
        stats = s;
        statsFailing = false;
      })
      .catch(() => {
        if (stopped) return;
        statsFailing = true;
      })
      .then(() => {
        polling = false;
        if (stopped) return;
        draw();
        loadRate();
        schedulePoll(Math.max(0, settings.intervalMs - (Date.now() - started)));
      });
  };

  /** Every second: the last minute's rise slides on, the slot takes turns, the time left stays current. */
  const tick = () => {
    draw();
    later(tick, 1000 - (Date.now() % 1000) + 20);
  };

  // ---- Input ----

  const unbind = listen("input", (event) => {
    if (stopped || event.key === "encoder" || event.action !== "short") return;
    if (event.key === "start") {
      // Skips the intro, or checks the project right now.
      if (introStart > 0) {
        introStart = -1;
        draw();
      } else {
        pollStats();
      }
      return;
    }
    if (event.key !== "back") return;
    stopped = true;
    clearTimeout(pollTimer);
    for (const t of timers.splice(0)) clearTimeout(t);
    // The unbind is the last handle: schedule it so this callback returns first.
    setTimeout(unbind, 0);
  });

  loadSettings()
    .then((s) => {
      settings = s;
    })
    .then(() => {
      if (stopped) return;
      path = projectPath(settings.project);
      if (!path) {
        message = "badlink";
        draw();
        return;
      }
      draw();
      loadCard(RETRY_FIRST_MS);
      tick();
    });
}

main();
