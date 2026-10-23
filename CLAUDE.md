# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The repository so far has a `uv` backend skeleton (`backend/`: profiling script and the `mazda_dash.ingest` package; milestones M1–M4 done; React frontend in `frontend/`) and raw data in `data/` (gitignored). Follow `PLAN.md` milestone by milestone. Commands (from repo root): `make setup`, `make profile` (writes `docs/profile/`, gitignored), `make ingest` (loads `data/` into `db/mazda.duckdb`, idempotent), `make model` (reload `config/codes/*.yaml` and recreate views), `make unmapped` (codes lacking a description), `make reset-db`, `make dev` (API :8000 + Vite :5173; open http://localhost:5173), `make api` / `make web` separately, `make types` (regenerate `frontend/src/api/schema.d.ts` after changing API models), `make test` / `make lint` (backend and frontend), `make test`, `make lint`, `make format`.

## Data overview (`data/`)

All files are telemetry/diagnostic exports for a single vehicle (one VIN, a Mazda "24PF" platform). Dates are in 2026. The CSVs are fully quoted, comma-separated with a header row; empty strings are common (missing values), so parse them as nulls rather than zeros.

| File | Rows | Contents |
|---|---|---|
| `all-war-24pf_war-24pf.csv` | ~7k | Warning events: trigger time, hours/minutes, odometer, `WARNING_LIST` (comma-separated `$`-prefixed hex codes, e.g. `$182,$21D`) |
| `all-dtc-d-24pf_dtc-d-24pf.csv` | ~1.1k | DTC events per ECU (`ECU_NAME_MKT`, `DISPLAY_DTC` like `U2701:89`, status flags) |
| `all-dtc-h-24pf_dtc-h-24pf.csv` | ~47 | DTC header/timing info (trigger time, odometer) |
| `all-dtc-ssr-24pf_dtc-ssr-24pf.csv` | ~137 | DTC snapshot records: very wide (hundreds of columns, mostly empty) freeze-frame data per DTC |
| `all-rts-24pf_rts-24pf.csv` | ~214 | Remote vehicle status snapshots (odometer, fuel, trip, etc.) as `<signal>_value` / `<signal>_validstatus` column pairs |
| `all-vis-24pf_vis-24pf.csv` | ~197 | Vehicle info status (door/lock/hood states) in the same `_value`/`_validstatus` pair format |
| `all-alt-24pf_alt-24pf.csv` | 4 | Alarm/burglar status |
| `all-24pf-diag-tool_…_20261015_090243.txt` | ~480 | Free-text "Collect Diagnostic Information" dump from a diagnostic tool (Mode 9 ECM data, VOD counters, OCC vehicle data sections) |

Things to know before writing parsing code:

- **Joining across files**: only `dtc-d` and `dtc-h` share `X_TRANSACTION_ID` (verified). `war` and `dtc-ssr` have their own ids and link to `dtc-h` via `WARNING_TRIGGER_OCCURRENCE_TM`. The `rts`/`vis`/`alt` files use lowercase column names (`vin`, `fileid_datetime`, `datacreationtime`) and have no transaction id — correlate them by timestamp. Full findings in `docs/data-dictionary.md`.
- **Sentinels**: `2147483647` / `4294967295` / odometer `-1` mean unknown; `dtc-ssr` is 404/487 empty columns.
- **Mixed timestamp formats**: `COPIED_DT_TM`/`fileid_datetime` are `YYYY-MM-DD HH:MM:SS` (no zone); `*_TM`/`datacreationtime` are ISO-8601 UTC (`…Z`). The diag-tool text file uses `UTC+0100` local time.
- **Signal value/validity pairs**: in `rts`/`vis`/`alt`, always check the sibling `_validstatus` column before trusting a `_value`.
- **`dtc-ssr`** snapshot columns include a `Time_UTC_Information_*` set split across Year/Month/Date/Hour/Minute fields.
- The diag-tool `.txt` is section-structured (`ModuleName:`, `VOD - …`, `… OCC Vehicle Data`, lines of `(KEY) = value [unit]`), not CSV.

## Backend architecture

`backend/src/mazda_dash/ingest/`: `schema.py` (DuckDB DDL), `csv_loaders.py` (SQL-based loaders, one per CSV kind, all via `_insert_new` = anti-join on the key + in-file dedupe), `diag_parser.py` (state-machine parser for the text dump, pure Python), `__init__.py` (file discovery by `*_<kind>-*.csv`, runner, CLI). Table keys and sentinel rules are in `docs/data-dictionary.md`. Tests use synthetic fixtures in `backend/tests/conftest.py`; run one with `cd backend && uv run pytest tests/test_ingest.py::test_dtc_kinds`. DuckDB 2.x: use `con.execute(...).fetchone()`, not `con.sql(...).fetchone()`.

`backend/src/mazda_dash/model/`: `lookups.py` loads and validates `config/codes/{warnings,dtcs,ecus,failure_types}.yaml` into `ref_*` tables; `views.sql` defines all `v_*` views (executed as one script by `build_model`; `at` is a reserved word in DuckDB). `ingest()` calls `build_model` when given a config dir. View catalogue and the signal interpretations are in `docs/data-dictionary.md`. Code descriptions are user-maintained (Mazda does not publish them): never invent titles, leave `title: null`.

## API and frontend

`backend/src/mazda_dash/api/`: `app.py` (read-only FastAPI endpoints under `/api`, each a thin query over a `v_*` view), `models.py` (Pydantic response models = the OpenAPI contract), `db.py` (one short-lived read-only DuckDB connection per request so `make ingest` can write between calls; DB path from `MAZDA_DB`, default `../db/mazda.duckdb`; naive UTC timestamps are returned as explicit `...Z`). Add an endpoint by adding a model + route, then `make types`.

`frontend/` (Vite + React 19 + TypeScript): `src/api/hooks.ts` (typed `openapi-fetch` client + TanStack Query hooks; `schema.d.ts` and `openapi.json` are generated, do not edit), `src/pages/` (Overview, Warnings, Faults, Status), `src/components/ui.tsx` (Panel, Stat, sortable DataTable, QueryState), `src/lib.ts` (formatters; tests in `lib.test.ts`, run with `cd frontend && npm test`). Vite proxies `/api` to :8000. Styling is one hand-written `src/index.css` using CSS variables (dark default, light via `prefers-color-scheme`); fonts come from Google Fonts. npm quirk: `frontend/.npmrc` sets `legacy-peer-deps` because plain `npm install` crashes with this dependency set, so peers such as `react-is` (needed by Recharts) must be listed explicitly.
