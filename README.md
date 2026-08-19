# TRACE-C

**Copula-calibrated temporal relational anomaly detection** for multi-stream
operational telemetry — with rolling-conformal p-values empirically checked
on real data, disclosed null assumptions and selection
rules, and a frozen blind hold-out year.

> Rank unusual multi-stream windows, say which channel fired, and hand
> evidence to a human — never a person-risk score.

The deterministic TypeScript core has zero runtime dependencies. Data
aggregation uses Python's standard library. The optional external-baseline
suite pins CPython and the direct NumPy, PyTorch, scikit-learn, and TensorBoard
package versions used here.

## Method

For aligned multi-stream series (`src/trace-c.ts`, generic over any matrix):

1. **Marginals** — rolling regime-conditioned robust-z: `(v − median)/(1.4826·MAD)`
   over the last K same-regime observations, strictly prior, clipped ±10.
   Magnitude-preserving: a rank-PIT marginal clips z at ±Φ⁻¹((K+½)/(K+1)),
   destroying deep-tail power (a 30σ excursion ties a barely-record reading).
2. **Channels** per non-overlapping window:
   *local* (max stream |Σz/√W|), *copula* (Gaussian copula-form dependence
   score on robust-z residuals, Σ̂ fitted on the train segment — joint surprise
   under the fitted dependence, not an independence assumption), *temporal*
   (worst AR(1) innovation),
   plus optional extra channels.
3. **Rank normalization** — each channel scored as a rank-p against a
   **trailing window of strictly-prior windows**. This kills two validity
   killers at once: seasonal drift (a fixed calibration block is not
   exchangeable with a drifting test period) and self-inclusion bias
   (ranking a window against a set containing itself is anti-conservative
   once channels are combined — verified by simulation, 1.48× at 3 channels).
4. **Combination** — S = Fisher over channel rank-p's. Rank-based ⇒ S is
   more stable over time; S is then ranked against the **growing set of all
   strictly-prior S values**. The finite-sample rank formula is exact and never
   rounded, but distribution-free calibration still requires exchangeability.
5. **Selection** — BH FDR is attempted first; when it selects no windows
   (conformal granularity often makes the BH threshold unreachable), fall back
   to the **record rule** (S beats every prior window)
   with its exchangeable-null reference count Σ 1/(n_prior+1) reported as
   `expected_null_alerts`. Then a hard per-day operator-attention budget.
   The report always says which rule ran.

## Evidence (real data, NESO Open Data Licence)

NESO GB grid telemetry: 5 half-hourly demand-side streams + a 6th stream
aggregated from 1-second system frequency (per-period max |f − 50 Hz|).
Fit: Jan–Apr 2019. Everything after is scored with strictly-prior references.

**2019 (development year — choices disclosed as test-informed):**

| Result | Value |
|---|---|
| Empirical rank-score check (obs/reference) | p≤.05: 120/110 · p≤.02: 51/44 · p≤.01: 23/22 |
| Storm Atiyah (2019-12-08) | **rank 1/2208, alerted**; lead channel **local**, not copula |
| GB blackout (2019-08-09) | rank 143 fused; **temporal-only rank 40**; not separable at 30-min aggregation |
| Record-rule alerts | 2 vs 1.19 expected under noise |

**2020 (hold-out — frozen method, blind year that informed nothing):**

| Result | Value |
|---|---|
| Calibration pre-COVID | p≤.05: 50/45 · p≤.01: 3/9 (slightly conservative) |
| Storm Ciara (Feb 8–9) | rank 44/4392 blind (p=0.012) |
| COVID lockdown onset (Mar 23) | best over the 14-day transition: rank 45/4392 blind; best window 2020-03-28 06:00 |
| Storm Dennis (Feb 15–16) | rank 137/4392 blind |
| Top ranked blind windows | **#1 Storm Ellen (Aug 20, post-ranking interpretation)**; **#2 Jan20 unlabelled window**; **#5 Storm Alex (Oct 3, post-ranking interpretation)** |
| Record rule | saturates on long horizons (0 vs 0.87 expected) — real finding; v3 selection rule to be validated on 2021 |

**2019 channel ablation (development year, not a hold-out):** Atiyah's
`lead_channel` was inspected before this suite. Copula-only ranks Atiyah **59**;
drop copula leaves it **rank 2 without an alert**; local-only is rank 3; temporal-only
ranks the blackout **40** vs fused 143. The copula-form channel is an extra
Fisher term, not the event engine. `bun run eval:ablation`.

**v3 preview (peek-informed, not a hold-out):** max-channel combine plus
2/day among \(p\le.01\). It is **not better** on these events: max-channel
moves blackout 143→93 but yields 0 gated alerts; Fisher+\(p\le.01\) budget
gives 22 alerts in 2019 (Atiyah yes, blackout no) vs reconstruction which
alerts the blackout at the same gate. `bun run eval:v3`.

Full machine-readable results: `data/reports/*.json` (committed).

## External baselines (post-hoc comparison)

Four standard detectors were fit on Jan–Apr 2019 and scored causally on the
same six streams and W=4 windows. Lower rank is better; denominators are 2,208
windows in 2019 and 4,392 in 2020.

| Detector | Blackout | Atiyah | Ciara | Dennis | Lockdown transition | pre-COVID p≤.05 obs/ref |
|---|---:|---:|---:|---:|---:|---:|
| TRACE-C | 143 | **1** | 44 | 137 | 45 | 50/45 |
| Conv autoencoder | **1** | 34 | **1** | 29 | 46 | 27/45 |
| PCA reconstruction | **1** | 12 | 12 | 34 | 22 | 82/45 |
| Isolation Forest | 2 | 3 | 10 | 178 | **1** | 49/45 |
| Spectral Residual | 2 | 26 | 12 | 38 | 6 | 93/45 |

This is not an “identical protocol” or a second blind hold-out. Only TRACE-C's
2020 run was frozen before inspection; the baseline suite was built after those
results were visible. What is shared is the data, sensor set, windows, fit/test
dates, causal scoring, event annotations, and strictly-prior ranking. TRACE-C
additionally uses trailing channel ranks, Fisher combination, BH-first fallback,
and a two-per-day budget; baselines use a direct growing rank of their raw score
and an unbudgeted record rule.

The result is deliberately mixed: simple reconstruction isolates the short
blackout much better, TRACE-C ranks Atiyah first for local (not copula)
reasons, and TRACE-C has the most stable empirical rank counts. PCA and Spectral Residual are visibly
anti-conservative pre-COVID under their regime-naive global references. Event
ranks also have unequal opportunity counts (blackout 5 windows, Atiyah 12,
each two-day storm 24, lockdown transition 168); the Isolation Forest lockdown
rank 1 occurs on 5 April, not on 23 March. See
`data/reports/baselines-report.json` for best-window dates, assumptions, counts,
and provenance. The pre-COVID span includes Ciara and Dennis, so it is a
descriptive stability check rather than a clean null interval.

## Honesty ledger

This project treats disclosure as part of the method. Inside the shipped
reports' `honesty_note`:

- An early fixed-calibration version produced **62 "FDR q=0.05" alerts that
  were ~90% seasonal-drift artifacts** (conformal p ~20× anti-conservative;
  BH never actually governed selection). Retracted in-report; the rolling
  scheme above is the fix, and `calibration_check` is the empirical diagnostic.
- W/K were chosen from a small sweep scored partly on the 2019 blackout;
  the frequency stream and the marginal switch were also event-informed.
  The 2020 hold-out exists precisely because of this ledger.
- Detection is a property of the **sensor set and aggregation resolution**
  as much as the algorithm.
- `expected_null` is a reference under exchangeable scores, not a theorem for
  seasonal, autocorrelated grid telemetry. The observed/reference tables are
  empirical diagnostics.
- The frozen two-alert “day” budget groups fixed 48-row blocks. NESO retains
  46/50-period DST days, so calendar-day budgeting is a documented v3 fix, not
  silently changed after the hold-out.

## Reproduce

```bash
bun install            # frozen dependency lock; Bun 1.3.11
bash scripts/fetch-data.sh    # ~150MB transient downloads (NESO Open Data Licence) → ~4MB kept
bun run eval           # rebuilds TRACE-C reports, 2019 ablation, hash-checked baselines
bun run check:core     # Bun tests + types + full evidence provenance
```

To retrain every baseline and regenerate its score artifact:

```bash
python3 --version      # must match the exact version in .python-version
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-baselines.txt
bun run check          # core checks + 15 Python baseline/data/TensorBoard tests
bun run baselines
bun run tb:baselines
python -m tensorboard.main --logdir runs/trace-c-baselines --host 127.0.0.1 --port 6006
```

If training and TensorBoard live in separate interpreters, set
`BASELINE_PYTHON=/path/to/python` and/or
`TENSORBOARD_PYTHON=/path/to/python` on the corresponding `bun run` command.

`baseline-scores.json`, `ae-training-history.json`, and the final comparison
report are committed evidence. Trainer provenance covers its source, export
pipeline, exact CPython/direct model-library versions, and source manifest. The core
reports bind their generator sources; the final report is regenerated in
memory and compared in full. `bun run verify:artifacts` refuses missing,
stale, or altered combinations. Raw downloads, aligned export, and TensorBoard
event files are reproducible but gitignored; every TensorBoard export gets an
isolated or atomically claimed run directory. Retained NESO inputs are pinned
by `data/source-checksums.json` and verified before report generation.
Transitive Python wheels remain platform-resolved; bitwise portability across
operating systems is not claimed, and the producing platform/machine are
recorded in each score artifact.

## Provenance

Research reference implementation of TRACE-C (copula-calibrated temporal
relational anomaly detection) with a frozen blind hold-out protocol on public
grid telemetry. Method notes and result tables above match the committed
reports under `data/reports/`.

Data © NESO, NESO Open Data Licence.
Supported by National Energy SO Open Data.
Code © Mars Arch / Matthew Faucher, MIT License (see `LICENSE`).
