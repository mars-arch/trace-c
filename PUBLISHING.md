# Publishing checklist — identity: Matthew Faucher only

Decision (2026-08-19): all public TRACE-C artifacts are authored by
**Matthew Faucher, independent researcher** — no other name, account, or
project identity may appear in anything published. This file is the
operational checklist; it is safe to keep in the private dev repo and must
be EXCLUDED from any public snapshot.

## Identity rules

- Byline, LICENSE, package metadata: Matthew Faucher (done in-tree).
- The dev repo's git history is NOT publishable (author/email would link
  identities). Publish a fresh single-commit snapshot, never a push of this
  history.
- Exclude from any snapshot: `PUBLISHING.md`, `docs/plans/` (contains local
  machine paths), anything gitignored.
- Accounts: create dedicated accounts (GitHub / arXiv / Hugging Face) under
  the Faucher identity with a dedicated email address. Do NOT publish from
  existing personal accounts — the linkage is permanent.

## 1. Snapshot export (fresh history, Faucher-authored)

```bash
cd "$(mktemp -d)" && mkdir trace-c && cd trace-c
git -C /path/to/dev/repo archive HEAD | tar -x
rm -rf PUBLISHING.md docs/plans
git init -q
git config user.name  "Matthew Faucher"
git config user.email "<dedicated Faucher address>"
git add -A && git commit -m "TRACE-C: reference implementation, evidence, and paper source"
```

Verify before pushing anywhere:

```bash
git grep -i -E "mars|heyamiko|icloud|/Users/" && echo LEAK || echo clean
bun test && make -C paper check && make -C paper pdf
```

## 2. arXiv

- Category: stat.AP (cross-list eess.SY).
- New submitters in stat.* typically need an **endorsement** — arrange this
  before planning a submission date.
- Bundle: `make -C paper arxiv` → `paper/arxiv/trace-c-arxiv.tar.gz`
  (includes `main.bbl`, so arXiv does not need to run BibTeX).
- After acceptance, add the arXiv id to README and the availability
  statement.

## 3. Hugging Face (dataset + optional baseline model)

- Dataset repo (Faucher account): aligned series export recipe, event
  annotations, committed reports, fetch scripts. Licence: code MIT; data
  redistributed under NESO Open Data Licence with the exact attribution
  "Supported by National Energy SO Open Data".
- Request a **DOI** on the dataset repo — this fills the paper's
  "public archive URL and DOI are pending" availability statement.
- Optional model repo: conv-AE baseline weights + tfevents (gives the hosted
  Training-metrics tab). Must be clearly labelled as the paper's BASELINE,
  not as TRACE-C.

## 4. After publishing

- Fill the availability statement in `paper/main.tex` (repo URL, DOI,
  arXiv id) and rebuild; re-run `make -C paper check`.
- Tag the dev repo commit the snapshot was cut from (`publication-vN`).
