import { expect, test } from "bun:test";
import { join } from "path";
import { assertReportBodyCurrent } from "../scripts/verify-artifacts";

test("committed evidence matches its current sources and upstream artifacts", async () => {
  const root = join(import.meta.dir, "..");
  const proc = Bun.spawn(["bun", "run", "scripts/verify-artifacts.ts"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  expect(`${stdout}${stderr}`).toContain("artifact provenance verified");
  expect(exitCode).toBe(0);
});

test("tampered comparison results cannot retain trusted embedded hashes", () => {
  const expected = {
    artifact_hashes: { baseline_scores_sha256: "same" },
    baselines: [{ detector: "conv_ae", y2019: { rank: 1 } }],
  };
  const tampered = structuredClone(expected);
  tampered.baselines[0]!.y2019.rank = 999;

  expect(() => assertReportBodyCurrent(tampered, expected)).toThrow(
    "baseline comparison report body is stale or tampered"
  );
});
