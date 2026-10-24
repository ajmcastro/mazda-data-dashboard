.PHONY: setup profile ingest model unmapped alerts reset-db api web dev types test lint format clean sample-data demo-ingest demo audit mobile-pack mobile-demo-pack mobile-install mobile-dev mobile-build mobile-golden mobile-golden-real mobile-test mobile-typecheck

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

alerts:
	cd backend && uv run python -m mazda_dash.alerts --db ../db/mazda.duckdb --config ../config/alerts.yaml

# Synthetic data in the same format as the Mazda exports (no personal data), committed in sample_data/
sample-data:
	cd backend && uv run python -m mazda_dash.sample ../sample_data

# Try the app without your own data: load sample_data/ into db/demo.duckdb and serve it
demo-ingest:
	cd backend && uv run python -m mazda_dash.ingest --data ../sample_data --db ../db/demo.duckdb --config ../config/codes --alerts-config ../config/alerts.yaml

demo: demo-ingest
	MAZDA_DB=../db/demo.duckdb $(MAKE) -j2 api web

# Scan the repo and its git history for your VIN / location / other private values (see README)
audit:
	cd backend && uv run python -m mazda_dash.audit --data ../data --repo ..

# ---- offline phone app (mobile/), see PLAN.md M12-M16 ----

# Data pack of YOUR database (db/mazda.duckdb) to copy to the phone (AirDrop / Files). Contains your VIN.
mobile-pack:
	cd backend && uv run python -m mazda_dash.pack --db ../db/mazda.duckdb --out ../db/mazda.cx5pack

# Data pack of the synthetic demo database: the phone app ships it as its "Load demo data"
mobile-demo-pack: demo-ingest
	cd backend && uv run python -m mazda_dash.pack --db ../db/demo.duckdb --out ../mobile/public/demo.cx5pack

mobile-install:
	cd mobile && npm install

# Phone app on http://localhost:5174 (demo data bundled). HOST=1 lets a phone on the same Wi-Fi open it;
# stop it with Ctrl+C afterwards. Import your own pack from the app's Data screen (make mobile-pack).
mobile-dev: mobile-demo-pack
	cd mobile && npm run dev -- $(if $(HOST),--host,)

# Production build into mobile/dist (what gets hosted); includes the synthetic demo pack only
mobile-build: mobile-demo-pack
	cd mobile && npm run build

# ---- phone data engine (M13): the TypeScript re-implementation of the API, proven against the Python one ----

# Record what the real Python API answers on the sample data (+ the pack the engine loads) into mobile/contract/
mobile-golden:
	cd backend && uv run python -m mazda_dash.contract --out ../mobile/contract

# Same on YOUR database (copied first), to catch what the small sample hides. Contains your VIN: mobile/contract/real
# is gitignored; delete it afterwards (rm -r mobile/contract/real).
mobile-golden-real:
	cd backend && uv run python -m mazda_dash.contract --db ../db/mazda.duckdb --out ../mobile/contract/real
	cd mobile && CONTRACT_DIR=contract/real npm test

mobile-typecheck:
	cd mobile && npm run typecheck

mobile-test: mobile-golden mobile-typecheck
	cd mobile && npm test
