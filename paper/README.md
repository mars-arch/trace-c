# TRACE-C paper source

`main.tex` is the sole canonical paper source. Section files are included from
there in manuscript order; generated tables are evidence artifacts and must
never be hand-edited.

## Build

From the repository root:

```bash
bun run scripts/generate-paper-tables.ts
latexmk -cd -pdf -interaction=nonstopmode -halt-on-error paper/main.tex
```

The bibliography uses BibTeX (`natbib`/`plainnat`); `biber` is not required.
Until package scripts are added, run these commands manually. The generated files are `paper/generated/results-table.tex`,
`paper/generated/baseline-table.tex`, and
`paper/generated/ablation-table.tex`.

This scaffold reflects evidence commit `88aa648` (`fix: align data fetcher
with NESO licence`) and the original frozen evidence lineage
`0eafb4851bd53dd88ee5cc8ee253bd1cc536360b`. A public archive URL and DOI are
still required before submission. Data are used under the NESO Open Data
Licence with the exact attribution `Supported by National Energy SO Open Data`.
