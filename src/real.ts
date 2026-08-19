/**
 * TRACE-C live test on real multi-stream operational telemetry.
 *
 * Data: NESO (National Energy System Operator) Historic Demand Data 2019 —
 * half-hourly GB grid streams, NESO Open Data Licence. Individually noisy
 * streams that are jointly informative, with documented real incidents:
 *
 *   2019-08-09 ~16:52 BST — lightning strike, Hornsea + Little Barford trip,
 *   frequency fall, ~1.1M customers disconnected (LFDD). A genuine
 *   multi-stream operational anomaly nobody injected.
 *
 * Event labels are post-hoc annotations only. Marginals use rolling
 * regime-conditioned history; the copula and AR(1) fit on Jan–Apr; everything
 * after is scored with strictly-prior references (see honesty_note in the
 * report for which choices were test-informed on 2019).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { runTraceC, type TraceCResult } from "./trace-c";

const root = join(import.meta.dir, "..");
export const REAL_CSV = join(root, "data/real/neso-demand-2019.csv");
export const REAL_REPORT = join(root, "data/reports/trace-c-real-report.json");

export const PINNED_SOURCE_FILES = [
  "data/real/neso-demand-2019.csv",
  "data/real/neso-demand-2020.csv",
  "data/real/neso-frequency-2019-agg.csv",
  "data/real/neso-frequency-2020-agg.csv",
] as const;

type SourceManifest = {
  schema_version: number;
  files: Record<string, { bytes: number; sha256: string }>;
};

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

/** Fail closed unless every retained raw input matches the pinned manifest. */
export function verifyPinnedSourceInputs(evidenceRoot = root): void {
  const manifestPath = join(evidenceRoot, "data/source-checksums.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SourceManifest;
  if (manifest.schema_version !== 1) {
    throw new Error(`unsupported source checksum manifest schema: ${manifest.schema_version}`);
  }
  for (const relative of PINNED_SOURCE_FILES) {
    const expected = manifest.files?.[relative];
    if (!expected) throw new Error(`${relative} is missing from the pinned source manifest`);
    const path = join(evidenceRoot, relative);
    if (!existsSync(path)) throw new Error(`${relative} is missing`);
    const bytes = readFileSync(path);
    if (bytes.byteLength !== expected.bytes) {
      throw new Error(
        `${relative} size mismatch: expected ${expected.bytes}, received ${bytes.byteLength}`
      );
    }
    const actual = sha256(bytes);
    if (actual !== expected.sha256) {
      throw new Error(
        `${relative} sha256 mismatch: expected ${expected.sha256}, received ${actual}`
      );
    }
  }
}

export type ReportProvenance = {
  schema_version: 1;
  generator_sources_sha256: Record<string, string>;
  source_manifest_sha256: string;
};

export function reportProvenance(
  relativeSources: readonly string[],
  evidenceRoot = root
): ReportProvenance {
  return {
    schema_version: 1,
    generator_sources_sha256: Object.fromEntries(
      [...relativeSources]
        .sort()
        .map((relative) => [relative, sha256File(join(evidenceRoot, relative))])
    ),
    source_manifest_sha256: sha256File(join(evidenceRoot, "data/source-checksums.json")),
  };
}

export function realReportProvenance(evidenceRoot = root): ReportProvenance {
  return reportProvenance(["src/trace-c.ts", "src/real.ts"], evidenceRoot);
}

export const REAL_STREAMS = [
  "ND",
  "TSD",
  "EMBEDDED_WIND_GENERATION",
  "EMBEDDED_SOLAR_GENERATION",
  "PUMP_STORAGE_PUMPING",
] as const;

// Optional 6th stream: per-settlement-period max |f − 50 Hz| aggregated from
// NESO 1-second system-frequency data (same portal, NESO Open Data Licence).
// Sensor-choice disclosure: this stream was added AFTER the demand-only
// analysis showed the 2019-08-09 event was not alert-separable — an
// event-informed choice of sensor, disclosed in honesty_note; the demand-only
// run ships alongside.
export const FREQ_STREAM = "FREQ_MAX_ABS_DEV";
export const FREQ_AGG_CSV = join(root, "data/real/neso-frequency-2019-agg.csv");

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseDate(s: string): Date {
  // "09-AUG-2019"
  const [d, mon, y] = s.split("-");
  const m = MONTHS[mon!.toUpperCase()];
  if (m == null) throw new Error(`bad date: ${s}`);
  return new Date(Date.UTC(Number(y), m, Number(d)));
}

export type RealSeries = {
  n: number;
  dates: string[]; // ISO date per row
  periods: number[]; // settlement period 1..48
  regime: number[]; // (period-1) + 48 if weekend
  streams: Record<string, number[]>;
  freq_available: boolean;
  freq_filled_cells: number; // carry-forward fills where the aggregate had no sample
};

export function loadRealSeries(
  files: { demand: string; freqAgg: string }[] = [
    { demand: REAL_CSV, freqAgg: FREQ_AGG_CSV },
  ]
): RealSeries {
  const dates: string[] = [];
  const periods: number[] = [];
  const regime: number[] = [];
  const streams: Record<string, number[]> = {};
  for (const s of REAL_STREAMS) streams[s] = [];

  for (const f of files) {
    const raw = readFileSync(f.demand, "utf8").trim().split("\n");
    const header = raw[0]!.split(",");
    const idx: Record<string, number> = {};
    header.forEach((h, i) => (idx[h.trim()] = i));
    for (const s of REAL_STREAMS) {
      if (idx[s] == null) throw new Error(`column missing in ${f.demand}: ${s}`);
    }
    for (let i = 1; i < raw.length; i++) {
      const cols = raw[i]!.split(",");
      const d = parseDate(cols[idx.SETTLEMENT_DATE!]!);
      const p = Number(cols[idx.SETTLEMENT_PERIOD!]);
      if (!Number.isFinite(p) || p < 1 || p > 50) continue; // skip DST oddities >48 defensively
      const dow = d.getUTCDay();
      const weekend = dow === 0 || dow === 6;
      dates.push(d.toISOString().slice(0, 10));
      periods.push(p);
      regime.push((Math.min(p, 48) - 1) + (weekend ? 48 : 0));
      for (const s of REAL_STREAMS) {
        const v = Number(cols[idx[s]!]);
        streams[s]!.push(Number.isFinite(v) ? v : 0);
      }
    }
  }

  // Join the optional frequency aggregates by (date, period); carry-forward
  // fill for cells the 1s data doesn't cover (month/DST edges). The stream
  // is used only if EVERY file in the set has its aggregate present.
  let freq_available = false;
  let freq_filled_cells = 0;
  if (files.every((f) => existsSync(f.freqAgg))) {
    const byKey = new Map<string, number>();
    for (const f of files) {
      const lines = readFileSync(f.freqAgg, "utf8").trim().split("\n");
      for (let i = 1; i < lines.length; i++) {
        const [d, p, , , dev] = lines[i]!.split(",");
        const v = Number(dev);
        if (Number.isFinite(v)) byKey.set(`${d}|${p}`, v);
      }
    }
    if (byKey.size > 10000) {
      const freq: number[] = [];
      let last = 0.1; // typical normal-band deviation, only until first real cell
      for (let t = 0; t < dates.length; t++) {
        const v = byKey.get(`${dates[t]}|${periods[t]}`);
        if (v != null) {
          last = v;
        } else {
          freq_filled_cells++;
        }
        freq.push(last);
      }
      streams[FREQ_STREAM] = freq;
      freq_available = true;
    }
  }
  return { n: dates.length, dates, periods, regime, streams, freq_available, freq_filled_cells };
}

function requireFrequencyForEvidence(series: RealSeries, label: string): void {
  const frequency = series.streams[FREQ_STREAM];
  if (!series.freq_available || !frequency || frequency.length !== series.n) {
    throw new Error(`${label} evidence generation requires the verified ${FREQ_STREAM} stream`);
  }
}

export const KNOWN_EVENTS = [
  {
    id: "GB-BLACKOUT-2019-08-09",
    date: "2019-08-09",
    period_from: 33,
    period_to: 48,
    label:
      "GB frequency event ~16:52 BST — lightning strike, Hornsea + Little Barford trip, LFDD disconnects ~1.1M customers; suppressed demand and rail disruption into the evening",
  },
  {
    id: "STORM-ATIYAH-2019-12-08",
    date: "2019-12-08",
    period_from: 1,
    period_to: 48,
    label: "Storm Atiyah — extreme wind across GB (secondary known event)",
  },
] as const;

// Exported so the 2020 hold-out (trace-c-holdout.ts) provably runs the
// IDENTICAL frozen configuration.
export const WINDOW = 4; // 2h of half-hourly periods
// K=40 same-regime observations (~8 weeks of weekdays): a K=20 PIT clips z
// at ±1.98, making a record-by-2GW window indistinguishable from a
// record-by-1MW one; K=60 would starve weekend regimes of burn-in until
// July (2019 has only ~34 weekend days by May). Chosen by disclosed sweep:
// K∈{20,40}×W∈{2,4} on the KNOWN event only — never on the alert list.
export const PIT_K = 40;
export const FDR_Q = 0.05;
export const BUDGET = 2;

function boundary(dates: string[], firstDateInclusive: string): number {
  const i = dates.findIndex((d) => d >= firstDateInclusive);
  return i < 0 ? dates.length : i;
}

export function runRealTraceC() {
  verifyPinnedSourceInputs();
  const series = loadRealSeries();
  requireFrequencyForEvidence(series, "2019");
  const trainEnd = boundary(series.dates, "2019-05-01");
  const calEnd = boundary(series.dates, "2019-07-01");

  const variant = (names: string[]): TraceCResult =>
    runTraceC({
      streams: Object.fromEntries(names.map((s) => [s, series.streams[s]!])),
      regime: series.regime,
      windowSize: WINDOW,
      splits: { trainEnd, calEnd },
      pitK: PIT_K,
      fdrQ: FDR_Q,
      budgetPerDay: BUDGET,
      periodsPerDay: 48,
    });

  // Two runs: demand-only (the original blind analysis) and, when the
  // frequency aggregate is present, demand+frequency. The primary display is
  // the richer sensor set; the demand-only run ships alongside as
  // `comparison` — the point is the arc, not just the best number.
  const demandRes = variant([...REAL_STREAMS]);
  const useFreq = series.freq_available;
  const res: TraceCResult = useFreq ? variant([...REAL_STREAMS, FREQ_STREAM]) : demandRes;

  const windowMeta = (w: number) => {
    const t0 = w * WINDOW;
    return {
      date: series.dates[t0]!,
      period_from: series.periods[t0]!,
      period_to: series.periods[Math.min(t0 + WINDOW - 1, series.n - 1)]!,
      // settlement period p covers (p-1)/2 .. p/2 hours UTC-ish local
      time_from: `${String(Math.floor((series.periods[t0]! - 1) / 2)).padStart(2, "0")}:${(series.periods[t0]! - 1) % 2 ? "30" : "00"}`,
    };
  };

  const matchKnown = (w: number) => {
    const t0 = w * WINDOW;
    const t1 = t0 + WINDOW - 1;
    return (
      KNOWN_EVENTS.find((e) => {
        for (let t = t0; t <= t1 && t < series.n; t++) {
          if (
            series.dates[t] === e.date &&
            series.periods[t]! >= e.period_from &&
            series.periods[t]! <= e.period_to
          ) {
            return true;
          }
        }
        return false;
      })?.id ?? null
    );
  };

  const alerts = res.alerts.map((a) => ({
    ...a,
    ...windowMeta(a.w),
    matched_known: matchKnown(a.w),
  }));

  // Compact per-variant summary for the comparison block.
  const summarize = (r: TraceCResult) => {
    const scored = r.windows.filter((x) => x.segment === "test" && x.p != null);
    const byP = [...scored].sort((a, b) => a.p! - b.p! || b.S! - a.S!);
    return {
      selection: r.selection,
      alerts_total: r.alerts.length,
      expected_null_alerts: r.expected_null_alerts,
      calibration: [0.05, 0.01].map((level) => ({
        level,
        observed: scored.filter((x) => x.p! <= level).length,
        expected_null: Number((level * scored.length).toFixed(1)),
      })),
      known_events: KNOWN_EVENTS.map((e) => {
        const i = byP.findIndex((x) => matchKnown(x.w) === e.id);
        const best = byP.find((x) => matchKnown(x.w) === e.id);
        return {
          id: e.id,
          alerted: r.alerts.some((a) => matchKnown(a.w) === e.id),
          best_p: best?.p != null ? Number(best.p.toFixed(5)) : null,
          rank: i < 0 ? null : i + 1,
          total: scored.length,
        };
      }),
    };
  };

  // Was each known event surfaced? Rank by conformal p within ALL scored
  // test windows, plus its best p — "top X% blind" is the honest claim.
  const scoredTest = res.windows.filter((x) => x.segment === "test" && x.p != null);
  const testByP = [...scoredTest].sort((a, b) => a.p! - b.p! || b.S! - a.S!);
  const testByS = [...scoredTest].sort((a, b) => b.S! - a.S!);
  const known_events = KNOWN_EVENTS.map((e) => {
    const rankP = testByP.findIndex((x) => matchKnown(x.w) === e.id);
    const best = testByP.find((x) => matchKnown(x.w) === e.id);
    const alerted = alerts.some((a) => a.matched_known === e.id);
    return {
      ...e,
      alerted,
      best_p: best?.p != null ? Number(best.p.toFixed(5)) : null,
      best_rank_of_scored_test_windows: rankP < 0 ? null : rankP + 1,
      total_test_windows: scoredTest.length,
    };
  });

  // Calibration check — the detector's own validity exhibit: under a valid
  // conformal p, observed counts at level a must track a·m on null data.
  const calibration_check = [0.05, 0.02, 0.01, 0.005].map((level) => ({
    level,
    observed: scoredTest.filter((x) => x.p! <= level).length,
    expected_null: Number((level * scoredTest.length).toFixed(1)),
  }));

  // Top-ranked windows for budgeted review (independent of the alert rule).
  const alertWs = new Set(res.alerts.map((a) => a.w));
  const top_ranked = testByP.slice(0, 8).map((x) => {
    const lead = Object.entries(x.channelsRz || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return {
      w: x.w,
      ...windowMeta(x.w),
      p: Number(x.p!.toFixed(5)),
      S: x.S!,
      lead_channel: lead,
      is_alert: alertWs.has(x.w),
      matched_known: matchKnown(x.w),
      contributing_streams: Object.entries(x.streamZ)
        .filter(([, zw]) => Math.abs(zw) >= 1.5)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([stream, zw]) => ({ stream, zw })),
    };
  });

  // Timeline for the UI: every scored test window (S, p, alert flag)
  const alertSet = new Set(alerts.map((a) => a.w));
  const timeline = res.windows
    .filter((x) => x.segment === "test" && x.S != null)
    .map((x) => ({
      w: x.w,
      date: series.dates[x.t0]!,
      S: x.S!,
      p: x.p!,
      alert: alertSet.has(x.w),
      known: matchKnown(x.w),
    }));

  // Detail traces for the top alerts + every known-event window: raw values
  // ±24 periods (12h) per stream, for the zoom chart.
  const detailFor = (w: number) => {
    const t0 = w * WINDOW;
    const from = Math.max(0, t0 - 24);
    const to = Math.min(series.n, t0 + WINDOW + 24);
    return {
      w,
      ...windowMeta(w),
      from_idx: from,
      window_from: t0,
      window_to: t0 + WINDOW - 1,
      matched_known: matchKnown(w),
      streams: REAL_STREAMS.map((s) => ({
        stream: s,
        values: series.streams[s]!.slice(from, to).map((v) => Number(v.toFixed(1))),
      })),
      labels: series.dates
        .slice(from, to)
        .map((d, i) => `${d} p${series.periods[from + i]}`),
    };
  };
  // Details for every alert row the UI renders (top 8) + all known events —
  // a rendered row with no detail is a dead click target.
  const detailWs = new Set<number>();
  for (const a of alerts.slice(0, 8)) detailWs.add(a.w);
  for (const t of top_ranked) detailWs.add(t.w);
  for (const e of KNOWN_EVENTS) {
    const hit = testByP.find((x) => matchKnown(x.w) === e.id) ?? testByS.find((x) => matchKnown(x.w) === e.id);
    if (hit) detailWs.add(hit.w);
  }
  const details = [...detailWs].map(detailFor);

  const testDays = new Set(
    res.windows.filter((x) => x.segment === "test").map((x) => series.dates[x.t0]!)
  ).size;
  const blackout = known_events.find((e) => e.id === "GB-BLACKOUT-2019-08-09")!;
  const blackoutRankPct = (
    (100 * blackout.best_rank_of_scored_test_windows!) /
    blackout.total_test_windows
  ).toFixed(1);

  return {
    provenance: realReportProvenance(),
    source: {
      dataset: "NESO Historic Demand Data 2019 (half-hourly GB grid telemetry)",
      file: "data/real/neso-demand-2019.csv",
      licence: "NESO Open Data Licence",
      attribution: "Supported by National Energy SO Open Data",
      streams: useFreq ? [...REAL_STREAMS, FREQ_STREAM] : [...REAL_STREAMS],
      rows: series.n,
    },
    frequency_stream: {
      available: useFreq,
      source: "NESO system-frequency 1-second data (NESO Open Data Licence; Supported by National Energy SO Open Data), aggregated to per-period max |f − 50 Hz|",
      filled_cells: series.freq_filled_cells,
    },
    comparison: useFreq ? { demand_only: summarize(demandRes) } : null,
    // Generated from the actual constants — a hand-written method string can
    // silently contradict the config it ships next to.
    method:
      `TRACE-C v2: rolling regime-conditioned robust-z marginals (median/MAD of last K=${PIT_K} ` +
      `same-regime obs, strictly prior, clipped ±10 — magnitude-preserving; rank-PIT clips the deep tail); ` +
      `Gaussian copula-form dependence score on robust-z residuals + AR(1) fitted on train (to 30 Apr); channels rank-normalized against a ` +
      `trailing ${res.config.rollingRefSize}-window strictly-prior reference (drift-adaptive, no ` +
      `self-inclusion); S = Fisher over channel rank-p's; conformal p vs all strictly-prior S (exact); ` +
      `BH FDR q=${FDR_Q} attempted first; when BH selects no windows, falling back to the record rule ` +
      `(S beats every prior window) — selection field says which ran; hard budget ` +
      `${BUDGET} alerts/day. Test = Jul–Dec.`,
    honesty_note:
      `The copula/AR fit ends 30 Apr and every rank reference is strictly prior to its scored window; event labels are used only for post-hoc annotation inside the detector. DISCLOSED SELECTION: W=4 and K=40 came from a small sweep (K∈{20,40}×W∈{2,4}) scored partly on the known blackout — production must fix them on train/cal only. EMPIRICAL RESULT: the blackout's best window ranks in the top ~${blackoutRankPct}% of 2019 development windows and is not separable at the operational alert rule. The final six-stream run does include FREQ_MAX_ABS_DEV, added after the demand-only analysis showed non-separability; even so, a W=4 two-hour window does not isolate this short event from sustained background extremes. The demand-only result ships in comparison. An earlier draft claimed the event was 'alerted blind'; that came from a miscalibrated fixed reference block (seasonal drift made its rank scores ~20× anti-conservative) and is retracted. MARGINAL-CHOICE DISCLOSURE: marginals were switched from rank-PIT to magnitude-preserving rolling robust-z after rank tail-clipping was identified, also an event-informed choice. The strictly-prior empirical rank counts are close to their exchangeable-null references in calibration_check, but that is a diagnostic rather than a distribution-free proof for seasonal, autocorrelated telemetry. Storm Atiyah, a sustained day-long extreme not used in tuning, ranks 1 and triggers the record alert. The detector itself never consumes event labels; the lesson is that detection depends on the sensor set and aggregation resolution as much as on the algorithm.`,
    config: {
      ...res.config,
      splits: { train: "2019-01-01..04-30", cal: "2019-05-01..06-30", test: "2019-07-01..12-31" },
      test_days: testDays,
    },
    selection: res.selection,
    fdr_pass_count: res.fdr_pass_count,
    expected_null_alerts: res.expected_null_alerts,
    budget_dropped: res.budget_dropped,
    n_cal: res.n_cal,
    conformal_floor: res.conformal_floor,
    calibration_check,
    copula_corr: { streams: res.copula.streams, corr: res.copula.corr },
    known_events,
    alerts,
    alerts_total: alerts.length,
    top_ranked,
    timeline,
    details,
  };
}

export function loadOrBuildRealReport(force = false) {
  if (!force && existsSync(REAL_REPORT)) {
    try {
      return JSON.parse(readFileSync(REAL_REPORT, "utf8"));
    } catch {
      /* rebuild */
    }
  }
  try {
    const report = runRealTraceC();
    writeFileSync(REAL_REPORT, JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    return {
      error: "TRACE-C 2019 evidence generation failed closed",
      hint: error instanceof Error ? error.message : String(error),
    };
  }
}
