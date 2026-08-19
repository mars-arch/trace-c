import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ABLATION_VARIANTS, runAblation2019 } from "../src/ablation";

const root = join(import.meta.dir, "..");

describe("2019 channel ablation", () => {
  test("enumerates leave-one-out and single-channel variants without inventing names", () => {
    expect(ABLATION_VARIANTS.full).toEqual(["local", "copula", "temporal"]);
    expect(ABLATION_VARIANTS.drop_copula).toEqual(["local", "temporal"]);
    expect(ABLATION_VARIANTS.drop_local).toEqual(["copula", "temporal"]);
    expect(ABLATION_VARIANTS.drop_temporal).toEqual(["local", "copula"]);
    expect(ABLATION_VARIANTS.local_only).toEqual(["local"]);
    expect(ABLATION_VARIANTS.copula_only).toEqual(["copula"]);
    expect(ABLATION_VARIANTS.temporal_only).toEqual(["temporal"]);
  });

  test("full variant reproduces committed 2019 event ranks and discloses the development-year peek", () => {
    const committed = JSON.parse(
      readFileSync(join(root, "data/reports/trace-c-real-report.json"), "utf8")
    );
    const report = runAblation2019();
    const full = report.variants.full;

    expect(report.protocol).toContain("development-year");
    expect(report.protocol).toContain("Not a hold-out");
    expect(report.protocol).toContain("lead_channel");
    expect(full.channels).toEqual(["local", "copula", "temporal"]);
    expect(full.known_events.map((e) => [e.id, e.rank])).toEqual(
      committed.known_events.map(
        (e: { id: string; best_rank_of_scored_test_windows: number }) => [
          e.id,
          e.best_rank_of_scored_test_windows,
        ]
      )
    );
    expect(full.alerts_total).toBe(committed.alerts_total);
    expect(report.variants.drop_copula.channels).toEqual(["local", "temporal"]);
  });
});
