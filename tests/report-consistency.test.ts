import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("the 2019 honesty note agrees with its shipped rank and sensor set", () => {
  const report = JSON.parse(
    readFileSync(join(import.meta.dir, "../data/reports/trace-c-real-report.json"), "utf8")
  );
  const blackout = report.known_events.find(
    (event: { id: string }) => event.id === "GB-BLACKOUT-2019-08-09"
  );
  const percent = ((100 * blackout.best_rank_of_scored_test_windows) / blackout.total_test_windows)
    .toFixed(1);

  expect(report.honesty_note).toContain(`top ~${percent}%`);
  expect(report.source.streams).toContain("FREQ_MAX_ABS_DEV");
  expect(report.honesty_note).not.toContain("frequency) is not in this dataset");
});

test("committed evidence reports contain no wall-clock rebuild timestamp", () => {
  for (const name of ["trace-c-real-report.json", "trace-c-holdout-report.json"]) {
    const report = JSON.parse(
      readFileSync(join(import.meta.dir, `../data/reports/${name}`), "utf8")
    );
    expect(report).not.toHaveProperty("generated_at");
  }
});

test("release-facing NESO metadata uses the official licence and attribution", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  const packageJson = readFileSync(join(import.meta.dir, "../package.json"), "utf8");
  const fetchScript = readFileSync(join(import.meta.dir, "../scripts/fetch-data.sh"), "utf8");
  const realReport = JSON.parse(
    readFileSync(join(import.meta.dir, "../data/reports/trace-c-real-report.json"), "utf8")
  );

  for (const text of [readme, packageJson, fetchScript]) {
    expect(text).toContain("NESO Open Data Licence");
    expect(text).toContain("Supported by National Energy SO Open Data");
    expect(text).not.toContain("Open Government Licence");
    expect(text).not.toMatch(/\bOGL\b/);
  }

  expect(realReport.source.licence).toBe("NESO Open Data Licence");
  expect(realReport.source.attribution).toBe("Supported by National Energy SO Open Data");
  for (const text of [realReport.source, realReport.frequency_stream]) {
    expect(JSON.stringify(text)).not.toContain("Open Government Licence");
    expect(JSON.stringify(text)).not.toMatch(/\bOGL\b/);
  }
});

test("rank-PIT K=40 ceiling documentation is approximately 2.2509", () => {
  const traceC = readFileSync(join(import.meta.dir, "../src/trace-c.ts"), "utf8");
  expect(traceC).toContain("2.2509");
  expect(traceC).not.toContain("2.33 at K=40");
});

test("publication prose does not sell Atiyah as copula detection", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  const abstract = readFileSync(join(import.meta.dir, "../paper/sections/abstract.tex"), "utf8");
  const intro = readFileSync(join(import.meta.dir, "../paper/sections/introduction.tex"), "utf8");
  const results = readFileSync(join(import.meta.dir, "../paper/sections/results.tex"), "utf8");
  const limitations = readFileSync(join(import.meta.dir, "../paper/sections/limitations.tex"), "utf8");
  const conclusion = readFileSync(join(import.meta.dir, "../paper/sections/conclusion.tex"), "utf8");

  expect(limitations).not.toContain("ablations, synthetics");
  expect(limitations).toContain("channel ablation");
  expect(results).toContain("tab:ablation");
  for (const text of [readme, abstract, intro, results, conclusion]) {
    expect(text.toLowerCase()).not.toMatch(/atiyah[^\n.]{0,80}joint surprise/);
    expect(text.toLowerCase()).not.toMatch(/copula[^\n.]{0,80}recovers? storm atiyah/);
  }
  expect(abstract).toMatch(/copula-only/i);
  expect(readme).toMatch(/[Cc]opula-only/);
});
