/**
 * Post-hoc baseline comparison in TRACE-C's causal data envelope. Prints the table and writes
 * data/reports/baselines-report.json (TRACE-C rows pulled from its reports).
 * Usage: bun run eval:baselines
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { evaluateBaselines } from "../src/baselines-eval";

const root = join(import.meta.dir, "..");
const rows = evaluateBaselines();
const scoreArtifact = JSON.parse(
  readFileSync(join(root, "data/reports/baseline-scores.json"), "utf8")
);

// TRACE-C reference rows from its own reports (same protocol by construction)
const real = JSON.parse(readFileSync(join(root, "data/reports/trace-c-real-report.json"), "utf8"));
const hold = JSON.parse(readFileSync(join(root, "data/reports/trace-c-holdout-report.json"), "utf8"));
const traceC = {
  detector: "trace_c (ours)",
  y2019: {
    windows: real.timeline.length,
    selection: real.selection,
    alerts: real.alerts_total,
    expected_null_alerts: real.expected_null_alerts,
    budget_dropped: real.budget_dropped,
    known_events: real.known_events.map(
      (e: { id: string; best_rank_of_scored_test_windows: number; best_p: number; alerted: boolean }) => ({
        id: e.id,
        rank: e.best_rank_of_scored_test_windows,
        best_p: e.best_p,
        alerted: e.alerted,
      })
    ),
    calibration: real.calibration_check.filter((c: { level: number }) => c.level === 0.05 || c.level === 0.01),
  },
  y2020: {
    windows: hold.timeline.length,
    selection: hold.selection,
    alerts: hold.alerts_total_2020,
    expected_null_alerts: hold.expected_null_alerts_2020,
    budget_dropped_full_span: hold.budget_dropped_full_span,
    known_events: hold.known_events.map(
      (e: { id: string; best_rank: number; best_p: number; alerted: boolean }) => ({
        id: e.id,
        rank: e.best_rank,
        best_p: e.best_p,
        alerted: e.alerted,
      })
    ),
    calibration: hold.calibration_check_full_2020,
    calibration_precovid: hold.calibration_check_precovid,
  },
};

const fmtEvent = (e: { id: string; rank: number | null; best_p: number | null; alerted: boolean }) =>
  `${e.id.split("-").slice(1, 2)[0] || e.id}: ${e.alerted ? "ALERT " : ""}rank ${e.rank ?? "—"} (p=${e.best_p ?? "—"})`;

console.log("=== Post-hoc causal baseline comparison (shared data envelope; different score wrappers) ===\n");
for (const r of [...rows, null]) {
  const row = r ?? (traceC as unknown as (typeof rows)[number]);
  console.log(row.detector);
  console.log("  2019:", row.y2019.known_events.map(fmtEvent).join(" · "));
  console.log("  2020:", row.y2020.known_events.map(fmtEvent).join(" · "));
  const cal = (arr: { level: number; observed: number; expected_null: number }[]) =>
    arr.map((c) => `p≤${c.level}: ${c.observed}/${c.expected_null}`).join(" · ");
  const y20 = row.y2020 as typeof row.y2020 & {
    calibration_precovid?: { level: number; observed: number; expected_null: number }[];
  };
  console.log(
    "  calibration 2019:",
    cal(row.y2019.calibration),
    "| 2020 pre-COVID:",
    y20.calibration_precovid ? cal(y20.calibration_precovid) : "—",
    "| 2020 full:",
    cal(row.y2020.calibration)
  );
  console.log();
}

writeFileSync(
  join(root, "data/reports/baselines-report.json"),
  JSON.stringify(
    {
      protocol:
        "Post-hoc comparison on the same aligned series, W=4 windows, Jan-Apr 2019 fit cutoff, Jul-Dec 2019 development segment, 2020 segment and event annotations as TRACE-C. Baseline raw scores use a growing strictly-prior rank score after a 40-window post-fit warm-up, then record-rule selection without a daily budget. Counts labelled expected_null assume exchangeable scores and are diagnostics, not a proof under seasonality/autocorrelation. TRACE-C differs: trailing 240-window channel ranks, Fisher combination, a growing outer rank, BH-first fallback, and a 2/day budget. Baselines use global train standardization (regime-naive by design). conv_ae = Keras-io-style time-series autoencoder ported to Torch (seed 42, fixed 40 epochs); PCA k=3; IsolationForest(200, seed 42) on window mean/std features; Spectral Residual recomputed from trailing context ending at every window.",
      provenance:
        "TRACE-C's 2020 result was commit-frozen before inspection. The external baseline suite was created after those results were visible; its 2019/2020 rows are therefore post-hoc comparisons, not blind validations.",
      comparability:
        "Shared: source rows, sensor set, window size, fit/test dates, causal scoring, event definitions, strictly-prior ranking. Different: model-specific score construction, reference admission, TRACE-C's rolling/Fisher layer, BH attempt and daily budget.",
      score_artifact: {
        schema_version: scoreArtifact.schema_version,
        seed: scoreArtifact.seed,
        series_sha256: scoreArtifact.series_sha256,
        trainer_sha256: scoreArtifact.trainer_sha256,
        versions: scoreArtifact.versions,
        n_windows: scoreArtifact.n_windows,
      },
      baselines: rows,
      trace_c: traceC,
    },
    null,
    2
  )
);
console.log("wrote data/reports/baselines-report.json");
