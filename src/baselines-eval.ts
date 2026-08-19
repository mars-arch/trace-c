/**
 * Evaluate external baseline detectors in the same causal data envelope as
 * TRACE-C: same rows, W=4 windows, fit/test dates and event annotations. Each
 * baseline's raw score gets a growing strictly-prior rank score and record
 * selection with an exchangeable-null reference count.
 *
 * This is deliberately NOT described as an identical protocol: TRACE-C has
 * an additional trailing channel-rank/Fisher layer and BH-first/day-budgeted
 * selector. The baseline suite was also built after the 2020 results were
 * known, so its 2020 comparison is post-hoc, not a second blind hold-out.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { basename, join } from "path";

const root = join(import.meta.dir, "..");

export function baselineTrainerSources(projectRoot = root): string[] {
  return [
    join(projectRoot, "scripts/baseline_models.py"),
    join(projectRoot, "scripts/runtime_environment.py"),
    join(projectRoot, "scripts/train_baselines.py"),
    join(projectRoot, "requirements-baselines.txt"),
    join(projectRoot, ".python-version"),
    join(projectRoot, "scripts/export-series.ts"),
    join(projectRoot, "src/real.ts"),
    join(projectRoot, "src/holdout.ts"),
    join(projectRoot, "data/source-checksums.json"),
  ];
}

export type SeriesExport = {
  n: number;
  window_size: number;
  train_end_date: string;
  cal_end_date: string;
  dates: string[];
  periods: number[];
};

type KnownEvent = {
  id: string;
  dates: string[];
  period_from?: number;
  period_to?: number;
};

export const KNOWN_2019: KnownEvent[] = [
  { id: "GB-BLACKOUT-2019-08-09", dates: ["2019-08-09"], period_from: 33, period_to: 48 },
  { id: "STORM-ATIYAH-2019-12-08", dates: ["2019-12-08"] },
];
export const KNOWN_2020: KnownEvent[] = [
  { id: "STORM-CIARA-2020-02-09", dates: ["2020-02-08", "2020-02-09"] },
  { id: "STORM-DENNIS-2020-02-15", dates: ["2020-02-15", "2020-02-16"] },
  {
    id: "COVID-LOCKDOWN-2020-03-23",
    dates: Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 2, 23 + i));
      return d.toISOString().slice(0, 10);
    }),
  },
];

export type BaselineEval = {
  detector: string;
  scored_windows: number;
  y2019: SegmentEval;
  y2020: SegmentEval;
};

export type BaselineScoreArtifact = {
  schema_version: number;
  trainer_sha256: string;
  series_sha256: string;
  n_windows: number;
  versions?: Record<string, string>;
  scores: Record<string, (number | null)[]>;
};

export type PinnedRuntimeVersions = {
  python: string;
  numpy: string;
  torch: string;
  scikit_learn: string;
};

export function loadPinnedRuntimeVersions(projectRoot = root): PinnedRuntimeVersions {
  const python = readFileSync(join(projectRoot, ".python-version"), "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/.test(python)) {
    throw new Error(".python-version must contain one exact X.Y.Z version");
  }
  const requirements = readFileSync(
    join(projectRoot, "requirements-baselines.txt"),
    "utf8"
  );
  const pins = new Map<string, string>();
  for (const raw of requirements.split(/\r?\n/)) {
    const line = raw.split("#", 1)[0]!.trim();
    const match = /^([A-Za-z0-9_.-]+)\s*==\s*([^\s;]+)$/.exec(line);
    if (match) pins.set(match[1]!.toLowerCase().replace(/[_.]+/g, "-"), match[2]!);
  }
  const requirePin = (name: string) => {
    const value = pins.get(name);
    if (!value) throw new Error(`requirements-baselines.txt must exactly pin ${name}`);
    return value;
  };
  return {
    python,
    numpy: requirePin("numpy"),
    torch: requirePin("torch"),
    scikit_learn: requirePin("scikit-learn"),
  };
}

export function assertBaselineScoreArtifactCurrent(
  artifact: BaselineScoreArtifact,
  current: {
    trainerSha256: string;
    seriesSha256: string;
    expectedWindows: number;
    runtimeVersions?: PinnedRuntimeVersions;
  }
): void {
  if (artifact.schema_version !== 2) {
    throw new Error("baseline scores are stale: unsupported artifact schema");
  }
  if (artifact.trainer_sha256 !== current.trainerSha256) {
    throw new Error("baseline scores are stale: trainer implementation changed");
  }
  if (artifact.series_sha256 !== current.seriesSha256) {
    throw new Error("baseline scores are stale: exported input series changed");
  }
  if (artifact.n_windows !== current.expectedWindows) {
    throw new Error("baseline scores are stale: window count changed");
  }
  if (
    current.runtimeVersions &&
    Object.entries(current.runtimeVersions).some(
      ([name, version]) => artifact.versions?.[name] !== version
    )
  ) {
    throw new Error("baseline scores are stale: runtime environment changed");
  }
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Implementation(paths: string[]): string {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(basename(path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

type SegmentEval = {
  windows: number;
  selection: "record_rule_no_daily_budget";
  record_alerts: number;
  expected_null_alerts: number;
  null_reference_assumption: "exchangeable_scores";
  calibration: { level: number; observed: number; expected_null: number }[];
  calibration_precovid?: { level: number; observed: number; expected_null: number }[];
  known_events: {
    id: string;
    rank: number | null;
    best_p: number | null;
    alerted: boolean;
    matched_windows: number;
    best_window: { w: number; date: string; period_from: number } | null;
  }[];
};

export type BaselineScoredWindow = {
  w: number;
  p: number;
  pFloor: number;
  score: number;
};

export function rankBaselineWindows(
  scored: BaselineScoredWindow[]
): BaselineScoredWindow[] {
  return [...scored].sort((a, b) => a.p - b.p || b.score - a.score || a.w - b.w);
}

/** Keep the `budget` lowest-p windows in each periodsPerDay block. */
export function applyDailyBudget(
  scored: BaselineScoredWindow[],
  t0Of: (w: number) => number,
  budget: number,
  periodsPerDay: number
): Set<number> {
  if (budget < 1) throw new Error("budget must be at least 1");
  const byDay = new Map<number, BaselineScoredWindow[]>();
  for (const window of scored) {
    const day = Math.floor(t0Of(window.w) / periodsPerDay);
    const arr = byDay.get(day) ?? [];
    arr.push(window);
    byDay.set(day, arr);
  }
  const kept = new Set<number>();
  for (const arr of byDay.values()) {
    arr.sort((a, b) => a.p - b.p || b.score - a.score || a.w - b.w);
    for (const window of arr.slice(0, budget)) kept.add(window.w);
  }
  return kept;
}

/**
 * Apply the baseline suite's shared growing, strictly-prior conformal layer.
 *
 * Scores from windows that contain any model-fit observations are excluded
 * from both scoring and the reference. This matters when a calendar split is
 * not divisible by W: admitting the boundary window would leak in-sample
 * reconstruction scores into every later p-value.
 */
export function conformalizeBaselineScores(
  exp: SeriesExport,
  raw: (number | null)[],
  sRefMin = 40
): BaselineScoredWindow[] {
  const W = exp.window_size;
  const expectedWindows = Math.floor(exp.n / W);
  if (raw.length !== expectedWindows) {
    throw new Error(`expected ${expectedWindows} window scores, received ${raw.length}`);
  }
  const trainEnd = exp.dates.findIndex((d) => d >= exp.train_end_date);
  if (trainEnd < 0) {
    throw new Error(`train_end_date ${exp.train_end_date} is outside the exported series`);
  }
  const prior: number[] = [];
  const countGE = (v: number) => {
    let lo = 0;
    let hi = prior.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prior[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return prior.length - lo;
  };
  const insert = (v: number) => {
    let lo = 0;
    let hi = prior.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prior[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    prior.splice(lo, 0, v);
  };

  const scored: BaselineScoredWindow[] = [];
  for (let w = 0; w < raw.length; w++) {
    const v = raw[w];
    if (v == null || !Number.isFinite(v)) continue;
    if (w * W < trainEnd) continue;
    if (prior.length >= sRefMin) {
      scored.push({
        w,
        p: (1 + countGE(v)) / (prior.length + 1),
        pFloor: 1 / (prior.length + 1),
        score: v,
      });
    }
    insert(v);
  }
  return scored;
}

export function evaluateBaselines() {
  const seriesPath = join(root, "data/real/series-export.json");
  const exp = JSON.parse(readFileSync(seriesPath, "utf8")) as SeriesExport;
  const scoresFile = JSON.parse(
    readFileSync(join(root, "data/reports/baseline-scores.json"), "utf8")
  ) as BaselineScoreArtifact;

  assertBaselineScoreArtifactCurrent(scoresFile, {
    trainerSha256: sha256Implementation(baselineTrainerSources()),
    seriesSha256: sha256File(seriesPath),
    expectedWindows: Math.floor(exp.n / exp.window_size),
    runtimeVersions: loadPinnedRuntimeVersions(),
  });

  const W = exp.window_size;
  const calEnd = exp.dates.findIndex((d) => d >= exp.cal_end_date);
  const dateOf = (w: number) => exp.dates[w * W]!;
  const matchKnown = (w: number, events: KnownEvent[]): string | null => {
    const t0 = w * W;
    const t1 = t0 + W - 1;
    for (const e of events) {
      for (let t = t0; t <= t1 && t < exp.n; t++) {
        if (!e.dates.includes(exp.dates[t]!)) continue;
        const p = exp.periods[t]!;
        if ((e.period_from ?? 1) <= p && p <= (e.period_to ?? 50)) return e.id;
      }
    }
    return null;
  };

  const S_REF_MIN = 40; // same warm-up as the frozen protocol

  const evalOne = (name: string, raw: (number | null)[]): BaselineEval => {
    const scored = conformalizeBaselineScores(exp, raw, S_REF_MIN);

    const calibOn = (set: BaselineScoredWindow[], from: string, to: string) => {
      const sub = set.filter((x) => dateOf(x.w) >= from && dateOf(x.w) <= to);
      return [0.05, 0.01].map((level) => ({
        level,
        observed: sub.filter((x) => x.p <= level).length,
        expected_null: Number((level * sub.length).toFixed(1)),
      }));
    };

    const seg = (from: string, to: string, events: KnownEvent[]): SegmentEval => {
      const inSeg = scored.filter(
        (x) => dateOf(x.w) >= from && dateOf(x.w) <= to && x.w * W >= calEnd
      );
      const byP = rankBaselineWindows(inSeg);
      const records = inSeg.filter((x) => x.p <= x.pFloor + 1e-15);
      const out: SegmentEval = {
        windows: inSeg.length,
        selection: "record_rule_no_daily_budget",
        record_alerts: records.length,
        expected_null_alerts: Number(inSeg.reduce((a, x) => a + x.pFloor, 0).toFixed(2)),
        null_reference_assumption: "exchangeable_scores",
        calibration: calibOn(inSeg, from, to),
        known_events: events.map((e) => {
          const i = byP.findIndex((x) => matchKnown(x.w, events) === e.id);
          const best = byP.find((x) => matchKnown(x.w, events) === e.id);
          const matched = inSeg.filter((x) => matchKnown(x.w, events) === e.id);
          return {
            id: e.id,
            rank: i < 0 ? null : i + 1,
            best_p: best ? Number(best.p.toFixed(5)) : null,
            alerted: records.some((x) => matchKnown(x.w, events) === e.id),
            matched_windows: matched.length,
            best_window: best
              ? { w: best.w, date: dateOf(best.w), period_from: exp.periods[best.w * W]! }
              : null,
          };
        }),
      };
      if (from.startsWith("2020")) {
        out.calibration_precovid = calibOn(inSeg, "2020-01-01", "2020-03-15");
      }
      return out;
    };

    return {
      detector: name,
      scored_windows: scored.length,
      y2019: seg("2019-07-01", "2019-12-31", KNOWN_2019),
      y2020: seg("2020-01-01", "2020-12-31", KNOWN_2020),
    };
  };

  return Object.entries(scoresFile.scores).map(([name, raw]) => evalOne(name, raw));
}
