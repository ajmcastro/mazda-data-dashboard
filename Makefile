.PHONY: setup profile ingest model unmapped reset-db test lint format clean

setup:
	cd backend && uv sync

profile:
	cd backend && uv run python -m mazda_dash.profile ../data ../docs/profile

test:
	cd backend && uv run pytest

lint:
	cd backend && uv run ruff check .

format:
	cd backend && uv run ruff format .

clean:
	rm -rf docs/profile backend/.pytest_cache backend/.ruff_cache

ingest:
	cd backend && uv run python -m mazda_dash.ingest --data ../data --db ../db/mazda.duckdb

reset-db:
	rm -f db/mazda.duckdb db/mazda.duckdb.wal

model:
	cd backend && uv run python -m mazda_dash.model --db ../db/mazda.duckdb --config ../config/codes

unmapped:
	cd backend && uv run python -c "import duckdb; [print(r) for r in duckdb.connect('../db/mazda.duckdb', read_only=True).execute('SELECT * FROM v_unmapped_codes ORDER BY kind, occurrences DESC').fetchall()]"
