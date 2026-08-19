/** Generate LaTeX result tables from the committed TRACE-C evidence. */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  loadPaperEvidence,
  renderAblationTable,
  renderBaselineTable,
  renderTraceResultsTable,
} from "../src/paper-evidence";

export function writePaperTables(root: string): string[] {
  const outputDir = join(root, "paper", "generated");
  mkdirSync(outputDir, { recursive: true });
  const evidence = loadPaperEvidence(root);
  const outputs: [string, string][] = [
    ["results-table.tex", renderTraceResultsTable(evidence)],
    ["baseline-table.tex", renderBaselineTable(evidence)],
    ["ablation-table.tex", renderAblationTable(evidence)],
  ];
  for (const [name, contents] of outputs) {
    writeFileSync(join(outputDir, name), contents, "utf8");
  }
  return outputs.map(([name]) => join(outputDir, name));
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  for (const path of writePaperTables(root)) console.log(`wrote ${path}`);
}
