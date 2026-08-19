#!/usr/bin/env bash
# Fetch the NESO datasets (NESO Open Data Licence) needed to reproduce every
# result in this repo: half-hourly demand CSVs + 1-second frequency aggregated
# to per-period features. Supported by National Energy SO Open Data. ~150MB of
# transient downloads; what is kept on disk is ~4MB.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/real

DEMAND_BASE="https://api.neso.energy/dataset/8f2fe0af-871c-488d-8bad-960426f24601/resource"
declare -A DEMAND=(
  [2019]="dd9de980-d724-415a-b344-d8ae11321432/download/demanddata_2019.csv"
  [2020]="33ba6857-2a55-479f-9308-e5c4c53d4381/download/demanddata_2020.csv"
)

PY="${PYTHON:-python3}"
for year in 2019 2020; do
  demand="data/real/neso-demand-${year}.csv"
  if [ ! -s "$demand" ]; then
    echo "downloading demand ${year}..."
    curl -fsSL "${DEMAND_BASE}/${DEMAND[$year]}" -o "$demand"
  fi
  agg="data/real/neso-frequency-${year}-agg.csv"
  if [ ! -s "$agg" ]; then
    "$PY" scripts/aggregate_frequency.py "$year"
  fi
done
"$PY" scripts/verify_source_data.py
echo "data ready:"
ls -la data/real/
