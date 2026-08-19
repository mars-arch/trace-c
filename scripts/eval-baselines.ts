/**
 * Post-hoc baseline comparison in TRACE-C's causal data envelope. Prints the
 * table and writes data/reports/baselines-report.json.
 * Usage: bun run eval:baselines
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { buildBaselineComparisonReport } from "../src/baselines-report";

const root = join(import.meta.dir, "..");
const report = buildBaselineComparisonReport();

const fmtEvent = (e: {
  id: string;
  rank: number | null;
  best_p: number | null;
  alerted: boolean;
}) =>
  `${e.id.split("-").slice(1, 2)[0] || e.id}: ${e.alerted ? "ALERT " : ""}rank ${
    e.rank ?? "—"
  } (p=${e.best_p ?? "—"})`;

console.log(
  "=== Post-hoc causal baseline comparison (shared data envelope; different score wrappers) ===\n"
);
for (const row of [...report.baselines, report.trace_c]) {
  console.log(row.detector);
  console.log("  2019:", row.y2019.known_events.map(fmtEvent).join(" · "));
  console.log("  2020:", row.y2020.known_events.map(fmtEvent).join(" · "));
  const cal = (arr: { level: number; observed: number; expected_null: number }[]) =>
    arr.map((c) => `p≤${c.level}: ${c.observed}/${c.expected_null}`).join(" · ");
  console.log(
    "  calibration 2019:",
    cal(row.y2019.calibration),
    "| 2020 pre-COVID:",
    row.y2020.calibration_precovid ? cal(row.y2020.calibration_precovid) : "—",
    "| 2020 full:",
    cal(row.y2020.calibration)
  );
  console.log();
}

writeFileSync(
  join(root, "data/reports/baselines-report.json"),
  JSON.stringify(report, null, 2)
);
console.log("wrote data/reports/baselines-report.json");
