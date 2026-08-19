import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  loadPaperEvidence,
  renderBaselineTable,
  renderTraceResultsTable,
} from "../src/paper-evidence";

const root = join(import.meta.dir, "..");

describe("paper evidence", () => {
  test("loads publication facts from the committed reports", () => {
    const evidence = loadPaperEvidence(root);

    expect(evidence.trace2019.events.map((event) => [event.id, event.rank])).toEqual([
      ["GB-BLACKOUT-2019-08-09", 143],
      ["STORM-ATIYAH-2019-12-08", 1],
    ]);
    expect(evidence.trace2019.events.map((event) => event.opportunityWindows)).toEqual([5, 12]);
    expect(evidence.trace2020.events.map((event) => [event.id, event.rank])).toEqual([
      ["STORM-CIARA-2020-02-09", 44],
      ["STORM-DENNIS-2020-02-15", 137],
      ["COVID-LOCKDOWN-2020-03-23", 45],
    ]);

    const lockdown = evidence.trace2020.events.find((event) => event.id.startsWith("COVID"));
    expect(lockdown?.opportunityWindows).toBe(168);
    expect(lockdown?.bestDateTime).toBe("2020-03-28 06:00");

    expect(evidence.trace2020.topWindows.slice(0, 5).map((window) => [
      window.rank,
      window.date,
      window.externalInterpretation,
    ])).toEqual([
      [1, "2020-08-20", "Storm Ellen"],
      [2, "2020-01-20", null],
      [3, "2020-08-04", null],
      [4, "2020-08-11", null],
      [5, "2020-10-03", "Storm Alex"],
    ]);
  });

  test("renders deterministic LaTeX tables with provenance warnings", () => {
    const evidence = loadPaperEvidence(root);
    const results = renderTraceResultsTable(evidence);
    const baselines = renderBaselineTable(evidence);

    expect(results.startsWith("% AUTO-GENERATED")).toBeTrue();
    expect(results).toContain("120/110.4");
    expect(results).toContain("50/45.0");
    expect(results).toContain("Lockdown transition (14 days; best 2020-03-28 06:00)");
    expect(results).toContain("Storm Ellen (post-ranking interpretation) & 1");
    expect(results).toContain("Storm Alex (post-ranking interpretation) & 5");

    expect(baselines.startsWith("% AUTO-GENERATED")).toBeTrue();
    expect(baselines).toContain("Convolutional autoencoder");
    expect(baselines).toContain("PCA reconstruction");
    expect(baselines).toContain("Isolation Forest");
    expect(baselines).toContain("Spectral Residual");
    expect(baselines).toContain("2020-04-05");
    expect(baselines).toContain("2020-03-28");
    expect(renderBaselineTable(evidence)).toBe(baselines);
  });
});
