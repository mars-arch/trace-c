/**
 * TRACE-C 2020 HOLD-OUT — the untainted validation.
 *
 * Every hyperparameter, sensor and marginal choice in trace-c-real.ts was
 * made while looking at 2019 (disclosed there). This module runs the frozen
 * method — identical constants, identical code path — continuously through
 * 2020, which informed nothing:
 *
 *   copula/AR fit:        Jan–Apr 2019 (unchanged)
 *   rolling references:   trail across the 2019→2020 boundary (their job)
 *   scored blind:         all of 2020
 *
 * 2020's documented real events (post-hoc annotation ONLY): Storm Ciara,
 * Storm Dennis, and the COVID-19 first-lockdown demand collapse — the
 * largest operational regime change in GB grid history. Calibration is
 * reported on pre-COVID 2020 separately: after 23 Mar the data is genuinely
 * anomalous, so excess over expected there is signal, not miscalibration.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { runTraceC, type TraceCResult, type TraceCWindow } from "./trace-c";
import {
  BUDGET,
  FDR_Q,
  FREQ_AGG_CSV,
  FREQ_STREAM,
  loadRealSeries,
  PIT_K,
  REAL_CSV,
  REAL_STREAMS,
  WINDOW,
  type RealSeries,
} from "./real";

const root = join(import.meta.dir, "..");
export const DEMAND_2020 = join(root, "data/real/neso-demand-2020.csv");
export const FREQ_2020 = join(root, "data/real/neso-frequency-2020-agg.csv");
export const HOLDOUT_REPORT = join(root, "data/reports/trace-c-holdout-report.json");

export const KNOWN_EVENTS_2020 = [
  {
    id: "STORM-CIARA-2020-02-09",
    dates: ["2020-02-08", "2020-02-09"],
    label: "Storm Ciara — extreme wind across GB, record wind share",
  },
  {
    id: "STORM-DENNIS-2020-02-15",
    dates: ["2020-02-15", "2020-02-16"],
    label: "Storm Dennis — second extreme-wind weekend in a row",
  },
  {
    id: "COVID-LOCKDOWN-2020-03-23",
    dates: [
      "2020-03-23",
      "2020-03-24",
      "2020-03-25",
      "2020-03-26",
      "2020-03-27",
      "2020-03-28",
      "2020-03-29",
      "2020-03-30",
      "2020-03-31",
      "2020-04-01",
      "2020-04-02",
      "2020-04-03",
      "2020-04-04",
      "2020-04-05",
    ],
    label: "COVID-19 first UK lockdown onset — sustained demand collapse (~15–20% below normal)",
  },
] as const;

export function runHoldout2020() {
  if (!existsSync(DEMAND_2020)) {
    return { error: "2020 demand file missing", hint: "download demanddata_2020.csv into data/real/" };
  }
  const series: RealSeries = loadRealSeries([
    { demand: REAL_CSV, freqAgg: FREQ_AGG_CSV },
    { demand: DEMAND_2020, freqAgg: FREQ_2020 },
  ]);
  const trainEnd = series.dates.findIndex((d) => d >= "2019-05-01");
  const calEnd = series.dates.findIndex((d) => d >= "2019-07-01");
  const names = series.freq_available ? [...REAL_STREAMS, FREQ_STREAM] : [...REAL_STREAMS];

  // FROZEN configuration — must match trace-c-real.ts's variant() exactly.
  const res: TraceCResult = runTraceC({
    streams: Object.fromEntries(names.map((s) => [s, series.streams[s]!])),
    regime: series.regime,
    windowSize: WINDOW,
    splits: { trainEnd, calEnd },
    pitK: PIT_K,
    fdrQ: FDR_Q,
    budgetPerDay: BUDGET,
    periodsPerDay: 48,
  });

  const dateOf = (w: number) => series.dates[w * WINDOW]!;
  const is2020 = (w: number) => dateOf(w) >= "2020-01-01";
  const windowMeta = (w: number) => {
    const t0 = w * WINDOW;
    const p0 = series.periods[t0]!;
    return {
      date: series.dates[t0]!,
      period_from: p0,
      period_to: series.periods[Math.min(t0 + WINDOW - 1, series.n - 1)]!,
      time_from: `${String(Math.floor((p0 - 1) / 2)).padStart(2, "0")}:${(p0 - 1) % 2 ? "30" : "00"}`,
    };
  };
  const matchKnown = (w: number): string | null => {
    const d = dateOf(w);
    return KNOWN_EVENTS_2020.find((e) => (e.dates as readonly string[]).includes(d))?.id ?? null;
  };

  const scored2020 = res.windows.filter((x) => x.segment === "test" && x.p != null && is2020(x.w));
  const byP = [...scored2020].sort((a, b) => a.p! - b.p! || b.S! - a.S!);

  const alerts2020 = res.alerts
    .filter((a) => is2020(a.w))
    .map((a) => ({ ...a, ...windowMeta(a.w), matched_known: matchKnown(a.w) }));

  const expectedNull2020 = Number(
    scored2020.reduce((acc, x) => acc + ((x as TraceCWindow).pFloor ?? 0), 0).toFixed(2)
  );

  const calibOn = (from: string, to: string) => {
    const set = scored2020.filter((x) => dateOf(x.w) >= from && dateOf(x.w) <= to);
    return [0.05, 0.01].map((level) => ({
      level,
      observed: set.filter((x) => x.p! <= level).length,
      expected_null: Number((level * set.length).toFixed(1)),
      windows: set.length,
    }));
  };

  const known_events = KNOWN_EVENTS_2020.map((e) => {
    const i = byP.findIndex((x) => matchKnown(x.w) === e.id);
    const best = byP.find((x) => matchKnown(x.w) === e.id);
    return {
      id: e.id,
      label: e.label,
      alerted: alerts2020.some((a) => a.matched_known === e.id),
      best_p: best?.p != null ? Number(best.p.toFixed(6)) : null,
      best_rank: i < 0 ? null : i + 1,
      total_2020_windows: scored2020.length,
      best_window: best ? windowMeta(best.w) : null,
    };
  });

  const alertSet = new Set(alerts2020.map((a) => a.w));
  const timeline = scored2020.map((x) => ({
    w: x.w,
    date: dateOf(x.w),
    S: x.S!,
    p: Number(x.p!.toFixed(6)),
    alert: alertSet.has(x.w),
    known: matchKnown(x.w),
  }));

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
      streams: names.map((s) => ({
        stream: s,
        values: series.streams[s]!.slice(from, to).map((v) => Number(v.toFixed(1))),
      })),
      labels: series.dates.slice(from, to).map((d, i) => `${d} p${series.periods[from + i]}`),
    };
  };
  const detailWs = new Set<number>();
  for (const a of alerts2020.slice(0, 8)) detailWs.add(a.w);
  for (const e of KNOWN_EVENTS_2020) {
    const hit = byP.find((x) => matchKnown(x.w) === e.id);
    if (hit) detailWs.add(hit.w);
  }

  const top_ranked = byP.slice(0, 8).map((x) => ({
    w: x.w,
    ...windowMeta(x.w),
    p: Number(x.p!.toFixed(6)),
    S: x.S!,
    lead_channel:
      Object.entries(x.channelsRz || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    is_alert: alertSet.has(x.w),
    matched_known: matchKnown(x.w),
    contributing_streams: Object.entries(x.streamZ)
      .filter(([, zw]) => Math.abs(zw) >= 1.5)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([stream, zw]) => ({ stream, zw })),
  }));
  for (const t of top_ranked) detailWs.add(t.w);

  return {
    generated_at: new Date().toISOString(),
    frozen_note:
      "HOLD-OUT: method and configuration are byte-identical to the 2019 run (commit-frozen). Nothing about 2020 — data, events, results — informed any hyperparameter, sensor, marginal or selection-rule choice. Copula/AR fitted Jan–Apr 2019; rolling references trail across the year boundary; all of 2020 is scored blind. 2020 event labels are post-hoc annotations only.",
    covid_note:
      "Calibration is reported on pre-COVID 2020 (01 Jan–15 Mar) separately: from 23 Mar the grid genuinely was anomalous for months (first lockdown), so excess over expected in that span is detected signal, not miscalibration.",
    config: {
      windowSize: WINDOW,
      pitK: PIT_K,
      fdrQ: FDR_Q,
      budgetPerDay: BUDGET,
      rollingRefSize: res.config.rollingRefSize,
      sRefMin: res.config.sRefMin,
      streams: names,
      fit: "2019-01-01..2019-04-30",
      scored_blind: "2020-01-01..2020-12-31",
    },
    selection: res.selection,
    alerts_total_2020: alerts2020.length,
    expected_null_alerts_2020: expectedNull2020,
    budget_dropped_full_span: res.budget_dropped,
    calibration_check_precovid: calibOn("2020-01-01", "2020-03-15"),
    calibration_check_full_2020: calibOn("2020-01-01", "2020-12-31"),
    known_events,
    alerts: alerts2020.slice(0, 30),
    top_ranked,
    timeline,
    details: [...detailWs].map(detailFor),
  };
}

export function loadOrBuildHoldoutReport(force = false) {
  if (!force && existsSync(HOLDOUT_REPORT)) {
    try {
      return JSON.parse(readFileSync(HOLDOUT_REPORT, "utf8"));
    } catch {
      /* rebuild */
    }
  }
  const report = runHoldout2020();
  if (!("error" in report)) writeFileSync(HOLDOUT_REPORT, JSON.stringify(report, null, 2));
  return report;
}
