import { settings as readSettings } from "./bar.ts";
import manifest from "./appmeta/manifest.json";
import fields from "./appmeta/settings.json";

export type Settings = {
  /** What the user pasted: a project URL or "creator/slug". */
  project: string;
  /** ISO code, or "PROJECT" for the project's own currency. */
  currency: string;
  intervalMs: number;
  /** Take turns with the last minute's rise in the bottom-left slot. */
  showBackers: boolean;
  showPercent: boolean;
};

const f = fields.fields;
const CURRENCIES = f.currency.options.map((o) => o.value);

/** The defaults come straight from appmeta/settings.json, so the two cannot drift apart. */
export const DEFAULTS: Settings = {
  project: f.project.default,
  currency: f.currency.default,
  intervalMs: f.interval_s.default * 1000,
  showBackers: f.show_backers.default,
  showPercent: f.show_percent.default,
};

/** A failure or a version mismatch falls back to the defaults, so the app still works. */
export async function loadSettings(): Promise<Settings> {
  try {
    const doc = await readSettings(manifest.id);
    if (doc.version !== fields.version) return DEFAULTS;
    const values = (doc.values ?? {}) as Record<string, unknown>;
    const project = typeof values.project === "string" ? values.project.trim() : "";
    const currency = CURRENCIES.find((c) => c === values.currency) ?? DEFAULTS.currency;
    const s = values.interval_s;
    const intervalS = typeof s === "number" && s >= f.interval_s.min && s <= f.interval_s.max ? Math.round(s) : f.interval_s.default;
    const flag = (key: string, fallback: boolean) => (typeof values[key] === "boolean" ? (values[key] as boolean) : fallback);
    return {
      project: project || DEFAULTS.project,
      currency,
      intervalMs: intervalS * 1000,
      showBackers: flag("show_backers", DEFAULTS.showBackers),
      showPercent: flag("show_percent", DEFAULTS.showPercent),
    };
  } catch {
    return DEFAULTS;
  }
}
