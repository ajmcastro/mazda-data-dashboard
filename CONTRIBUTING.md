# Contributing

Thanks for looking. This is a small personal project made public; issues and pull requests are welcome.

## Before anything else: privacy

Mazda's exports contain your **VIN** and sometimes GPS positions. Never put your export files, your
database, a data pack (`*.cx5pack`) or your VIN in an issue, a pull request, a screenshot or a commit.
`data/`, `db/` and `*.cx5pack` are git-ignored; `make audit` checks the files and the whole git history
for the private values found in your `data/` folder, and CI refuses a data pack. To show a problem,
reproduce it with the synthetic demo data (`make demo`) or describe the shape of the data.

## What helps most

- **What a code or flag means**, with how you know (owner's manual, dealer, a source): see
  `config/codes/*.yaml` and the notes in [docs/data-dictionary.md](docs/data-dictionary.md). Descriptions
  must be known or user-supplied; please do not guess.
- **Other models and markets**: whether the export looks the same, and what differs (without personal data).
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
4. **Generated files are compared byte for byte in CI** (`sample_data/`, `frontend/openapi.json`,
   `frontend/src/api/schema.d.ts`): after changing the API run `make types`, after changing the sample
   generator run `make sample-data`, and commit the result. Generators must not depend on the machine's time
   zone, locale or line endings.
5. **Never show a guess as a fact.** Co-occurrences are hints; unknown codes stay "no description yet".
6. **No outside requests from either app**: fonts and everything else are bundled (`@fontsource` packages in
   `frontend/` and `mobile/`); do not add a CDN, an analytics script or a web font link.
7. **Pages should work in both themes and on a phone**: use the CSS variables, and check the phone width.

## Pull requests

Keep them focused, say what changed and why, and run the checks above. The milestone history in
[PLAN.md](PLAN.md) shows how decisions were made and what was tried.

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
