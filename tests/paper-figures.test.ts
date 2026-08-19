import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  loadCalibrationFigureData,
  loadHoldoutTimelineData,
  renderCalibrationFigure,
  renderHoldoutTimelineFigure,
} from "../src/paper-figures";

const root = join(import.meta.dir, "..");

describe("paper figures", () => {
  test("committed rank-diagnostics figure is byte-identical to a regeneration", () => {
    const committed = readFileSync(join(root, "paper/generated/fig-rank-diagnostics.tex"), "utf8");
    expect(renderCalibrationFigure(loadCalibrationFigureData(root))).toBe(committed);
  });

  test("committed hold-out timeline figure is byte-identical to a regeneration", () => {
    const committed = readFileSync(join(root, "paper/generated/fig-holdout-timeline.tex"), "utf8");
    expect(renderHoldoutTimelineFigure(loadHoldoutTimelineData(root))).toBe(committed);
  });

  test("rank-diagnostics figure carries the report's exact ratios", () => {
    const data = loadCalibrationFigureData(root);
    const traceC = data.find((d) => d.detector === "trace_c")!;
    // 2019: 120/110.4 and 23/22.1 from the committed baselines report
    expect((traceC.y2019[0]!.observed / traceC.y2019[0]!.expected_null).toFixed(2)).toBe("1.09");
    expect((traceC.y2019[1]!.observed / traceC.y2019[1]!.expected_null).toFixed(2)).toBe("1.04");
    const fig = renderCalibrationFigure(data);
    expect(fig).toContain("{1.09}");
    expect(fig).toContain("{1.04}");
    expect(fig).toContain("TRACE-C");
    // every detector appears exactly once per panel
    for (const label of ["conv-AE", "IForest", "PCA", "SR", "TRACE-C"]) {
      expect(fig.split(`{${label}}`).length - 1).toBe(2);
    }
  });

  test("hold-out timeline binds every 2020 window and all three event bands", () => {
    const data = loadHoldoutTimelineData(root);
    expect(data.nWindows).toBe(4392);
    expect(data.points.length).toBe(4392);
    expect(data.events.map((e) => e.label)).toEqual(["Ciara", "Dennis", "COVID onset"]);
    // COVID onset annotation spans 14 days of windows
    const covid = data.events.find((e) => e.label === "COVID onset")!;
    expect(covid.to - covid.from).toBeGreaterThan(150);
    const fig = renderHoldoutTimelineFigure(data);
    expect(fig).toContain("\\label{fig:holdout-timeline}");
    expect(fig.match(/plot coordinates/g)!.length).toBe(Math.ceil(4392 / 400));
  });
});
