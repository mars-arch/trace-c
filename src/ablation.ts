/**
 * 2019 development-year channel ablation.
 *
 * Not a hold-out. The full detector's Atiyah lead_channel (local) was visible
 * before this suite ran. Use it only as a necessity diagnostic for L/G/T.
 */
import { join } from "path";
import {
  runTraceC,
  type TraceCChannel,
  type TraceCResult,
} from "./trace-c";
import {
  BUDGET,
  FDR_Q,
  FREQ_STREAM,
  KNOWN_EVENTS,
  PIT_K,
  REAL_STREAMS,
  WINDOW,
  loadRealSeries,
  reportProvenance,
  verifyPinnedSourceInputs,
} from "./real";

const root = join(import.meta.dir, "..");
export const ABLATION_REPORT = join(root, "data/reports/trace-c-ablation-2019.json");

export const ABLATION_VARIANTS: Record<string, TraceCChannel[]> = {
  full: ["local", "copula", "temporal"],
  drop_copula: ["local", "temporal"],
  drop_local: ["copula", "temporal"],
  drop_temporal: ["local", "copula"],
  local_only: ["local"],
  copula_only: ["copula"],
  temporal_only: ["temporal"],
};

export function ablationReportProvenance(evidenceRoot = root) {
  return reportProvenance(
    ["src/trace-c.ts", "src/real.ts", "src/ablation.ts"],
    evidenceRoot
  );
}

export function runAblation2019() {
  verifyPinnedSourceInputs();
  const series = loadRealSeries();
  const frequency = series.streams[FREQ_STREAM];
  if (!series.freq_available || !frequency || frequency.length !== series.n) {
    throw new Error(`2019 ablation requires the verified ${FREQ_STREAM} stream`);
  }

  const trainEnd = series.dates.findIndex((d) => d >= "2019-05-01");
  const calEnd = series.dates.findIndex((d) => d >= "2019-07-01");
  const names = [...REAL_STREAMS, FREQ_STREAM];

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

  const summarize = (channels: TraceCChannel[], res: TraceCResult) => {
    const scored = res.windows.filter((x) => x.segment === "test" && x.p != null);
    const byP = [...scored].sort((a, b) => a.p! - b.p! || b.S! - a.S!);
    return {
      channels,
      selection: res.selection,
      alerts_total: res.alerts.length,
      expected_null_alerts: res.expected_null_alerts,
      calibration_check: [0.05, 0.01].map((level) => ({
        level,
        observed: scored.filter((x) => x.p! <= level).length,
        expected_null: Number((level * scored.length).toFixed(1)),
      })),
      known_events: KNOWN_EVENTS.map((e) => {
        const i = byP.findIndex((x) => matchKnown(x.w) === e.id);
        const best = byP.find((x) => matchKnown(x.w) === e.id);
        const lead =
          best?.channelsRz &&
          Object.entries(best.channelsRz).sort((a, b) => b[1] - a[1])[0]?.[0];
        return {
          id: e.id,
          alerted: res.alerts.some((a) => matchKnown(a.w) === e.id),
          rank: i < 0 ? null : i + 1,
          best_p: best?.p != null ? Number(best.p.toFixed(5)) : null,
          lead_channel: lead ?? null,
          total_test_windows: scored.length,
        };
      }),
    };
  };

  const variants = Object.fromEntries(
    Object.entries(ABLATION_VARIANTS).map(([name, channels]) => {
      const res = runTraceC({
        streams: Object.fromEntries(names.map((s) => [s, series.streams[s]!])),
        regime: series.regime,
        windowSize: WINDOW,
        splits: { trainEnd, calEnd },
        pitK: PIT_K,
        fdrQ: FDR_Q,
        budgetPerDay: BUDGET,
        periodsPerDay: 48,
        enabledChannels: channels,
      });
      return [name, summarize(channels, res)];
    })
  );

  return {
    provenance: ablationReportProvenance(),
    protocol:
      "2019 development-year channel ablation. Not a hold-out. The full detector's Atiyah lead_channel was inspected before this suite ran. Variants drop or isolate local / copula / temporal under the same windows, splits, and selection rule as the committed 2019 report.",
    config: {
      windowSize: WINDOW,
      pitK: PIT_K,
      fdrQ: FDR_Q,
      budgetPerDay: BUDGET,
      fit: "2019-01-01..2019-04-30",
      scored: "2019-07-01..2019-12-31",
      streams: names,
    },
    variants,
  };
}
