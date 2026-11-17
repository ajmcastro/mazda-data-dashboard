# Contributing

Thanks for looking. This is a small personal project made public; issues and pull requests are welcome.

## Before anything else: privacy

Mazda's exports contain your **VIN** and sometimes GPS positions. Never put your export files, your
database, a data pack (`*.cx5pack`) or your VIN in an issue, a pull request, a screenshot or a commit.
`data/`, `db/` and `*.cx5pack` are git-ignored; `make audit` checks the files and the whole git history
for the private values found in your `data/` folders (it also checks that `sample_data/` holds only made-up VINs), and CI refuses a data pack. To show a problem,
reproduce it with the synthetic demo data (`make demo`) or describe the shape of the data.

## What helps most

- **What a code or flag means**, with how you know (owner's manual, dealer, a source): see
  `config/models/<id>/codes/*.yaml` (per car model) and the notes in [docs/data-dictionary.md](docs/data-dictionary.md).
  Descriptions must be known or user-supplied; please do not guess.
- **Other models and markets**: whether the export looks the same, and what differs (without personal data).
  `make compat MODEL=<id>` after loading an export lists the signals the dashboard reads that the car does not send;
  that output (no VIN in it) is a good start for an issue.
- Bug reports with the page, what you expected, and the demo data or a description that reproduces it.

## Set up and check

```bash
make setup           # backend (uv) and frontend (npm) dependencies; see the README for the tools
make mobile-install  # the phone app's packages (also done on first use)
make demo            # try it on the synthetic data

make test            # backend (pytest) and frontend (vitest)
make lint            # ruff, oxlint, tsc
make mobile-test     # the phone app: contract tests against the Python API, type check
make audit           # privacy audit of the files and the git history
make types sample-data   # regenerate the committed generated files after changing the API or the sample generator
```

CI runs all of these plus the production builds.

## Rules that keep this project consistent

The code tour is in [CLAUDE.md](CLAUDE.md); the ones that matter most when changing things:

1. **Two implementations of the API.** The Python API (`backend/src/mazda_dash/api/`) is the reference; the
   phone app answers the same routes from a TypeScript copy (`mobile/src/engine/`). Change both in the same
   commit; `make mobile-test` replays the Python API's answers against the TypeScript engine and fails on any
   difference (a value, a missing field, the order of rows). Every new route needs a case in
   `backend/src/mazda_dash/contract.py`.
2. **Deterministic order.** Every `ORDER BY` ends in columns that make the order total; two engines order
   ties differently.
3. **One SQL for both.** Views live in `backend/src/mazda_dash/model/views.sql` and run unchanged in the
   browser. Name single signals as `signal = '<name>'` and families as `starts_with(signal, '<prefix>')` (the
   phone pack builder reads them from the file); do not nest `timezone()` calls (the in-browser DuckDB cannot
   run them).
4. **Generated files are compared byte for byte in CI** (`sample_data/<model>/`, `frontend/openapi.json`,
   `frontend/src/api/schema.d.ts`): after changing the API run `make types`, after changing the sample
   generator run `make sample-data`, and commit the result. Generators must not depend on the machine's time
   zone, locale or line endings.
5. **Never show a guess as a fact.** Co-occurrences are hints; unknown codes stay "no description yet".
6. **No outside requests from either app**: fonts and everything else are bundled (`@fontsource` packages in
   `frontend/` and `mobile/`); do not add a CDN, an analytics script or a web font link.
7. **Pages should work in both themes and on a phone**: use the CSS variables, and check the phone width.
   Something the phone app loads at run time must be in its build output, or it will not work offline.
8. **Everything is per car model.** Every API route reaches a database through `Con` / `RwCon` (so it takes
   `?model=`; `tests/test_api_models.py` fails when a route does not), every path to a model's data, database
   or configuration comes from `mazda_dash/models.py` (never a hard-coded `../data` or `../db/...`), and every
   frontend hook takes the model from `useRangeQuery()` in both the request and the query key. Code
   descriptions are never shared between models.
9. **A new model** needs `config/models/<id>/`, a line in `config/models.yaml`, and, to be demonstrated, a
   profile in `sample.py` (`PROFILES`) and `make sample-data`. The CX-5 profile must keep producing the same
   bytes. Follow the README's "How to add a model"; `tests/test_add_a_model.py` does exactly that.
10. **The phone caches each car's figures.** `/api/trends/monthly` and `/api/garage` are also stored on the phone for
    cars that are not loaded (`SUMMARY_VERSION` in `mobile/src/controller.ts`): when you change either answer (a field
    or the maths), raise `SUMMARY_VERSION`, or a stale figure will be shown.
11. **A new metric on Trends** also needs an entry in `COMPARABILITY` (`frontend/src/compare.ts`: is it fair to set
    across two cars, and why), in `PERIOD_UNAVAILABLE` if it cannot be added up from months, and `money: true` if it
    is an amount. Compare says "higher" and "lower" between two cars, never "better" or "worse", and uses the
    good/bad colours only for the same car over time.
12. **Tests must not depend on your own configuration.** The files in `config/models/<id>/` are the owner's (their
    code descriptions, their fuel prices, their service log): tests that need settings pass their own
    (`ingest(..., settings_path)`), and a test that writes (the import, the service log) builds a temporary root and
    sets `MAZDA_ROOT`. Never import test files into a real `data/` folder.
13. **The 3D car** (`frontend/src/car3d/`, on the Status page). It draws what `frontend/src/car.ts` says about each
    part and nothing else, so the list and the drawing cannot disagree. `three` stays in the chunk that is loaded with
    the view: only `scene.ts` and `Car3D.tsx` import it (a test fails otherwise). It renders on a change, never in a
    loop. Colours come from the CSS variables; red and amber mean "check" and "open", so details such as the tail
    lights are drawn in neutral tones. No model files and no textures: a car's shape is numbers in `car3d/shapes/`.
14. **A new car shape.** Take a flat photo of the car's side from far away (zoom in, so the lens distorts less),
    plus front and rear. Trace the outline as fractions (`p` along the car by the axles, `h` of the height; see
    `shapes/traced.ts`) into a `Traced` spec like `shapes/cx5.ts`, add its name to `SHAPES` in
    `shapes/common.ts` **and** in `backend/src/mazda_dash/models.py` and to `BUILDERS` in `geometry.ts`, and set
    `shape:` in the model's `model.yaml`. The tests that every shape must pass then run on it. **Never commit the
    photos** (or anything read from a number plate), and do not use a manufacturer's model or drawing. The generic
    shape is pinned by a fixture and must not change.
15. **Text is in two languages.** Anything a reader sees goes through `tr('English text', { values })` (or `trn` for a
    count, `msg` for a constant that is shown later with `tr(value)`), from `frontend/src/i18n`, and gets its Portuguese
    (Portugal) in `frontend/src/i18n/pt/<area>.ts`, with the same `{placeholders}`. Menu entries and page titles have a key
    in `i18n/en.ts` and `pt.ts` instead. A test reads the source and fails for a phrase with no Portuguese, and for text
    typed straight into the markup. A new alert rule also needs its sentences in `frontend/src/alerttext.ts`. Not fluent
    in Portuguese? Say so in the pull request and leave your best attempt: it will be reviewed.
16. **Units are converted only where they are shown.** The API, the database, the alert rules and all the maths stay
    in kPa, l/100 km and km; a page or component formats through `frontend/src/units.ts` and never spells out a unit
    itself (a test fails otherwise).
17. **Estimates are worded as estimates, and nothing passes a verdict.** A forecast says "at this rate", a fill-up or
    a drive is "between two status reports", a pattern in freeze frames "tends to appear when", never a cause. Each
    wording module has a test that forbids verdict words, in both languages; a new one should have the same.
18. **What the owner knows is never invented.** The repository ships no `layout.yaml` (where control units sit), no
    code titles that are not known, and no limits the car did not report or the owner did not set.
19. **A new alert rule** needs its model in `alerts/config.py`, a detector and a test, a row in the README's Alerts
    table, the part of the car it is about in `ALERT_PART` (`frontend/src/car.ts`), and its sentences and name in
    `frontend/src/alerttext.ts`; tests read the detectors' list and fail when one of those two is missing.
20. **Learning from the data stays plain statistics, the same on both apps.** Patterns, unusual reports, steps in
    consumption, routines, fault comeback, the voltage trend and the monthly forecast are computed from the car's own
    data, never from a trained model or another car's. Prefer SQL in `views.sql` (the phone rebuilds it); when a loop is
    needed, write it the same in Python and in `mobile/src/engine/` (same order of operations, an integer random
    generator, features rounded where Python and the browser could differ in the last bit), so `make mobile-test`
    finds identical answers. Each result gives what it rests on and stays silent under a minimum. Try a new method on
    real data before wiring it, and say so in PLAN.md when it changes nothing. When the demo should show it, plant it
    through a `Profile` flag of the second demo car, derived from the clock, never from new random numbers.

## Pull requests

Keep them focused, say what changed and why, and run the checks above. The milestone history in
[PLAN.md](PLAN.md) shows how decisions were made and what was tried.

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
