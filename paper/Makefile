# TRACE-C paper build. Run from paper/ (or `make -C paper` from the repo root).
#
#   make tables   regenerate evidence-bound tables from committed reports
#   make pdf      full build (tables + latexmk)
#   make check    tables must be byte-identical to the committed evidence
#   make arxiv    clean source bundle for arXiv upload
#   make clean    remove LaTeX build artifacts

LATEXMK := latexmk -cd -pdf -interaction=nonstopmode -halt-on-error
BUNDLE  := arxiv/trace-c-arxiv.tar.gz

.PHONY: pdf tables figures check arxiv clean

pdf: tables figures
	$(LATEXMK) main.tex

tables:
	cd .. && bun run scripts/generate-paper-tables.ts

figures:
	cd .. && bun run scripts/generate-paper-figures.ts

# Generated tables are evidence artifacts: regenerating from the committed
# JSON reports must be a no-op. A diff here means the tables were hand-edited
# or the reports changed without regenerating — both are failures.
check: tables figures
	git diff --exit-code -- generated/

arxiv: pdf
	tar -czf $(BUNDLE) \
	  main.tex references.bib main.bbl \
	  sections/*.tex generated/*.tex \
	  $$(ls figures/* 2>/dev/null | grep -v .gitkeep || true)
	@echo "bundle: paper/$(BUNDLE)"
	@tar -tzf $(BUNDLE)

clean:
	latexmk -cd -C main.tex
	rm -f main.bbl $(BUNDLE)
