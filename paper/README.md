# TRACE-C paper source

`main.tex` is the sole canonical paper source. Section files are included from
there in manuscript order; generated tables are evidence artifacts and must
never be hand-edited.

## Build

```bash
make -C paper pdf     # regenerate evidence tables + latexmk → paper/main.pdf
make -C paper check   # tables must be byte-identical to committed evidence
make -C paper arxiv   # clean source bundle → paper/arxiv/trace-c-arxiv.tar.gz
make -C paper clean
```

The bibliography uses BibTeX (`natbib`/`plainnat`); `biber` is not required.
The generated files are `paper/generated/results-table.tex`,
`paper/generated/baseline-table.tex`, `paper/generated/ablation-table.tex`,
`paper/generated/fig-rank-diagnostics.tex`, and
`paper/generated/fig-holdout-timeline.tex` — evidence artifacts, never
hand-edited (`make check` enforces this). Figures are plain TikZ (no
`pgfplots`); `scripts/render-readme-figures.sh` renders PNG copies of them into
`assets/` for the repository README. LaTeX build artifacts are ignored via
`paper/.gitignore`.

This scaffold reflects evidence commit `88aa648` (`fix: align data fetcher
with NESO licence`) and the original frozen evidence lineage
`0eafb4851bd53dd88ee5cc8ee253bd1cc536360b`. A public archive URL and DOI are
still required before submission. Data are used under the NESO Open Data
Licence with the exact attribution `Supported by National Energy SO Open Data`.
