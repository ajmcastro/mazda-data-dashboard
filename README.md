# CX-5 Telemetry

A local dashboard for the vehicle data Mazda holds about your car: warnings, fault codes, fuel
use, trips, tire pressure, doors, the alarm, and the report from a workshop diagnostic tool. It
turns the raw export files into a database, explains what they contain, and raises **alerts**
when something deserves attention (a new or recurring fault, a warning spike, a slow tire leak,
an alarm event, unusually high fuel use, or a stale export).

Everything runs on your machine. Your data never leaves it.

![Overview](docs/screenshots/overview.png)

<table>
  <tr>
    <td><img src="docs/screenshots/trends.png" alt="Month-by-month trends"></td>
    <td><img src="docs/screenshots/alerts.png" alt="Alerts"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/faults.png" alt="Fault explorer with freeze frames"></td>
    <td><img src="docs/screenshots/status.png" alt="Fuel, tires, trips and doors"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/diagnostics.png" alt="Diagnostic tool report"></td>
    <td><img src="docs/screenshots/warnings.png" alt="Warnings"></td>
  </tr>
</table>

*(Screenshots show the synthetic demo data in `sample_data/`, not a real car.)*

> **Unofficial.** This project is not affiliated with or endorsed by Mazda. The meaning of most
> warning and fault codes is not public, so the app ships with descriptions only where they are
> standard (SAE) and lets you add the rest. Several signal interpretations are inferred from the
> data (see [docs/data-dictionary.md](docs/data-dictionary.md)). It is a curiosity tool, not a
> substitute for a mechanic.

## Try it in two minutes (no data needed)

You need [uv](https://docs.astral.sh/uv/) and Node.js 20+.

```bash
make setup   # Python (via uv) and npm dependencies
make demo    # loads the synthetic sample data, then serves it
```

Open <http://localhost:5173>.

## Use your own data

1. Put your export files in `data/` (CSV files named like `*_war-*.csv`, `*_dtc-d-*.csv`,
   `*_rts-*.csv`, … and the diagnostic tool's `*diag-tool*.txt`). The folder is git-ignored.
2. `make ingest`: loads everything into `db/mazda.duckdb` (safe to re-run whenever you get a
   newer export) and evaluates the alert rules.
3. `make dev`: starts the API (`:8000`) and the dashboard (`:5173`).

**Trends.** The Trends page compares every month with the one before: distance, fuel
consumption, warnings, faults, tire pressure and more, as charts or as a table. The arrow is
green when the change is good for that figure (less fuel use) and red when it is bad. Months
the period cuts through are marked *partial*; tick **per day** to compare them fairly with full
months. A month with no data is a gap, never a zero.

**Looking at a period.** The bar at the top of the Overview, Warnings, Faults and Status pages
limits everything to a *from – to* range of days (UTC, both included). Use the quick buttons
(Last week, Last 2 weeks, Last 30 / 60 / 90 days, All time) or type your own dates. Quick
ranges count back from your **newest data**, not from today, so they still make sense when
your last export is a few weeks old, and your last quick choice is remembered in the browser.
The range is kept in the address, so you can bookmark it (a link with dates always wins over
the remembered choice), and it follows you from page to page. Things that describe a *state* ignore the range: the faults still active in the latest
read-out, the alerts list and the diagnostic-tool report.

Run `make unmapped` to see warning and fault codes that have no description yet, then add what
you learn to `config/codes/*.yaml` and run `make model`.

### Adding newer data later

You can keep adding exports as you receive them; history is never lost.

1. Put the new files in `data/`. Replacing the old files with the new ones is fine, and so is
   keeping both. Only the top level of `data/` is read, so moving older exports into
   `data/archive/` (also git-ignored) keeps them without reloading them.
2. Run `make ingest`. Only rows that are not in the database yet are added. Every row is matched
   by its transaction id or timestamp, so an export that overlaps (or repeats) earlier data
   creates no duplicates, and a cumulative export that starts from the beginning is fine too.
   The output shows how many new rows each file added (`new=0` means nothing new).
3. Open the dashboard (`make dev`). Alerts are re-evaluated; ones you already acknowledged stay
   acknowledged.

A new diagnostic-tool `.txt` file becomes an additional report on the Diagnostics page.

Things to know:

- Your history lives in `db/mazda.duckdb`, not in `data/`. **Don't run `make reset-db`** unless
  you mean to start over: it deletes the database, including your acknowledged alerts. Copy
  `db/mazda.duckdb` somewhere safe now and then, and keep your original export files.
- Only new rows are inserted; rows already stored are never updated. If Mazda corrects an old
  value in a later export, the stored value stays. (To rebuild from scratch, run
  `make reset-db` and then `make ingest` with **all** your export files in `data/`.)
- A gap between two exports stays a gap in the charts. The "no new data" alert reminds you
  when it is time to ask for a newer export.

## Commands

| Command | What it does |
|---|---|
| `make setup` | install backend and frontend dependencies |
| `make ingest` | load `data/` into DuckDB, rebuild views, evaluate alerts |
| `make alerts` | evaluate `config/alerts.yaml` only (`--notify` for a macOS notification) |
| `make model` | reload `config/codes/*.yaml` and recreate the SQL views |
| `make unmapped` | list codes in your data that have no description |
| `make dev` | run API and dashboard (`make api` / `make web` for one of them) |
| `make demo` | the same with the synthetic sample data |
| `make sample-data` | regenerate `sample_data/` (deterministic) |
| `make types` | regenerate the frontend's TypeScript types from the API schema |
| `make test` / `make lint` / `make format` | backend + frontend checks |
| `make profile` | per-file data profiling reports in `docs/profile/` |
| `make audit` | check for private values before publishing (see below) |

## How it works

```
data/*.csv, *.txt ──ingest──▶ DuckDB tables ──views + code lookups──▶ FastAPI ──▶ React dashboard
                                   │                 ▲
                                   └──alert rules────┘  (config/alerts.yaml → alerts table)
```

- `backend/src/mazda_dash/ingest`: parsers for each file kind (idempotent; sentinel values such
  as `2147483647` become NULL).
- `backend/src/mazda_dash/model`: lookup tables from `config/codes/` and the SQL views the API
  and alerts read ([view catalogue](docs/data-dictionary.md)).
- `backend/src/mazda_dash/alerts`: one detector per rule; each alert is raised once.
- `backend/src/mazda_dash/api`: read-only JSON API (plus acknowledging alerts).
- `frontend/`: Vite, React, TypeScript, Recharts. Types are generated from the API's OpenAPI
  schema.

[PLAN.md](PLAN.md) has the design decisions and the milestones this was built in.

## Privacy

Vehicle exports contain your VIN, and may contain GPS positions. `data/`, `db/` and `*.duckdb`
are git-ignored. If you fork this project, or publish your own copy, run:

```bash
make audit
```

It reads the private values (VINs, positions) from your `data/` folder and searches every file
git would publish **and the whole git history** for them, and lists the commit author emails
for review. The tests and the sample data use only made-up values.

## Development

```bash
make test   # pytest + vitest
make lint   # ruff, oxlint, tsc
```

CI runs the same checks, plus a check that the generated types and sample data are up to date.
See [CLAUDE.md](CLAUDE.md) for a tour of the code for contributors and coding assistants.

## License

[MIT](LICENSE)
