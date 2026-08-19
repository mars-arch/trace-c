# Canonical TRACE-C Paper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the TRACE-C manuscript into the repository as an accurate, citation-complete, buildable LaTeX paper whose numerical tables are generated from committed evidence.

**Architecture:** `paper/main.tex` is the sole manuscript entry point and includes reviewable section files plus deterministic tables rendered from `data/reports/*.json`. TypeScript checks bind publication text to current evidence and reject known stale claims. The Obsidian note becomes a pointer to the repository so only one editable manuscript remains.

**Tech Stack:** LaTeX/latexmk/BibTeX, Bun/TypeScript, committed JSON evidence, Bun tests, Obsidian Markdown.

---

### Task 1: Establish publication evidence renderers with TDD

**Files:**
- Create: `tests/paper-evidence.test.ts`
- Create: `src/paper-evidence.ts`
- Create: `scripts/generate-paper-tables.ts`

**Step 1: Write the failing evidence-renderer test**

Test that the renderer:

- reads `trace-c-real-report.json`, `trace-c-holdout-report.json`, and
  `baselines-report.json`;
- emits the exact 2019/2020 calibration and event values;
- labels the COVID value as a 14-day transition window and includes its best
  timestamp (`2020-03-28 06:00`);
- emits the four baseline rows and their exact best-window dates;
- identifies Ellen as rank 1, the unlabelled 20 January window as rank 2, and
  Alex as rank 5; and
- adds an auto-generated warning header.

**Step 2: Run the test and verify it fails**

Run: `bun test tests/paper-evidence.test.ts`  
Expected: FAIL because `src/paper-evidence.ts` does not exist.

**Step 3: Implement the minimal renderer**

Export typed `loadPaperEvidence(root)`, `renderTraceResultsTable(evidence)`,
and `renderBaselineTable(evidence)`. Derive values from JSON fields rather than
hard-coding paper numbers. Escape all LaTeX text through one helper.

**Step 4: Add the generator CLI**

Write both deterministic outputs to:

- `paper/generated/results-table.tex`
- `paper/generated/baseline-table.tex`

The CLI must create only the known `paper/generated` directory and files.

**Step 5: Run the focused test**

Run: `bun test tests/paper-evidence.test.ts`  
Expected: PASS.

**Step 6: Commit**

```bash
git add tests/paper-evidence.test.ts src/paper-evidence.ts scripts/generate-paper-tables.ts
git commit -m "test: bind paper tables to TRACE-C evidence"
```

### Task 2: Correct repository terminology and NESO licensing

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `src/real.ts`
- Modify: `src/holdout.ts` (only if a licence/source label is present)
- Modify: `src/trace-c.ts`
- Modify: `tests/report-consistency.test.ts`
- Regenerate: `data/reports/trace-c-real-report.json`
- Regenerate: `data/reports/trace-c-holdout-report.json`
- Regenerate: `data/reports/baselines-report.json`

**Step 1: Add failing consistency assertions**

Require generated source metadata to say `NESO Open Data Licence`, require the
official attribution `Supported by National Energy SO Open Data`, reject
generic `Open Government Licence`/`OGL` claims in release-facing metadata, and
assert the rank-PIT ceiling comment is approximately `2.2509` at `K=40`.

**Step 2: Run the focused test and verify it fails**

Run: `bun test tests/report-consistency.test.ts`  
Expected: FAIL on current OGL strings and the `2.33` comment.

**Step 3: Apply minimal source/documentation corrections**

Use the official NESO licence name and attribution. Change README wording so
Alex is fifth, the lockdown value is a transition-window result, and the top
two windows are Ellen plus an unlabelled 20 January window. Rename the
relational channel in prose/comments to `Gaussian copula-form dependence
score on robust-z residuals`; do not alter the frozen numeric computation.

**Step 4: Regenerate the evidence chain**

Run:

```bash
bun run eval:real
bun run eval:holdout
bun run eval:baselines
```

Expected: all three reports regenerate; baseline scores/training history are
unchanged, while report provenance hashes update where their generators did.

**Step 5: Run repository gates**

Run: `bun run check`  
Expected: all Bun tests, Python tests, type checking, input checks, and artifact
verification pass.

**Step 6: Commit**

```bash
git add README.md package.json src tests data/reports
git commit -m "fix: align TRACE-C evidence terminology and NESO licence"
```

### Task 3: Create the LaTeX publication skeleton and bibliography

**Files:**
- Create: `paper/main.tex`
- Create: `paper/references.bib`
- Create: `paper/README.md`
- Create: `paper/sections/abstract.tex`
- Create: `paper/sections/introduction.tex`
- Create: `paper/sections/related-work.tex`
- Create: `paper/sections/method.tex`
- Create: `paper/sections/data-protocol.tex`
- Create: `paper/sections/results.tex`
- Create: `paper/sections/limitations.tex`
- Create: `paper/sections/conclusion.tex`
- Create: `paper/arxiv/00README.md`
- Create: `paper/figures/.gitkeep`

**Step 1: Scaffold one compilation entry point**

Use a conservative `article` source compatible with arXiv TeX Live. Include
only widely available packages (`amsmath`, `amssymb`, `booktabs`, `graphicx`,
`hyperref`, `microtype`, `natbib`, `geometry`). Put author/date/code/data
availability in `main.tex`; include each section exactly once.

**Step 2: Add primary-source bibliography entries**

Include primary sources for Sklar/Gaussian dependence modelling, conformal
prediction and non-exchangeable time-series caveats, Fisher combination,
Benjamini--Hochberg, robust scale, PCA, Isolation Forest, convolutional
autoencoders, Spectral Residual, the two NESO datasets/licence, the GB 2019
incident, named storms, and the UK lockdown annotation.

**Step 3: Document build and source-of-truth rules**

`paper/README.md` must say generated tables are never hand-edited, list the
build/check/bundle commands, identify the initial evidence commit
`0eafb4851bd53dd88ee5cc8ee253bd1cc536360b`, and explicitly note that a public
archive URL/DOI is still required before submission.

**Step 4: Generate the tables**

Run: `bun run scripts/generate-paper-tables.ts`  
Expected: both `paper/generated/*.tex` files are created deterministically.

**Step 5: Commit**

```bash
git add paper
git commit -m "docs: add canonical TRACE-C LaTeX paper source"
```

### Task 4: Rewrite the manuscript around the shipped evidence

**Files:**
- Modify: `paper/sections/*.tex`

**Step 1: Write the abstract and contributions**

State only completed contributions: the implemented three-channel detector,
the selection/accounting layer, the disclosure/frozen-holdout protocol, and
the real-data/post-hoc baseline evidence. Say `conformal p-values`, not alert
probabilities. Do not claim synthetic or matched-budget results.

**Step 2: Write introduction and related work**

Frame the problem as multi-stream operational telemetry. Compare explicitly
with univariate seasonal detectors, reconstruction/density baselines, copula
models, and conformal methods under drift. Remove internal/product language.

**Step 3: Write the implementation-accurate method**

Document rolling robust-z residuals, the Gaussian copula-form contrast,
AR(1) innovation score, trailing channel ranks, Fisher fusion, growing outer
rank p-value, BH attempt/fallback behavior, and two-alert fixed-48-row-block
budget. Mark any richer review-item schema as proposed, not implemented.

**Step 4: Write data and protocol**

Describe six NESO streams, date boundaries, event opportunity windows,
development-vs-frozen status, post-hoc event annotations, external baseline
timing, checksums/provenance, and required NESO attribution.

**Step 5: Integrate results before limitations**

Include generated tables, interpret mixed baseline outcomes, report empirical
calibration counts without claiming proof, correct the lockdown best-window
date, and present Ellen/Alex only as post-ranking external interpretations.

**Step 6: Write limitations and conclusion**

Cover exchangeability, seasonal/autocorrelated scores, aggregation resolution,
unequal label opportunity, post-hoc baselines, record-rule saturation, DST
block budgeting, robust-z/copula-form terminology, and the small event set.
End with a research conclusion, not a product recommendation.

**Step 7: Run prose searches**

Run:

```bash
rg -n -i "unilink|staff assist|visitsense|customer|product path|ship TRACE-C|alert probabilit|prove.*p-value|Open Government Licence|\\bOGL\\b|±2\\.33|top two.*Alex" paper
```

Expected: no publication-prose matches (licence discussion may mention that the
NESO licence is based on OGL only inside a citation note if required).

**Step 8: Commit**

```bash
git add paper/sections
git commit -m "docs: reconcile TRACE-C manuscript with frozen evidence"
```

### Task 5: Add automated publication checks and package scripts

**Files:**
- Create: `tests/paper-check.test.ts`
- Create: `scripts/check-paper.ts`
- Create: `scripts/package-paper.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Step 1: Write failing paper-check tests**

Test that checks fail when a generated table is changed, a required citation
key is absent, a stale phrase is injected, or the immutable evidence commit is
missing. Test arXiv manifest construction without creating an archive.

**Step 2: Run the focused test and verify it fails**

Run: `bun test tests/paper-check.test.ts`  
Expected: FAIL because the check/package modules do not exist.

**Step 3: Implement checks and packaging**

`paper:check` regenerates tables in memory, compares exact committed content,
checks references/citations and banned phrases, then invokes LaTeX compilation
through the build task. `paper:arxiv` first runs checks, then creates an
explicit minimal bundle containing only `main.tex`, `sections/`, `generated/`,
`references.bib`, and required figures/readme. Never sweep repository globs.

**Step 4: Add package scripts**

Add:

```json
"paper:tables": "bun run scripts/generate-paper-tables.ts",
"paper:lint": "bun run scripts/check-paper.ts",
"paper:build": "latexmk -cd -pdf -bibtex -interaction=nonstopmode -halt-on-error -outdir=build paper/main.tex",
"paper:check": "bun run paper:lint && bun run paper:build",
"paper:arxiv": "bun run paper:check && bun run scripts/package-paper.ts"
```

Ignore LaTeX auxiliary/build products and generated archive files, but commit
the generated `.tex` tables.

**Step 5: Run focused and full tests**

Run:

```bash
bun test tests/paper-check.test.ts
bun run paper:lint
bun run check
```

Expected: all pass.

**Step 6: Commit**

```bash
git add tests/paper-check.test.ts scripts/check-paper.ts scripts/package-paper.ts package.json .gitignore
git commit -m "build: verify and package TRACE-C paper"
```

### Task 6: Compile, inspect, and verify the arXiv source bundle

**Files:**
- Generated (ignored): `paper/build/*`
- Generated (ignored): `paper/arxiv/trace-c-arxiv.tar.gz`

**Step 1: Run the LaTeX environment doctor**

Use `latex:latex-doctor` to confirm `latexmk`, `pdflatex`, and BibTeX are
available and select the repository-local build command.

**Step 2: Compile from a clean paper build directory**

Run: `bun run paper:build`  
Expected: exit 0; no undefined references/citations in the final pass.

**Step 3: Inspect the PDF**

Use the PDF skill to render every page and inspect for clipped tables, bad
line breaks, empty sections, unreadable footnotes, and reference failures.
Fix source and recompile until clean.

**Step 4: Build the arXiv bundle**

Run: `bun run paper:arxiv`  
Expected: a source archive plus a printed manifest/hash.

**Step 5: Recompile the extracted bundle independently**

Extract into a newly created temporary directory and run `latexmk` there.  
Expected: exit 0 and a PDF matching the repository build semantically.

**Step 6: Commit any source fixes**

```bash
git add paper package.json scripts tests .gitignore
git commit -m "fix: polish compiled TRACE-C paper"
```

### Task 7: Replace the vault draft with a canonical-source pointer

**Files:**
- Modify: `/Users/mars/MARS BRAIN/Mars/04-Research/TRACE-C — Copula-Calibrated Temporal Relational Anomaly Detection (arXiv draft).md`

**Step 1: Replace the duplicate manuscript**

Keep valid Obsidian frontmatter, title, status, tags, and related-note links.
Replace the body with a concise migration notice containing:

- canonical repository path `/Users/mars/mars-dev/TRACE-C/paper/main.tex`;
- build/check commands;
- migration date and design commit;
- a warning not to edit two manuscript copies; and
- a short note that arXiv submission/public DOI remains pending.

**Step 2: Verify Obsidian syntax and terminology**

Run targeted searches for broken frontmatter and prohibited names.  
Expected: valid YAML delimiters, working wikilinks, and no Unilink/product copy.

**Step 3: Confirm repository status**

The vault is intentionally outside the TRACE-C Git repository. Record the
sync in the final handoff; do not claim it was included in the Git commit.

### Task 8: Final release verification

**Files:**
- Modify only if a verification failure exposes a defect.

**Step 1: Run every gate from the repository root**

```bash
bun run check
bun run paper:check
bun run paper:arxiv
git diff --check
git status --short
```

Expected: all commands pass; Git status contains no unintended files.

**Step 2: Re-run factual assertions directly against JSON**

Confirm event ranks, best-window dates, empirical counts, alert counts,
baseline cells, provenance hashes, licence text, and required attribution.

**Step 3: Review the final Git diff and history**

Verify only approved paper/repository synchronization changes landed and no
raw data, TensorBoard events, build products, or secrets are tracked.

**Step 4: Final commit if needed**

```bash
git add <verified-files-only>
git commit -m "docs: finish TRACE-C arXiv paper package"
```

**Step 5: Handoff**

Report the canonical manuscript/PDF paths, exact commit, build/check results,
known remaining external steps (public remote/archive and arXiv submission),
and the vault-pointer status.
