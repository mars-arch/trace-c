# Publishing checklist — byline: Matthew Faucher, from current accounts

Decision (2026-08-19, revised same day): the paper byline is **Matthew
Faucher, independent researcher**; publishing happens from the existing
accounts (GitHub `mars-arch`, HF `mars2titan`, personal arXiv account). The
byline↔account linkage is accepted deliberately — no pseudonymity machinery.
This file stays in the repo (nothing in it is secret) but is not part of the
arXiv bundle.

## Pre-publication gate (run before any push/upload)

```bash
# local-machine paths and private-vault names must not ship
git grep -n -E "/Users/|MARS BRAIN" -- ':!PUBLISHING.md' ':!docs/plans/*' && echo LEAK || echo clean
bun test && make -C paper check && make -C paper pdf
```

`docs/plans/` contains local paths by nature — either scrub it or exclude it
from the public repo (`.gitignore` it before the public push, or keep it and
accept that dev-machine paths are visible; they are paths, not secrets).

## 1. GitHub

- Push this repo (full history is fine — the disclosure ledger is on-brand)
  to `github.com/mars-arch/trace-c`, public.
- Tag the published state: `git tag publication-v1 && git push --tags`.

## 2. arXiv

- Continue **submit/7967407** (Update). Do not start a second new submission.
- Classification (three separate fields on the submission form):
  - Subject class: primary **stat.AP**; cross-list **eess.SY** and **cs.LG**.
    Do not use cs.AI, cs.NE, or stat.ME (the paper disclaims coverage and FDR
    guarantees). Account groups now include `stat`, `eess`, and `cs`.
  - MSC classes: `62P30, 62M10, 62G30, 62J15` (engineering applications;
    time series; order statistics/empirical distributions; multiple testing).
  - ACM classes: `G.3, I.5.4, J.2`.
- Licence on the arXiv form (the paper PDF, not the code, not the NESO data):
  **Creative Commons Attribution 4.0 International (CC BY 4.0)**.
  Not CC BY-NC (blocks reuse). Not CC0 (does not cover NESO data). Not the
  default “arXiv.org perpetual non-exclusive licence” if CC BY 4.0 is offered.
  Code in the GitHub repo stays **MIT**. Telemetry stays **NESO Open Data
  Licence** with the exact attribution “Supported by National Energy SO Open
  Data.” Those two are not selected on the arXiv form.
- Submit from account `matthewfaucher`; the byline is Matthew Faucher.
  Do not print the ORCID on the title page. Paste
  `https://orcid.org/0009-0005-5238-731X` into the arXiv User Information /
  submission author ORCID field, and keep it in `CITATION.cff`.
- Bundle: `make -C paper arxiv` → `paper/arxiv/trace-c-arxiv.tar.gz`
  (includes `main.bbl`; arXiv does not need to run BibTeX).

## 3. Hugging Face (`mars2titan`)

- Dataset repo: aligned series export recipe, event annotations, committed
  reports, fetch scripts. Code MIT; data under the NESO Open Data Licence
  with the exact attribution "Supported by National Energy SO Open Data".
- Request a **DOI** on the dataset repo — it fills the paper's pending
  availability statement.
- Optional model repo: conv-AE baseline weights + tfevents (hosted
  Training-metrics tab). Label clearly as the paper's BASELINE, not TRACE-C.

## 4. After publishing

- Fill the availability statement in `paper/main.tex` (repo URL, DOI, arXiv
  id), rebuild, re-run `make -C paper check`.
- Fill the arXiv link placeholder in the README's **Paper** section, and add
  the DOI + `repository-code` URL to `CITATION.cff`.
- Order: GitHub push → HF dataset + DOI → arXiv (so the availability
  statement is complete in the submitted PDF).
