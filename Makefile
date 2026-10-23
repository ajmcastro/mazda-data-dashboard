.PHONY: setup profile ingest model unmapped reset-db api web dev types test lint format clean

setup:
	cd backend && uv sync
	cd frontend && npm install

profile:
	cd backend && uv run python -m mazda_dash.profile ../data ../docs/profile

test:
	cd backend && uv run pytest
	cd frontend && npm test

lint:
	cd backend && uv run ruff check .
	cd frontend && npm run lint && npm run typecheck

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

api:
	cd backend && uv run uvicorn mazda_dash.api.app:app --reload --port 8000

web:
	cd frontend && npm run dev

# API on :8000 and the Vite dev server on :5173 (proxies /api to the API)
dev:
	$(MAKE) -j2 api web

# Regenerate the frontend's TypeScript types from the API's OpenAPI schema
types:
	cd backend && uv run python -m mazda_dash.api.openapi > ../frontend/openapi.json
	cd frontend && npm run types
