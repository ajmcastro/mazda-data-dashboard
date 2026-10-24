# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

A working project: all milestones in `PLAN.md` (M1–M11) are done. Python backend in `backend/` (uv), React frontend in `frontend/`, private raw exports in `data/` and databases in `db/` (both gitignored), synthetic `sample_data/` that is committed. `README.md` is the user-facing guide; `docs/data-dictionary.md` documents the files, tables and views; `PLAN.md` keeps the decisions and what each milestone built.

Commands (from the repo root, full list in the README): `make setup`, `make ingest` (loads `data/` into `db/mazda.duckdb`, idempotent, then evaluates alerts), `make dev` (API :8000 + Vite :5173; open http://localhost:5173), `make demo` (same with the synthetic data in its own database), `make model` (reload `config/codes/*.yaml` and recreate views), `make unmapped` (codes lacking a description), `make alerts`, `make types` (regenerate `frontend/src/api/schema.d.ts` after changing API models), `make test` / `make lint` (backend and frontend), `make format` (backend), `make profile` (writes `docs/profile/`, gitignored), `make audit`, and `make reset-db` (deletes the database, alert acknowledgements included).

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

## Alerts

`backend/src/mazda_dash/alerts/`: `config.py` (strict pydantic model of `config/alerts.yaml`; typos fail loudly), `detectors.py` (one function per rule, registry `DETECTORS`; rule names must match fields of `Rules`), `store.py` (`alerts` table, `add_if_new` keyed by `dedup_key`), `engine.py` (`run_alerts`), `notify.py` (optional macOS notification). Rules are raised once per `dedup_key` regardless of status, so acknowledged alerts never come back; event rules only look back `lookback_days` from the newest data point, state rules (`recurring_dtc`, `low_fuel`, `data_gap`) evaluate the current state. To add a rule: model in `config.py` + detector + test in `tests/test_alerts.py`. The API lists/acknowledges alerts (`/api/alerts*`, the only write endpoints, using a short read-write connection that returns 503 while `make ingest` holds the lock); the UI page is `frontend/src/pages/Alerts.tsx`. Alerts live in the same DuckDB file, so `make reset-db` loses acknowledgements.

## Diagnostics and fault deep dives

API: `/api/diag/reports` (+ `/{id}`, `/{id}/frames`) and `/api/diag/compare?a=&b=` serve the diagnostic-tool dump (several reports can be ingested; the page gets a report picker and a comparison table automatically). `/api/dtcs/frames` gives a DTC's distinct freeze frames and `/api/dtcs/context?transaction_id=` the warnings (+/- N hours), other faults and closest status snapshot around a read-out. UI: `frontend/src/pages/Diagnostics.tsx` and `frontend/src/components/FaultDetail.tsx` (shown on the Faults page when a code is selected). The older `/api/dtcs/snapshots` endpoint is still served but unused by the UI.

## Sample data, audit and CI

`backend/src/mazda_dash/sample.py` generates deterministic synthetic exports (`make sample-data` -> committed `sample_data/`; the VIN is `SAMPLEVIN00000001`, nothing comes from a real car). It is shaped to trigger every alert rule, so changing a detector or a view usually means checking `tests/test_sample.py` too. `make demo` ingests it into `db/demo.duckdb` and serves it. `mazda_dash/audit.py` (`make audit`) reads the VINs/positions from the real `data/` files and greps the publishable files and the full git history for them; never hardcode a real VIN anywhere to "check" for it. `.github/workflows/ci.yml` runs ruff, pytest, oxlint, tsc, vitest, the build, and checks that `make types sample-data` leave no diff. Charts honour `prefers-reduced-motion` via `ANIMATE` in `frontend/src/lib.ts`. README screenshots in `docs/screenshots/` were taken from the demo data with headless Chrome (puppeteer-core, dark scheme, reduced motion).

## Date range

Period-based endpoints take optional `from` / `to` query params (inclusive UTC days) through the `date_range` dependency in `backend/src/mazda_dash/api/dates.py`; `DateRange.clause(col)` returns the SQL fragment. A new period-based endpoint should use it and be added to `PERIOD_ENDPOINTS` in `tests/test_date_range.py`, which asserts that a range covering everything changes nothing and that an empty range returns empty results, not errors. State endpoints (active faults, alerts, diagnostics, code lookups) must not use it. Some views are re-aggregated inside the endpoint to honour the range (`fuel/monthly`, `warnings/frequency`, `dtcs/frequency`): keep them in step with `v_fuel_monthly`, `v_warning_frequency`, `v_dtc_frequency`. `dtcs/frequency` always lists faults that are active in the latest read-out. Frontend: the range lives in the URL (`frontend/src/range.ts`, `useDateRange`), every period-based hook in `api/hooks.ts` calls `useRangeQuery()` and puts it in its query key, and pages link with `RangeLink` / `RangeNavLink` so the range is carried along. `DateRangeBar` is rendered for the pages in `PERIOD_PAGES` in `App.tsx`. Pure helpers (`sanitizeRange`, `editRange`, `daysInRange`) are in `lib.ts` with tests.

Quick ranges (M9): the preset maths is pure and tested in `lib.ts` (`PRESETS`, `resolvePreset`, `matchPreset`, `restoreRange`); presets count back from the newest day with data (`/api/span`), inclusive, clamped to the first day. The URL always holds explicit `from`/`to`; which preset is highlighted is derived by matching, so there is no separate preset state to drift. The last choice is stored in `localStorage` (`cx5.range`: a preset id, `all` or `custom`) and `useRestoreSavedRange` (in `range.ts`, called from `App`) re-applies a saved preset once per page load, only when the address has no period. The bar uses native radio inputs for keyboard support.

## Trends (monthly comparison)

`backend/src/mazda_dash/api/trends.py` builds one row per calendar month in the period (`GET /api/trends/monthly`), from the events inside the period, with `days_covered` / `partial`; months without data stay in the series with `None` metrics (a gap, not 0). Distance is odometer-based (it matches `km_in_range`), consumption comes from trip segments, and "new faults" excludes anything first reported on the first diagnostic day. `tests/test_trends.py` pins these (including the gap and partial-month cases). All comparison logic lives in `frontend/src/trends.ts` (`METRICS` definitions with polarity, `metricValue`, `compare`, `describeChange`) and is unit tested; `pages/Trends.tsx` only renders. To add a metric: add the field to `MonthMetrics` and `monthly_metrics`, add a `MetricDef` (set `additive` for totals so "per day" works and `polarity` for the green/red colouring), and extend the tests.

## Several diagnostic reports (M10)

A report's id is a hash of the dump's content, so different dumps (even same date and VIN) are separate reports and an identical copy under another file name is skipped. `GET /api/diag/history` returns one headline row per report (oldest first) for the history table and charts (`components/ReportHistory.tsx`). The Diagnostics page keeps its selection in the URL (`?report=` and `?compare=`, via `pickReport` in `lib.ts`; an unknown id falls back to the newest report with a notice) and always orders a comparison from the earlier to the later report. `sample.py` writes three visits (`DIAG_VISITS`); changing them means updating `tests/test_diag_reports.py` and `tests/test_sample.py`.

## Offline phone app (planned, M12 done)

`PLAN.md` ("Standalone offline app for iPhone") describes the planned `mobile/` app. Done so far (M12, a feasibility spike): `backend/src/mazda_dash/pack.py` exports the database as a `.cx5pack` (Parquet tables + manifest; GPS positions excluded; `--reference` adds per-view fingerprints), and `mobile/` holds a throwaway spike page that proves DuckDB-WASM rebuilds all views from the pack identically in Chrome, desktop Safari and iOS Safari 27 in the Simulator (`make mobile-spike-prod`; results in `mobile/spike-results/`). Measured numbers and the go decision are in `PLAN.md`. `*.cx5pack` files contain a VIN: they are gitignored and must never be served on the network (the spike serves only `mobile/public/demo.cx5pack`, built from the synthetic data). The existing `frontend/` and `backend/` runtime are unchanged by this work.
