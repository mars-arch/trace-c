#!/usr/bin/env bash
# Render the evidence-bound paper figures to PNGs for the README (GitHub
# cannot render TikZ). The PNGs in assets/ are presentation copies of
# paper/generated/fig-*.tex — the .tex files remain the bound artifacts.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets

render() { # $1 = generated fig basename, $2 = out png, $3 = paperwidth cm, $4 = paperheight cm
  local tmp
  tmp="$(mktemp -d)"
  # extract just the tikzpicture from the figure* environment
  sed -n '/\\begin{tikzpicture}/,/\\end{tikzpicture}/p' "paper/generated/$1" > "$tmp/pic.tex"
  cat > "$tmp/doc.tex" <<EOF
\\documentclass{article}
\\usepackage[paperwidth=$3cm,paperheight=$4cm,margin=0.15cm]{geometry}
\\usepackage{tikz}
\\pagestyle{empty}
\\begin{document}
\\noindent\\input{pic.tex}
\\end{document}
EOF
  (cd "$tmp" && pdflatex -interaction=nonstopmode doc.tex >/dev/null)
  pdftoppm -png -r 220 -f 1 -l 1 "$tmp/doc.pdf" "$tmp/out"
  mv "$tmp"/out-1.png "assets/$2"
  rm -rf "$tmp"
  echo "assets/$2"
}

render fig-rank-diagnostics.tex fig-rank-diagnostics.png 18.5 5.0
render fig-holdout-timeline.tex fig-holdout-timeline.png 17.2 4.6
