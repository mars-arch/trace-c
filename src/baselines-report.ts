/** Build the deterministic, post-hoc baseline comparison evidence object. */
import { readFileSync } from "fs";
import { join } from "path";
import {
  evaluateBaselines,
  sha256File,
  sha256Implementation,
} from "./baselines-eval";

const root = join(import.meta.dir, "..");

export const BASELINE_EVALUATOR_SOURCES = [
  join(root, "src/baselines-eval.ts"),
  join(root, "src/baselines-report.ts"),
  join(root, "scripts/eval-baselines.ts"),
];

export function buildBaselineComparisonReport() {
  const rows = evaluateBaselines();
  const scorePath = join(root, "data/reports/baseline-scores.json");
  const historyPath = join(root, "data/reports/ae-training-history.json");
  const realPath = join(root, "data/reports/trace-c-real-report.json");
  const holdoutPath = join(root, "data/reports/trace-c-holdout-report.json");
  const scoreArtifact = JSON.parse(readFileSync(scorePath, "utf8"));
  const real = JSON.parse(readFileSync(realPath, "utf8"));
  const hold = JSON.parse(readFileSync(holdoutPath, "utf8"));

  const traceC = {
    detector: "trace_c (ours)",
    y2019: {
      windows: real.timeline.length,
      selection: real.selection,
      alerts: real.alerts_total,
      expected_null_alerts: real.expected_null_alerts,
      budget_dropped: real.budget_dropped,
      known_events: real.known_events.map(
        (e: {
          id: string;
          best_rank_of_scored_test_windows: number;
          best_p: number;
          alerted: boolean;
        }) => ({
          id: e.id,
          rank: e.best_rank_of_scored_test_windows,
          best_p: e.best_p,
          alerted: e.alerted,
        })
      ),
      calibration: real.calibration_check.filter(
        (c: { level: number }) => c.level === 0.05 || c.level === 0.01
      ),
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

  return {
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
    artifact_hashes: {
      evaluator_sha256: sha256Implementation(BASELINE_EVALUATOR_SOURCES),
      baseline_scores_sha256: sha256File(scorePath),
      ae_training_history_sha256: sha256File(historyPath),
      trace_c_real_report_sha256: sha256File(realPath),
      trace_c_holdout_report_sha256: sha256File(holdoutPath),
    },
    baselines: rows,
    trace_c: traceC,
  };
}
