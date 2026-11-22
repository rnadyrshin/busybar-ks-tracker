// Prints how amounts of every size come out on the 72-px screen: node dev/check-format.ts
import { registerFontMaps, textWidth } from "@busy-app/busy-lib";
import { bold, condensed, normal, small, tiny } from "@busy-app/busy-lib/fonts";
import { compact, durationText, fitAmount, grouped, moneyLabel, percentText, timeLeft } from "../src/format.ts";
import { projectPath } from "../src/kickstarter.ts";

for (const f of [tiny, small, condensed, normal, bold]) registerFontMaps(f);
const measure = (t: string, f: string) => textWidth(t, f as "small");
let failed = 0;
const eq = (got: unknown, want: unknown, what: string) => {
  if (got !== want) {
    failed++;
    console.log(`FAIL ${what}: got ${String(got)}, want ${String(want)}`);
  }
};

eq(grouped(4882784.36), "4,882,784", "grouped");
eq(grouped(0.99), "0", "grouped <1");
eq(compact(4882784, 3), "4.88M", "compact 3");
eq(compact(4882784, 2), "4.8M", "compact 2");
eq(compact(999999, 3), "999K", "no round-up to 1M");
eq(compact(1000000, 3), "1M", "trailing zeros");
eq(compact(1050000, 3), "1.05M", "1.05M");
eq(compact(65292, 3), "65.2K", "65.2K");
eq(compact(999, 3), "999", "under 1000");
eq(compact(1e15, 2), "1e15", "1e15");
eq(compact(2.5e18, 2), "2.5e18", "2.5e18");
eq(compact(Number.MAX_SAFE_INTEGER, 2), "9e15", "max safe");
eq(percentText(65292, 20000), "326%", "pct");
eq(percentText(59999.99, 60000), "99%", "pct no round-up");
eq(percentText(4882784, 60000), "8137%", "pct big");
eq(percentText(5e9, 1), "500B%", "pct huge");
eq(percentText(100, 0), "", "goal 0");
eq(timeLeft(10 * 86400e3, 0), "10d", "days");
eq(timeLeft(47 * 3600e3, 0), "47h", "hours");
eq(timeLeft(59e3, 0), "<1m", "secs");
eq(durationText(10300), "10s", "10s");
eq(durationText(150e3), "3m", "3m");
eq(durationText(0), "1s", "min 1s");
eq(timeLeft(-1, 0), "ended", "past");
eq(projectPath("https://www.kickstarter.com/projects/tca-labs/eldritch-playmats?ref=discovery#x"), "tca-labs/eldritch-playmats", "url");
eq(projectPath("kickstarter.com/projects/spectrumnext/zx-spectrum-next-issue-3-0/description"), "spectrumnext/zx-spectrum-next-issue-3-0", "subpage");
eq(projectPath("  flipper-devices/busy-bar "), "flipper-devices/busy-bar", "bare");
eq(projectPath("https://kck.st/3abc"), null, "short link");
eq(projectPath("hello"), null, "garbage");

console.log("\nAmount fitted into the full 72 px:");
for (const [n, cur] of [
  [0, "USD"], [7, "EUR"], [16115602, "USD"], [99999999, "USD"], [999999999, "USD"], [4.2e9, "USD"], [1.23e12, "JPY"], [9.9e13, "USD"], [1.5e9, "CHF"], [1234, "USD"], [65292, "EUR"], [999999, "GBP"], [4882784.36, "USD"], [20338986, "USD"],
  [123456789, "JPY"], [8.7e9, "KRW"], [1.2e11, "IDR"], [3.4e13, "VND"], [5e16, "USD"], [Infinity, "USD"], [NaN, "USD"], [-5, "USD"],
] as [number, string][]) {
  const m = moneyLabel(cur);
  const f = fitAmount(n, m, 72, measure);
  console.log(`${String(n).padStart(14)} ${cur}  →  ${f.text}${m.code ? " " + m.code : ""}  [${f.font}, ${f.width}px]`);
  if (f.width > 72) { failed++; console.log("  FAIL too wide"); }
}
console.log(failed ? `\n${failed} failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
