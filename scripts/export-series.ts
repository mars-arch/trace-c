/**
 * Export the aligned 2019+2020 multi-stream series for the Python baseline
 * suite. The TS loader is the single source of truth for CSV parsing and
 * window alignment — Python must never re-parse the raw CSVs, or the two
 * sides drift on DST/edge-row filtering.
 *
 * Usage: bun run scripts/export-series.ts → data/real/series-export.json
 */
import { writeFileSync } from "fs";
import { join } from "path";
import {
  FREQ_AGG_CSV,
  FREQ_STREAM,
  loadRealSeries,
  REAL_CSV,
  REAL_STREAMS,
  verifyPinnedSourceInputs,
} from "../src/real";
import { DEMAND_2020, FREQ_2020 } from "../src/holdout";

verifyPinnedSourceInputs();
const series = loadRealSeries([
  { demand: REAL_CSV, freqAgg: FREQ_AGG_CSV },
  { demand: DEMAND_2020, freqAgg: FREQ_2020 },
]);
if (!series.freq_available) throw new Error("frequency aggregates missing — run scripts/fetch-data.sh");

const names = [...REAL_STREAMS, FREQ_STREAM];
const out = {
  n: series.n,
  window_size: 4, // frozen protocol window (see src/real.ts)
  train_end_date: "2019-05-01",
  cal_end_date: "2019-07-01",
  streams: names,
  dates: series.dates,
  periods: series.periods,
  regime: series.regime,
  values: Object.fromEntries(names.map((s) => [s, series.streams[s]!])),
};
const path = join(import.meta.dir, "../data/real/series-export.json");
writeFileSync(path, JSON.stringify(out));
console.log(`exported ${series.n} rows × ${names.length} streams → ${path}`);
