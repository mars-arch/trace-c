/**
 * Rebuild the 2020 hold-out report (frozen method, fully blind year).
 * Usage: bun run eval:holdout
 */
import { loadOrBuildHoldoutReport } from "../src/holdout";

const r = loadOrBuildHoldoutReport(true);
if ("error" in r) {
  console.error(r.error, "\n", r.hint);
  process.exit(1);
}
console.log("TRACE-C 2020 HOLD-OUT (frozen method, scored blind)");
console.log(
  `2020 alerts=${r.alerts_total_2020} vs expected null ${r.expected_null_alerts_2020} (${r.selection})`
);
console.log(
  "calibration pre-COVID:",
  r.calibration_check_precovid
    .map((c: { level: number; observed: number; expected_null: number }) => `p≤${c.level}: ${c.observed}/${c.expected_null}`)
    .join(" · ")
);
for (const e of r.known_events) {
  console.log(
    `${e.alerted ? "ALERTED " : "ranked  "} ${e.id} · rank ${e.best_rank}/${e.total_2020_windows} · p=${e.best_p}`
  );
}
console.log(`report → data/reports/trace-c-holdout-report.json`);
