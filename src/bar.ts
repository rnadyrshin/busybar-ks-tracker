// The bar's own HTTP API through plain fetch. The busy-lib client would do the same, but its code alone takes
// ~30 KB of the JS heap, which this app needs for reading the Kickstarter card.

const BASE = `http://${__BUSY_ADDR__}/api`;
const JSON_HEADERS = { "Content-Type": "application/json" };

async function call(method: string, path: string, body?: string): Promise<string> {
  const res = await fetch(BASE + path, { method, headers: JSON_HEADERS, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 80)}`);
  return text;
}

/** `elements` are element JSON strings. */
export function draw(app: string, elements: string[]): Promise<string> {
  return call("POST", "/display/draw", `{"application_name":${JSON.stringify(app)},"priority":50,"elements":[${elements.join(",")}]}`);
}

export function clear(app: string, ids: string[]): Promise<string> {
  return call("DELETE", "/display/draw", JSON.stringify({ application_name: app, element_ids: ids }));
}

export type SettingsDoc = { version?: number; values?: Record<string, unknown> };

export async function settings(app: string): Promise<SettingsDoc> {
  return JSON.parse(await call("GET", `/apps/settings?app_id=${encodeURIComponent(app)}`)) as SettingsDoc;
}
