# TRACE-C paper migration design

**Date:** 2026-08-19  
**Status:** approved  
**Decision:** the TRACE-C repository owns the canonical publication source.

## Objective

Replace the vault-only internal draft with a versioned, arXiv-oriented paper
whose statements and tables are tied to the repository's committed evidence.
The migration must correct the audited factual errors without changing the
frozen detector or retrospectively changing the 2020 hold-out protocol.

## Source-of-truth boundary

The canonical manuscript will live under `paper/` as LaTeX. The existing
Obsidian note will stop being an independently editable manuscript and will be
reduced to a short migration pointer to the repository source. This prevents
two prose masters from drifting.

Committed JSON reports under `data/reports/` remain the source of truth for
experimental numbers. Generated LaTeX tables must be derived from those files,
not copied manually. The paper may interpret those values, but its claims must
state the protocol limitations already encoded in the reports.

## Repository layout

```text
paper/
  main.tex
  references.bib
  sections/
    abstract.tex
    introduction.tex
    related-work.tex
    method.tex
    data-protocol.tex
    results.tex
    limitations.tex
    conclusion.tex
  generated/
    results-table.tex
    baseline-table.tex
  figures/
  README.md
  arxiv/
    00README.md
scripts/
  generate-paper-tables.ts
  check-paper.ts
```

`main.tex` is the only compilation entry point. Sections are split for
reviewable diffs. Generated files carry a warning header and are regenerated
by script.

## Scientific reconciliation

The paper will describe the shipped relational channel accurately. TRACE-C
computes the Gaussian copula log-density contrast on rolling robust-standardized
coordinates. Because those coordinates are not an exact probability-integral
transform, the manuscript will call this a **Gaussian dependence score** or
**copula-form score**, not a literal fitted copula density. The historical
TRACE-C name remains, while the outer rank-conformal layer and its empirical
checks are described separately. No algorithm change is made after inspecting
the hold-out.

The paper will also:

- call conformal outputs p-values, never alert probabilities;
- treat observed/reference counts as empirical diagnostics under dependence,
  not distribution-free proof;
- distinguish the 2019 development year from the frozen 2020 TRACE-C run;
- label the external baseline suite as post-hoc and protocol-non-identical;
- state unequal event opportunity windows and exact best-window dates;
- remove claims for synthetic, missing-stream, matched-budget, or ablation
  experiments that do not exist in the committed evidence;
- integrate results before limitations and conclusion rather than retaining an
  addendum after the conclusion;
- retain governance only as a concise scope statement, not a product section.

## Corrections required by the audit

- Storm Alex is the fifth-ranked 2020 window, not the second; only Storm Ellen
  is the top-ranked post-hoc weather match.
- The best TRACE-C window inside the 14-day lockdown annotation is
  2020-03-28 06:00, not the 2020-03-23 onset.
- At `K=40`, the rank-PIT ceiling is approximately `2.2509`, not `2.33`.
- The old fixed-calibration run is a disclosed/retracted narrative, not a
  shipped machine-readable comparison artifact.
- Baseline evidence is required, not optional, and full reproduction includes
  the pinned Python environment and baseline retraining workflow.
- A mutable branch name must not be presented as a commit hash. The paper will
  bind its initial results to commit `0eafb4851bd53dd88ee5cc8ee253bd1cc536360b`
  while explaining how to regenerate against a later checkout.

## Data licensing and attribution

Replace generic Open Government Licence claims with the NESO Open Data Licence
and include the required attribution:

> Supported by National Energy SO Open Data.

The README, package metadata, source report labels, and regenerated reports
must use the same licence wording so that the paper and evidence do not
contradict one another.

## Citations

`references.bib` will cite primary sources for Gaussian copulas/Sklar,
conformal prediction and time-series caveats, Fisher combination, Benjamini--
Hochberg, robust scale estimation, the four external baselines, both NESO
datasets, and the named-event sources used for post-hoc annotation. Related
work will be prose with explicit comparison, not an uncited checklist.

## Generated evidence and checks

`generate-paper-tables.ts` will read the three committed result reports and
write deterministic LaTeX tables. `check-paper.ts` will regenerate expected
table content in memory, compare it with committed generated files, reject
known stale phrases/numbers, verify required citation keys, and ensure the
paper pins the intended evidence commit.

Package scripts will expose:

- `paper:tables` -- regenerate evidence tables;
- `paper:check` -- verify prose/table invariants and LaTeX compilation inputs;
- `paper:build` -- compile the PDF using the documented local TeX tool;
- `paper:arxiv` -- create a minimal source bundle after checks.

The existing repository verification remains authoritative for detector and
artifact provenance. Paper checks add a publication layer; they do not replace
the core gate.

## Validation

Completion requires:

1. existing TypeScript/Python/evidence checks remain green;
2. generated tables match committed JSON exactly;
3. no Unilink, product, customer-specific, or internal-vault wording appears
   in publication sources;
4. LaTeX compiles without missing citations or references;
5. the PDF is rendered and inspected page by page;
6. the arXiv bundle recompiles independently; and
7. the vault note points to the canonical repository manuscript.

## Non-goals

This migration does not publish the repository, submit to arXiv, invent a
public URL, add unrun experiments, or change the frozen method. Those actions
require separate authorization or new evidence.
