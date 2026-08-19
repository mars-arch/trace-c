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
