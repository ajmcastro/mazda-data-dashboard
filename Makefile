.PHONY: models migrate-models setup profile ingest model timezone unmapped screenshots alerts reset-db api web dev types test lint format clean sample-data demo-ingest demo audit mobile-pack mobile-demo-pack mobile-install mobile-dev mobile-build mobile-golden mobile-golden-real mobile-test mobile-typecheck

# ---- car models (PLAN.md M21-M28) ----
# MODEL=cx60 acts on one model (ids are listed in config/models.yaml). Without it, the commands that load,
# rebuild or check (ingest, model, alerts, timezone, unmapped, mobile-pack) act on every model; the ones that
# delete or need a single database (reset-db, mobile-golden-real) refuse when there are several.
MODELS = $(if $(MODEL),$(MODEL),$(shell cd backend && uv run python -m mazda_dash.models ids))
ONE = $(if $(MODEL),--model $(MODEL),)

# the models, with where each one's data, database and configuration live
models:
	cd backend && uv run python -m mazda_dash.models show

# move a single-car install (data/*.csv, db/mazda.duckdb) into data/cx5/ and db/cx5.duckdb; shows the moves and asks first
migrate-models:
	cd backend && uv run python -m mazda_dash.models migrate

setup:
	cd backend && uv sync
	cd frontend && npm install

profile:
	cd backend && uv run python -m mazda_dash.profile "$$(uv run python -m mazda_dash.models data $(ONE))" ../docs/profile

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
	cd backend && for m in $(MODELS); do echo "== $$m"; uv run python -m mazda_dash.ingest --model $$m || exit 1; done

reset-db:
	cd backend && db="$$(uv run python -m mazda_dash.models db $(ONE))" && rm -f "$$db" "$$db.wal"

model:
	cd backend && for m in $(MODELS); do echo "== $$m"; uv run python -m mazda_dash.model --model $$m || exit 1; done

# Does car_timezone in config/models/<id>/settings.yaml fit your data? (suggests zones when it does not)
timezone:
	cd backend && for m in $(MODELS); do echo "== $$m"; uv run python -m mazda_dash.timezone_check --model $$m; done

unmapped:
	cd backend && for m in $(MODELS); do echo "== $$m"; uv run python -c "import duckdb, sys; [print(r) for r in duckdb.connect(sys.argv[1], read_only=True).execute('SELECT * FROM v_unmapped_codes ORDER BY kind, occurrences DESC').fetchall()]" "$$(uv run python -m mazda_dash.models db --model $$m)"; done

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
	cd backend && for m in $(MODELS); do echo "== $$m"; uv run python -m mazda_dash.alerts --model $$m || exit 1; done

# Synthetic data in the same format as the Mazda exports (no personal data), committed in sample_data/
sample-data:
	cd backend && uv run python -m mazda_dash.sample ../sample_data

# Try the app without your own data: load sample_data/ into db/demo.duckdb and serve it
demo-ingest:
	cd backend && uv run python -m mazda_dash.ingest --model cx5 --data ../sample_data --db ../db/demo.duckdb

demo: demo-ingest
	MAZDA_DB=../db/demo.duckdb $(MAKE) -j2 api web

# Scan the repo and its git history for your VIN / location / other private values (see README)
audit:
	cd backend && uv run python -m mazda_dash.audit --data ../data --repo ..

# ---- offline phone app (mobile/), see PLAN.md M12-M16 ----

# Data pack of YOUR database (db/<model>.cx5pack) to copy to the phone (AirDrop / Files). Contains your VIN.
mobile-pack:
	cd backend && for m in $(MODELS); do uv run python -m mazda_dash.pack --model $$m || exit 1; done

# Data pack of the synthetic demo database: the phone app ships it as its "Load demo data"
mobile-demo-pack: demo-ingest
	cd backend && uv run python -m mazda_dash.pack --db ../db/demo.duckdb --out ../mobile/public/demo.cx5pack

# the phone app's packages (installed on first use, again when package-lock.json changes)
mobile/node_modules: mobile/package-lock.json
	cd mobile && npm install
	@touch mobile/node_modules

mobile-install: mobile/node_modules

# Phone app on http://localhost:5174 (demo data bundled). HOST=1 lets a phone on the same Wi-Fi open it;
# stop it with Ctrl+C afterwards. Import your own pack from the app's Data screen (make mobile-pack).
mobile-dev: mobile/node_modules mobile-demo-pack
	cd mobile && npm run dev -- $(if $(HOST),--host,)

# Production build into mobile/dist (what gets hosted); includes the synthetic demo pack only
mobile-build: mobile/node_modules mobile-demo-pack
	cd mobile && npm run build

# ---- phone data engine (M13): the TypeScript re-implementation of the API, proven against the Python one ----

# Record what the real Python API answers on the sample data (+ the pack the engine loads) into mobile/contract/
mobile-golden:
	cd backend && uv run python -m mazda_dash.contract --out ../mobile/contract

# Same on YOUR database (copied first), to catch what the small sample hides. Contains your VIN: mobile/contract/real
# is gitignored; delete it afterwards (rm -r mobile/contract/real).
mobile-golden-real:
	cd backend && uv run python -m mazda_dash.contract --db "$$(uv run python -m mazda_dash.models db $(ONE))" --out ../mobile/contract/real
	cd mobile && CONTRACT_DIR=contract/real npm test

mobile-typecheck: mobile/node_modules
	cd mobile && npm run typecheck

mobile-test: mobile/node_modules mobile-golden mobile-typecheck
	cd mobile && npm test

# Re-take the README screenshots from the synthetic demo data (needs Google Chrome; starts and stops its own
# servers on :8000, :5173 and :5174, so stop `make dev` first). Set CHROME_PATH if Chrome is elsewhere.
screenshots: demo-ingest mobile-demo-pack mobile/node_modules
	cd docs/screenshots && npm install --no-audit --no-fund && node capture.mjs
