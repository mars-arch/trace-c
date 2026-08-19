"""Aggregate NESO 1-second system-frequency CSVs (monthly zips) into
per-settlement-period features aligned with the demand file.

Usage: python3 scripts/aggregate_frequency.py <2019|2020>

Timestamps in the source are LOCAL time with explicit offset (+0000/+0100),
so settlement date and period come straight off the local clock string:
period = floor(local_seconds_of_day / 1800) + 1. DST transition days
contribute 2 edge periods handled by the carry-forward fill at join time.

Raw zips (~11MB each, ~90MB unzipped per month) are downloaded to a temp
dir and deleted after aggregation; only the small aggregate CSV is kept.
"""
import csv
import io
import sys
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

BASE = "https://api.neso.energy/dataset/cb1cc925-ecd8-4406-b021-3a3f368196e1/resource/"

RESOURCES = {
    2019: {
        1: "2a653f90-7948-4203-a49e-8763733debb2/download/f-2019-1.zip",
        2: "3343dbfb-58ac-478a-8aed-618a35b38475/download/f-2019-2.zip",
        3: "b4fc11ec-2f9b-465e-8974-37cc289f2aaa/download/f-2019-3.zip",
        4: "5a511d6f-0cc4-4054-bb45-8ad3b81051ad/download/f-2019-4.zip",
        5: "84a85749-18e1-4b6b-bb97-73888ccacfe0/download/f-2019-5.zip",
        6: "f967b00a-36b4-4979-920e-77fdb6be8a9c/download/f-2019-6.zip",
        7: "da48b1fe-8e54-48fc-87b9-f6b0362422e2/download/f-2019-7.zip",
        8: "819a0821-cc6d-4909-a1ea-7dba5cab0c33/download/f-2019-8.zip",
        9: "9ffafdfb-cf42-46b3-802f-a6d9a45794aa/download/f-2019-9.zip",
        10: "65b4f284-4963-46c5-ae78-cab57fe5372f/download/f-2019-10.zip",
        11: "3d1a42c0-5637-4702-b9c3-76a7c5d8f062/download/f-2019-11.zip",
        12: "f0933bdd-1b0e-4dd3-aa7f-5498df1ba5b9/download/f-2019-12.zip",
    },
    2020: {
        1: "e1eb079f-abab-47c8-b59d-d558b3399796/download/fnew-2020-1.zip",
        2: "939590e1-2632-432b-b0d3-3f7e1def9d30/download/fnew-2020-2.zip",
        3: "1b7609f1-5132-45fc-8962-89912eb2b682/download/fnew-2020-3.zip",
        4: "8b974058-2494-4675-98af-0570c3a0b240/download/fnew-2020-4.zip",
        5: "954de419-c4e4-4366-9711-6cc1f0fcaa48/download/fnew-2020-5.zip",
        6: "4a7f506b-dd04-4480-988b-dff0cc3f9ed4/download/fnew-2020-6.zip",
        7: "7c9a488f-5070-4f8b-a3a1-0418ed4438a2/download/fnew-2020-7.zip",
        8: "27d4d8b3-0cbe-4cb2-bd83-947f968671a1/download/fnew-2020-8.zip",
        9: "cfc880fe-3d3d-4df4-bf4f-9294a4dbc901/download/fnew-2020-9.zip",
        10: "3617f1af-4d3c-45d3-a1f6-0d51a9c2167b/download/fnew-2020-10.zip",
        11: "bcfa7999-1b14-444b-8f8f-6402092a0e9d/download/fnew-2020-11.zip",
        12: "706ec5fe-777a-4a46-90de-b9089f93853c/download/fnew-2020-12.zip",
    },
}


def main() -> None:
    if len(sys.argv) != 2 or int(sys.argv[1]) not in RESOURCES:
        print(f"usage: {sys.argv[0]} <{'|'.join(map(str, RESOURCES))}>", file=sys.stderr)
        sys.exit(1)
    year = int(sys.argv[1])
    out_path = Path(__file__).resolve().parents[1] / "data/real" / f"neso-frequency-{year}-agg.csv"
    agg = defaultdict(lambda: [999.0, 0.0, 0])  # (date, period) -> [fmin, fmax, n]

    with tempfile.TemporaryDirectory() as tmp:
        for month, res in sorted(RESOURCES[year].items()):
            zpath = Path(tmp) / f"f-{year}-{month}.zip"
            print(f"downloading {year}-{month:02d}...", flush=True)
            urllib.request.urlretrieve(BASE + res, zpath)
            with zipfile.ZipFile(zpath) as z:
                with z.open(z.namelist()[0]) as fh:
                    reader = csv.reader(io.TextIOWrapper(fh, encoding="utf-8"))
                    next(reader)  # header: dtm,f
                    for row in reader:
                        if len(row) < 2:
                            continue
                        dtm = row[0]
                        try:
                            f = float(row[1])
                        except ValueError:
                            continue
                        date = dtm[:10]
                        h = int(dtm[11:13])
                        mnt = int(dtm[14:16])
                        period = h * 2 + (1 if mnt >= 30 else 0) + 1
                        a = agg[(date, period)]
                        if f < a[0]:
                            a[0] = f
                        if f > a[1]:
                            a[1] = f
                        a[2] += 1
            zpath.unlink()
            print(f"  month {month} done ({len(agg)} period-cells)", flush=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="") as out:
        w = csv.writer(out)
        w.writerow(["date", "period", "f_min", "f_max", "f_max_abs_dev", "samples"])
        for (date, period), (fmin, fmax, n) in sorted(agg.items()):
            if n == 0:
                continue
            dev = max(abs(fmax - 50.0), abs(fmin - 50.0))
            w.writerow([date, period, round(fmin, 3), round(fmax, 3), round(dev, 3), n])
    print(f"wrote {out_path} ({len(agg)} rows)")


if __name__ == "__main__":
    main()
