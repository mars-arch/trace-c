/** Verify committed evidence against current source, inputs, and report logic. */
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { isDeepStrictEqual } from "util";
import {
  assertBaselineScoreArtifactCurrent,
  baselineTrainerSources,
  loadPinnedRuntimeVersions,
  sha256File,
  sha256Implementation,
} from "../src/baselines-eval";
import {
  BASELINE_EVALUATOR_SOURCES,
  buildBaselineComparisonReport,
} from "../src/baselines-report";
import { runHoldout2020 } from "../src/holdout";
import { runRealTraceC } from "../src/real";

const root = join(import.meta.dir, "..");

const requireEqual = (label: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) {
    throw new Error(`${label} is stale: expected ${expected}, received ${actual}`);
  }
};

export function assertReportBodyCurrent(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("baseline comparison report body is stale or tampered");
  }
}

function assertCoreReportCurrent(label: string, actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label} report body is stale or tampered`);
  }
}

function verifyPinnedSourceData(): void {
  const manifest = JSON.parse(
    readFileSync(join(root, "data/source-checksums.json"), "utf8")
  ) as {
    schema_version: number;
    files: Record<string, { bytes: number; sha256: string }>;
  };
  if (manifest.schema_version !== 1) {
    throw new Error("unsupported source checksum manifest");
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const path = join(root, relative);
    const actualBytes = statSync(path).size;
    requireEqual(`${relative} byte count`, actualBytes, expected.bytes);
    requireEqual(`${relative} sha256`, sha256File(path), expected.sha256);
  }
}

export function verifyArtifacts(): void {
  const reportPath = join(root, "data/reports/baselines-report.json");
  const scorePath = join(root, "data/reports/baseline-scores.json");
  const historyPath = join(root, "data/reports/ae-training-history.json");
  const realPath = join(root, "data/reports/trace-c-real-report.json");
  const holdoutPath = join(root, "data/reports/trace-c-holdout-report.json");
  const seriesPath = join(root, "data/real/series-export.json");

  verifyPinnedSourceData();
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const scores = JSON.parse(readFileSync(scorePath, "utf8"));
  const history = JSON.parse(readFileSync(historyPath, "utf8"));
  const real = JSON.parse(readFileSync(realPath, "utf8"));
  const holdout = JSON.parse(readFileSync(holdoutPath, "utf8"));
  const series = JSON.parse(readFileSync(seriesPath, "utf8"));

  const trainerSha256 = sha256Implementation(baselineTrainerSources(root));
  const seriesSha256 = sha256File(seriesPath);
  const evaluatorSha256 = sha256Implementation(BASELINE_EVALUATOR_SOURCES);

  assertBaselineScoreArtifactCurrent(scores, {
    trainerSha256,
    seriesSha256,
    expectedWindows: Math.floor(series.n / series.window_size),
    runtimeVersions: loadPinnedRuntimeVersions(root),
  });
  requireEqual("history trainer provenance", history.trainer_sha256, trainerSha256);
  requireEqual("history series", history.series_sha256, seriesSha256);
  requireEqual(
    "history runtime environment",
    JSON.stringify(history.versions),
    JSON.stringify(scores.versions)
  );
  requireEqual("report trainer provenance", report.score_artifact.trainer_sha256, trainerSha256);
  requireEqual("report series", report.score_artifact.series_sha256, seriesSha256);
  requireEqual("report evaluator", report.artifact_hashes.evaluator_sha256, evaluatorSha256);
  requireEqual(
    "report baseline scores",
    report.artifact_hashes.baseline_scores_sha256,
    sha256File(scorePath)
  );
  requireEqual(
    "report training history",
    report.artifact_hashes.ae_training_history_sha256,
    sha256File(historyPath)
  );
  requireEqual(
    "report TRACE-C 2019 evidence",
    report.artifact_hashes.trace_c_real_report_sha256,
    sha256File(realPath)
  );
  requireEqual(
    "report TRACE-C 2020 evidence",
    report.artifact_hashes.trace_c_holdout_report_sha256,
    sha256File(holdoutPath)
  );
  assertCoreReportCurrent("TRACE-C 2019", real, runRealTraceC());
  assertCoreReportCurrent("TRACE-C 2020", holdout, runHoldout2020());
  assertReportBodyCurrent(report, buildBaselineComparisonReport());
}

if (import.meta.main) {
  verifyArtifacts();
  console.log("artifact provenance verified");
}
