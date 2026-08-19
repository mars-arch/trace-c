/**
 * Rebuild the 2019 development-year report (disclosed test-informed choices).
 * Usage: bun run eval:real
 */
import { loadOrBuildRealReport } from "../src/real";

const r = loadOrBuildRealReport(true);
if ("error" in r) {
  console.error(r.error, "\n", r.hint);
  process.exit(1);
}
console.log(`TRACE-C 2019 development year — ${r.source.dataset}`);
console.log(
  `selection=${r.selection} · alerts=${r.alerts_total} vs expected null ${r.expected_null_alerts} · s_ref=${r.n_cal}`
);
console.log(
  "calibration:",
  r.calibration_check
    .map((c: { level: number; observed: number; expected_null: number }) => `p≤${c.level}: ${c.observed}/${c.expected_null}`)
    .join(" · ")
);
for (const e of r.known_events) {
  console.log(
    `${e.alerted ? "ALERTED " : "ranked  "} ${e.id} · rank ${e.best_rank_of_scored_test_windows}/${e.total_test_windows} · p=${e.best_p}`
  );
}
console.log(`report → data/reports/trace-c-real-report.json`);
