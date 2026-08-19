import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  loadPaperEvidence,
  renderAblationTable,
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

  test("uses bundle-local LaTeX paths for arXiv portability", () => {
    const main = readFileSync(join(root, "paper/main.tex"), "utf8");
    const results = readFileSync(join(root, "paper/sections/results.tex"), "utf8");

    expect(main).not.toContain("\\input{paper/");
    expect(main).not.toContain("\\bibliography{paper/");
    expect(results).not.toContain("\\input{paper/");
    expect(main).toContain("\\input{sections/abstract}");
    expect(results).toContain("\\input{generated/results-table}");
    expect(results).toContain("\\input{generated/ablation-table}");
  });

  test("renders the 2019 development-year ablation without treating it as a hold-out", () => {
    const evidence = loadPaperEvidence(root);
    const table = renderAblationTable(evidence);

    expect(evidence.ablation.protocol).toContain("Not a hold-out");
    expect(evidence.ablation.variants.copula_only.atiyahRank).toBe(59);
    expect(evidence.ablation.variants.temporal_only.blackoutRank).toBe(40);
    expect(evidence.ablation.variants.drop_copula.atiyahRank).toBe(2);
    expect(evidence.ablation.variants.full.atiyahAlerted).toBe(true);
    expect(evidence.ablation.variants.drop_copula.atiyahAlerted).toBe(false);

    expect(table.startsWith("% AUTO-GENERATED")).toBeTrue();
    expect(table).toContain("development-year");
    expect(table).toContain("not a hold-out");
    expect(table).toContain("copula only");
    expect(table).toContain("59");
    expect(table).toContain("40");
  });
});
