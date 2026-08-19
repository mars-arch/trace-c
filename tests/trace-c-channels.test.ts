import { describe, expect, test } from "bun:test";
import { runTraceC, type TraceCInput } from "../src/trace-c";

function toyInput(overrides: Partial<TraceCInput> = {}): TraceCInput {
  const n = 480;
  const a: number[] = [];
  const b: number[] = [];
  for (let t = 0; t < n; t++) {
    const seasonal = Math.sin((2 * Math.PI * t) / 48);
    a.push(10 + seasonal + ((t * 17) % 7) * 0.01);
    b.push(20 + 0.4 * seasonal + ((t * 13) % 5) * 0.01);
  }
  // Unusual combination late in test: both streams jump in opposite directions.
  a[400] += 8;
  b[400] -= 8;
  // Large marginal on A only.
  a[440] += 12;
  return {
    streams: { A: a, B: b },
    regime: Array(n).fill(0),
    windowSize: 4,
    splits: { trainEnd: 160, calEnd: 240 },
    pitK: 12,
    rollingRefSize: 20,
    sRefMin: 8,
    fdrQ: 0.05,
    budgetPerDay: 2,
    periodsPerDay: 48,
    ...overrides,
  };
}

function firstScored(input: TraceCInput) {
  const scored = runTraceC(input).windows.filter((w) => w.segment === "test" && w.S != null);
  if (!scored.length) throw new Error("expected scored test windows");
  return scored[0]!;
}

describe("runTraceC enabledChannels", () => {
  test("defaults to local, copula, and temporal channel ranks", () => {
    const window = firstScored(toyInput());
    expect(Object.keys(window.channelsRz ?? {}).sort()).toEqual(["copula", "local", "temporal"]);
  });

  test("Fisher combination uses only the requested channels", () => {
    const localOnly = firstScored(toyInput({ enabledChannels: ["local"] }));
    expect(Object.keys(localOnly.channelsRz ?? {})).toEqual(["local"]);
    expect(localOnly.channels.copula).toBeUndefined();
    expect(localOnly.channels.temporal).toBeUndefined();
  });

  test("dropping the copula channel changes the combined score", () => {
    const full = firstScored(toyInput());
    const noCopula = firstScored(toyInput({ enabledChannels: ["local", "temporal"] }));
    expect(noCopula.S).not.toEqual(full.S);
    expect(Object.keys(noCopula.channelsRz ?? {}).sort()).toEqual(["local", "temporal"]);
  });

  test("rejects an empty or unknown channel list instead of scoring a silent subset", () => {
    expect(() => runTraceC(toyInput({ enabledChannels: [] }))).toThrow("enabledChannels");
    expect(() =>
      runTraceC(toyInput({ enabledChannels: ["local", "nope"] as TraceCInput["enabledChannels"] }))
    ).toThrow("unknown channel");
  });
});

describe("runTraceC v3 combine and selection", () => {
  test("max_channel uses only the strongest channel rank, not the Fisher sum", () => {
    const fisher = firstScored(toyInput());
    const maxChannel = firstScored(toyInput({ combine: "max_channel" }));
    const channelScores = Object.values(maxChannel.channelsRz ?? {}).map(
      (rz) => 2 * rz * Math.log(10)
    );
    expect(maxChannel.S).toBeCloseTo(Math.max(...channelScores), 2);
    expect(maxChannel.S).not.toEqual(fisher.S);
  });

  test("daily_budget can alert windows that are not records", () => {
    const record = runTraceC(toyInput());
    const budgeted = runTraceC(toyInput({ selectionMode: "daily_budget" }));
    expect(record.selection).toBe("record_rule");
    expect(budgeted.selection).toBe("daily_budget");
    expect(budgeted.alerts.length).toBeGreaterThan(record.alerts.length);
    const recordWs = new Set(record.alerts.map((a) => a.w));
    expect(budgeted.alerts.some((a) => !recordWs.has(a.w))).toBe(true);
  });

  test("rejects an unknown combine or selectionMode", () => {
    expect(() => runTraceC(toyInput({ combine: "nope" as TraceCInput["combine"] }))).toThrow(
      "combine"
    );
    expect(() =>
      runTraceC(toyInput({ selectionMode: "nope" as TraceCInput["selectionMode"] }))
    ).toThrow("selectionMode");
  });
});

