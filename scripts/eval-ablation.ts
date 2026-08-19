/**
 * 2019 development-year channel ablation (not a hold-out).
 * Usage: bun run eval:ablation
 */
import { writeFileSync } from "fs";
import { ABLATION_REPORT, runAblation2019 } from "../src/ablation";

const report = runAblation2019();
writeFileSync(ABLATION_REPORT, JSON.stringify(report, null, 2));

console.log("TRACE-C 2019 channel ablation — development year, not a hold-out");
for (const [name, variant] of Object.entries(report.variants) as [
  string,
  {
    channels: string[];
    selection: string;
    alerts_total: number;
    expected_null_alerts: number;
    known_events: { id: string; rank: number | null; alerted: boolean; lead_channel: string | null }[];
  },
][]) {
  const events = variant.known_events
    .map((e) => `${e.id.split("-")[1] ?? e.id}:${e.alerted ? "ALERT " : ""}rank ${e.rank}${e.lead_channel ? `/${e.lead_channel}` : ""}`)
    .join(" · ");
  console.log(
    `${name.padEnd(16)} ch=${variant.channels.join("+")} · ${variant.selection} · alerts ${variant.alerts_total} vs ${variant.expected_null_alerts} · ${events}`
  );
}
console.log(`report → data/reports/trace-c-ablation-2019.json`);
