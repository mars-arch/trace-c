import { expect, test } from "bun:test";
import { createHash } from "crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as holdoutModule from "../src/holdout";
import * as realModule from "../src/real";

const repoRoot = join(import.meta.dir, "..");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyEvaluationRepo(): string {
  const target = mkdtempSync(join(tmpdir(), "trace-c-evidence-"));
  cpSync(join(repoRoot, "src"), join(target, "src"), { recursive: true });
  cpSync(join(repoRoot, "scripts"), join(target, "scripts"), { recursive: true });
  mkdirSync(join(target, "data/real"), { recursive: true });
  mkdirSync(join(target, "data/reports"), { recursive: true });
  cpSync(join(repoRoot, "data/source-checksums.json"), join(target, "data/source-checksums.json"));
  for (const name of [
    "neso-demand-2019.csv",
    "neso-demand-2020.csv",
    "neso-frequency-2019-agg.csv",
    "neso-frequency-2020-agg.csv",
  ]) {
    cpSync(join(repoRoot, "data/real", name), join(target, "data/real", name));
  }
  return target;
}

async function runEval(
  root: string,
  script: "eval-real.ts" | "eval-holdout.ts" | "export-series.ts"
) {
  const proc = Bun.spawn(["bun", "run", `scripts/${script}`], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

test("series export refuses to overwrite its input artifact when pinned data is corrupt", async () => {
  const root = copyEvaluationRepo();
  try {
    const series = join(root, "data/real/series-export.json");
    writeFileSync(series, '{"sentinel":"unchanged"}\n');
    const frequency = join(root, "data/real/neso-frequency-2019-agg.csv");
    const bytes = readFileSync(frequency);
    const index = bytes.findIndex((value, i) => i > 100 && value >= 0x30 && value <= 0x39);
    if (index < 0) throw new Error("frequency fixture contains no mutable digit");
    bytes[index] = bytes[index] === 0x39 ? 0x38 : bytes[index] + 1;
    writeFileSync(frequency, bytes);

    const result = await runEval(root, "export-series.ts");

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("sha256 mismatch");
    expect(readFileSync(series, "utf8")).toBe('{"sentinel":"unchanged"}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("2019 evaluation refuses to overwrite evidence when a pinned frequency input is missing", async () => {
  const root = copyEvaluationRepo();
  try {
    const report = join(root, "data/reports/trace-c-real-report.json");
    writeFileSync(report, '{"sentinel":"unchanged"}\n');
    unlinkSync(join(root, "data/real/neso-frequency-2019-agg.csv"));

    const result = await runEval(root, "eval-real.ts");

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("neso-frequency-2019-agg.csv");
    expect(readFileSync(report, "utf8")).toBe('{"sentinel":"unchanged"}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("2020 evaluation refuses to overwrite evidence when a pinned frequency input is corrupt", async () => {
  const root = copyEvaluationRepo();
  try {
    const report = join(root, "data/reports/trace-c-holdout-report.json");
    writeFileSync(report, '{"sentinel":"unchanged"}\n');
    const frequency = join(root, "data/real/neso-frequency-2020-agg.csv");
    const bytes = readFileSync(frequency);
    bytes[bytes.length - 1] = bytes[bytes.length - 1] === 0x20 ? 0x0a : 0x20;
    writeFileSync(frequency, bytes);

    const result = await runEval(root, "eval-holdout.ts");

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("neso-frequency-2020-agg.csv");
    expect(result.output).toContain("sha256 mismatch");
    expect(readFileSync(report, "utf8")).toBe('{"sentinel":"unchanged"}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("report provenance deterministically binds each report to its generating TypeScript sources", () => {
  const realProvenance = (
    realModule as typeof realModule & { realReportProvenance?: () => unknown }
  ).realReportProvenance;
  const holdoutProvenance = (
    holdoutModule as typeof holdoutModule & { holdoutReportProvenance?: () => unknown }
  ).holdoutReportProvenance;

  expect(typeof realProvenance).toBe("function");
  expect(typeof holdoutProvenance).toBe("function");
  if (!realProvenance || !holdoutProvenance) return;

  expect(realProvenance()).toEqual({
    schema_version: 1,
    generator_sources_sha256: {
      "src/real.ts": sha256(join(repoRoot, "src/real.ts")),
      "src/trace-c.ts": sha256(join(repoRoot, "src/trace-c.ts")),
    },
    source_manifest_sha256: sha256(join(repoRoot, "data/source-checksums.json")),
  });
  expect(holdoutProvenance()).toEqual({
    schema_version: 1,
    generator_sources_sha256: {
      "src/holdout.ts": sha256(join(repoRoot, "src/holdout.ts")),
      "src/real.ts": sha256(join(repoRoot, "src/real.ts")),
      "src/trace-c.ts": sha256(join(repoRoot, "src/trace-c.ts")),
    },
    source_manifest_sha256: sha256(join(repoRoot, "data/source-checksums.json")),
  });
});

test("freshly generated 2019 and 2020 reports embed their source provenance", async () => {
  const root = copyEvaluationRepo();
  try {
    const realResult = await runEval(root, "eval-real.ts");
    const holdoutResult = await runEval(root, "eval-holdout.ts");
    expect(realResult.exitCode).toBe(0);
    expect(holdoutResult.exitCode).toBe(0);

    const realReport = JSON.parse(
      readFileSync(join(root, "data/reports/trace-c-real-report.json"), "utf8")
    );
    const holdoutReport = JSON.parse(
      readFileSync(join(root, "data/reports/trace-c-holdout-report.json"), "utf8")
    );
    expect(realReport.provenance).toEqual({
      schema_version: 1,
      generator_sources_sha256: {
        "src/real.ts": sha256(join(root, "src/real.ts")),
        "src/trace-c.ts": sha256(join(root, "src/trace-c.ts")),
      },
      source_manifest_sha256: sha256(join(root, "data/source-checksums.json")),
    });
    expect(holdoutReport.provenance).toEqual({
      schema_version: 1,
      generator_sources_sha256: {
        "src/holdout.ts": sha256(join(root, "src/holdout.ts")),
        "src/real.ts": sha256(join(root, "src/real.ts")),
        "src/trace-c.ts": sha256(join(root, "src/trace-c.ts")),
      },
      source_manifest_sha256: sha256(join(root, "data/source-checksums.json")),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
