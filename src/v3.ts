/**
 * Disclosed v3 preview: max-channel combine + daily budget.
 *
 * Designed after the 2019 ablation (Fisher buries the blackout; record rule
 * misses Atiyah-without-copula) and after seeing 2020 record saturation.
 * Not a hold-out. Frozen v2 reports are unchanged.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  applyDailyBudget,
  conformalizeBaselineScores,
  evaluateBaselines,
} from "./baselines-eval";
import { HOLDOUT_REPORT, KNOWN_EVENTS_2020 } from "./holdout";
import {
  BUDGET,
  FDR_Q,
  FREQ_AGG_CSV,
  FREQ_STREAM,
  KNOWN_EVENTS,
  PIT_K,
  REAL_CSV,
  REAL_STREAMS,
  WINDOW,
  loadRealSeries,
  reportProvenance,
  verifyPinnedSourceInputs,
} from "./real";
import { runTraceC, type TraceCInput, type TraceCResult } from "./trace-c";

const root = join(import.meta.dir, "..");
export const V3_REPORT = join(root, "data/reports/trace-c-v3-preview.json");

const DEMAND_2020 = join(root, "data/real/neso-demand-2020.csv");
const FREQ_2020 = join(root, "data/real/neso-frequency-2020-agg.csv");

type V3Knobs = Pick<TraceCInput, "combine" | "selectionMode" | "pGate">;

const VARIANTS: Record<string, V3Knobs> = {
  v2_fisher_record: {},
  v3_fisher_budget_p01: { selectionMode: "daily_budget", pGate: 0.01 },
  v3_max_channel_budget_p01: {
    combine: "max_channel",
    selectionMode: "daily_budget",
    pGate: 0.01,
  },
};

function eventSummary(
  res: TraceCResult,
  matchKnown: (w: number) => string | null,
  ids: readonly { id: string }[],
  inSegment: (w: number) => boolean
) {
  const scored = res.windows.filter((x) => x.segment === "test" && x.p != null && inSegment(x.w));
  const byP = [...scored].sort((a, b) => a.p! - b.p! || b.S! - a.S!);
  const alerted = new Set(res.alerts.filter((a) => inSegment(a.w)).map((a) => a.w));
  return {
    selection: res.selection,
    alerts_total: res.alerts.filter((a) => inSegment(a.w)).length,
    expected_null_alerts: res.expected_null_alerts,
    known_events: ids.map((e) => {
      const i = byP.findIndex((x) => matchKnown(x.w) === e.id);
      const best = byP.find((x) => matchKnown(x.w) === e.id);
      const lead =
        best?.channelsRz &&
        Object.entries(best.channelsRz).sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        id: e.id,
        rank: i < 0 ? null : i + 1,
        alerted: best ? alerted.has(best.w) : false,
        best_p: best?.p != null ? Number(best.p.toFixed(5)) : null,
        lead_channel: lead ?? null,
      };
    }),
  };
}

export function runV3Preview() {
  verifyPinnedSourceInputs();
  const series2019 = loadRealSeries();
  const seriesBoth = loadRealSeries([
    { demand: REAL_CSV, freqAgg: FREQ_AGG_CSV },
    { demand: DEMAND_2020, freqAgg: FREQ_2020 },
  ]);
  if (!series2019.freq_available || !seriesBoth.freq_available) {
    throw new Error("v3 preview requires the verified frequency stream");
  }

  const names = [...REAL_STREAMS, FREQ_STREAM];
  const trainEnd2019 = series2019.dates.findIndex((d) => d >= "2019-05-01");
  const calEnd2019 = series2019.dates.findIndex((d) => d >= "2019-07-01");
  const trainEndBoth = seriesBoth.dates.findIndex((d) => d >= "2019-05-01");
  const calEndBoth = seriesBoth.dates.findIndex((d) => d >= "2019-07-01");

  const match2019 = (w: number) => {
    const t0 = w * WINDOW;
    const t1 = t0 + WINDOW - 1;
    return (
      KNOWN_EVENTS.find((e) => {
        for (let t = t0; t <= t1 && t < series2019.n; t++) {
          if (
            series2019.dates[t] === e.date &&
            series2019.periods[t]! >= e.period_from &&
            series2019.periods[t]! <= e.period_to
          ) {
            return true;
          }
        }
        return false;
      })?.id ?? null
    );
  };
  const match2020 = (w: number) => {
    const d = seriesBoth.dates[w * WINDOW]!;
    return KNOWN_EVENTS_2020.find((e) => (e.dates as readonly string[]).includes(d))?.id ?? null;
  };

  const run = (
    series: ReturnType<typeof loadRealSeries>,
    trainEnd: number,
    calEnd: number,
    knobs: V3Knobs
  ) =>
    runTraceC({
      streams: Object.fromEntries(names.map((s) => [s, series.streams[s]!])),
      regime: series.regime,
      windowSize: WINDOW,
      splits: { trainEnd, calEnd },
      pitK: PIT_K,
      fdrQ: FDR_Q,
      budgetPerDay: BUDGET,
      periodsPerDay: 48,
      ...knobs,
    });

  const variants = Object.fromEntries(
    Object.entries(VARIANTS).map(([name, knobs]) => {
      const y2019 = run(series2019, trainEnd2019, calEnd2019, knobs);
      const y2020 = run(seriesBoth, trainEndBoth, calEndBoth, knobs);
      return [
        name,
        {
          knobs: {
            combine: knobs.combine ?? "fisher",
            selectionMode: knobs.selectionMode ?? "bh_then_record",
            pGate: knobs.pGate ?? null,
          },
          y2019: eventSummary(y2019, match2019, KNOWN_EVENTS, () => true),
          y2020: eventSummary(
            y2020,
            match2020,
            KNOWN_EVENTS_2020,
            (w) => seriesBoth.dates[w * WINDOW]! >= "2020-01-01"
          ),
        },
      ];
    })
  );

  const frozen = JSON.parse(readFileSync(HOLDOUT_REPORT, "utf8")) as {
    alerts_total_2020: number;
  };
  const baselineRows = evaluateBaselines();
  const matched = baselineRows.map((row) => {
    const y2019 = row.y2019;
    const y2020 = row.y2020;
    return {
      detector: row.detector,
      y2019: {
        blackout_rank: y2019.known_events.find((e) => e.id.includes("BLACKOUT"))?.rank ?? null,
        atiyah_rank: y2019.known_events.find((e) => e.id.includes("ATIYAH"))?.rank ?? null,
        record_alerted: y2019.known_events.map((e) => ({ id: e.id, alerted: e.alerted, rank: e.rank })),
      },
      y2020: {
        record_alerted: y2020.known_events.map((e) => ({ id: e.id, alerted: e.alerted, rank: e.rank })),
      },
    };
  });

  const exp = JSON.parse(readFileSync(join(root, "data/real/series-export.json"), "utf8")) as {
    window_size: number;
    n: number;
    dates: string[];
  };
  const scores = JSON.parse(
    readFileSync(join(root, "data/reports/baseline-scores.json"), "utf8")
  ) as { scores: Record<string, (number | null)[]> };

  const matchedBudget = Object.entries(scores.scores).map(([detector, raw]) => {
    const scored = conformalizeBaselineScores(
      {
        n: exp.n,
        window_size: exp.window_size,
        train_end_date: "2019-05-01",
        cal_end_date: "2019-07-01",
        dates: exp.dates,
        periods: Array(exp.n).fill(1),
      },
      raw
    );
    const test2019 = scored.filter((x) => {
      const d = exp.dates[x.w * exp.window_size]!;
      return d >= "2019-07-01" && d <= "2019-12-31";
    });
    const gated = test2019.filter((x) => x.p <= 0.01);
    const kept = applyDailyBudget(gated, (w) => w * exp.window_size, BUDGET, 48);
    const hit = (id: string, dates: string[]) => {
      const windows = test2019.filter((x) => dates.includes(exp.dates[x.w * exp.window_size]!));
      const best = [...windows].sort((a, b) => a.p - b.p || b.score - a.score)[0];
      if (!best) return { id, rank: null, alerted: false };
      const ranked = [...test2019].sort((a, b) => a.p - b.p || b.score - a.score);
      return {
        id,
        rank: ranked.findIndex((x) => x.w === best.w) + 1,
        alerted: kept.has(best.w),
      };
    };
    return {
      detector,
      y2019_budget: {
        alerts: kept.size,
        blackout: hit("GB-BLACKOUT-2019-08-09", ["2019-08-09"]),
        atiyah: hit("STORM-ATIYAH-2019-12-08", ["2019-12-08"]),
      },
    };
  });

  return {
    provenance: reportProvenance(["src/trace-c.ts", "src/real.ts", "src/holdout.ts", "src/v3.ts"]),
    protocol:
      "Peek-informed v3 preview, not a hold-out. combine=max_channel and selectionMode=daily_budget were chosen after the 2019 channel ablation and after inspecting 2020 record-rule saturation. Frozen v2 reports are unmodified. 2021 is the first legitimate test of v3.",
    frozen_2020_record_alerts: frozen.alerts_total_2020,
    variants,
    matched_budget_2019: matchedBudget,
    baseline_record_reference: matched,
  };
}
