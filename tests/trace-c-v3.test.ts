import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { runV3Preview } from "../src/v3";

test("v2 preview path still matches committed 2019 ranks", () => {
  const committed = JSON.parse(
    readFileSync(join(import.meta.dir, "../data/reports/trace-c-real-report.json"), "utf8")
  );
  const preview = runV3Preview();
  const v2 = preview.variants.v2_fisher_record.y2019.known_events;
  expect(v2.map((e) => [e.id, e.rank, e.alerted])).toEqual(
    committed.known_events.map(
      (e: { id: string; best_rank_of_scored_test_windows: number; alerted: boolean }) => [
        e.id,
        e.best_rank_of_scored_test_windows,
        e.alerted,
      ]
    )
  );
  expect(preview.protocol).toContain("not a hold-out");
  expect(preview.variants.v3_max_channel_budget_p01.knobs).toEqual({
    combine: "max_channel",
    selectionMode: "daily_budget",
    pGate: 0.01,
  });
});
