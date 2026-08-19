/**
 * Write the evidence-bound TikZ figures into paper/generated/.
 * Usage: bun run scripts/generate-paper-figures.ts
 */
import { writeFileSync } from "fs";
import { join } from "path";
import {
  loadCalibrationFigureData,
  loadHoldoutTimelineData,
  renderCalibrationFigure,
  renderHoldoutTimelineFigure,
} from "../src/paper-figures";

const root = join(import.meta.dir, "..");
const out = (name: string, content: string) => {
  const path = join(root, "paper/generated", name);
  writeFileSync(path, content);
  console.log(`wrote ${path}`);
};

out("fig-rank-diagnostics.tex", renderCalibrationFigure(loadCalibrationFigureData(root)));
out("fig-holdout-timeline.tex", renderHoldoutTimelineFigure(loadHoldoutTimelineData(root)));
