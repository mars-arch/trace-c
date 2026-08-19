/**
 * Peek-informed v3 preview (max-channel + daily budget). Not a hold-out.
 * Usage: bun run eval:v3
 */
import { writeFileSync } from "fs";
import { V3_REPORT, runV3Preview } from "../src/v3";

const report = runV3Preview();
writeFileSync(V3_REPORT, JSON.stringify(report, null, 2));

console.log("TRACE-C v3 preview — peek-informed, not a hold-out");
for (const [name, variant] of Object.entries(report.variants) as [
  string,
  {
    knobs: { combine: string; selectionMode: string };
    y2019: {
      alerts_total: number;
      known_events: { id: string; rank: number | null; alerted: boolean; lead_channel: string | null }[];
    };
    y2020: {
      alerts_total: number;
      known_events: { id: string; rank: number | null; alerted: boolean }[];
    };
  },
][]) {
  const y19 = variant.y2019.known_events
    .map((e) => `${e.id.includes("ATIYAH") ? "Atiyah" : "Blackout"}:${e.alerted ? "ALERT " : ""}r${e.rank}/${e.lead_channel}`)
    .join(" ");
  const y20 = variant.y2020.known_events
    .map((e) => `${e.id.split("-")[1]}:${e.alerted ? "ALERT " : ""}r${e.rank}`)
    .join(" ");
  console.log(
    `${name}\n  2019 alerts ${variant.y2019.alerts_total} · ${y19}\n  2020 alerts ${variant.y2020.alerts_total} · ${y20}`
  );
}
console.log("matched 2/day 2019 baselines:");
for (const row of report.matched_budget_2019) {
  console.log(
    `  ${row.detector}: alerts ${row.y2019_budget.alerts} · blackout ${row.y2019_budget.blackout.alerted ? "ALERT" : "no"} r${row.y2019_budget.blackout.rank} · atiyah ${row.y2019_budget.atiyah.alerted ? "ALERT" : "no"} r${row.y2019_budget.atiyah.rank}`
  );
}
console.log(`report → data/reports/trace-c-v3-preview.json`);
