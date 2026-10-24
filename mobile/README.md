# Phone app (`mobile/`)

The CX-5 dashboard as an offline web app for an iPhone: the same pages as the Mac app
(`../frontend/src`, shared through the `@frontend` alias), running on the data stored **on the
phone**. No server, no account, and no request to any host but its own. The Mac app is untouched.

How it works (details and measurements in `../PLAN.md`):

- `make mobile-pack` on the Mac exports your database as `db/mazda.cx5pack` (Parquet tables in a zip,
  GPS positions left out). It contains your VIN: keep it private.
- On the phone the app starts DuckDB (WebAssembly), loads the pack, rebuilds the SQL views from
  `backend/src/mazda_dash/model/views.sql`, and answers the pages' `/api/...` requests with
  `src/engine/`, a TypeScript port of the Python API proven identical by contract tests.
- The pack and the alert acknowledgements made on the phone are kept in the browser's IndexedDB.

## Run it

```bash
make mobile-install        # once
make mobile-dev            # http://localhost:5174, with the synthetic demo data bundled
make mobile-dev HOST=1     # also reachable from a phone on the same Wi-Fi; stop with Ctrl+C afterwards
make mobile-build          # production build into mobile/dist (includes the service worker)
make mobile-test           # contract + app tests
```

Open the app, tap **Load demo data**, or **Import data pack** and choose a `.cx5pack`.
On a phone, AirDrop the pack to Files first. `HOST=1` exposes only the demo data; never serve a
real pack over the network.

## Layout

| Path | What |
|---|---|
| `src/main.tsx`, `src/App.tsx` | start-up and the phone layout (bottom tab bar) around the shared pages |
| `src/controller.ts` | the data on the device: engine start, stored pack, import / replace / delete |
| `src/storage.ts` | IndexedDB: pack and acknowledgements |
| `src/engine-browser.ts` | DuckDB-WASM in a Web Worker (one query at a time) |
| `src/DataScreen.tsx` | import, demo, pack information, delete |
| `src/engine/` | the Python API in TypeScript (`api.ts` routes, one file per area, `pack.ts` loader) |
| `test/` | contract tests (replay the Python API's answers), controller and engine tests |

## The data engine and the contract tests

When you change an endpoint in `backend/src/mazda_dash/api/`, change its twin in `src/engine/` and run

```bash
make mobile-test          # records the Python API's answers on the sample data, then replays them here
make mobile-golden-real   # same on your own database; then: rm -r mobile/contract/real (it holds your VIN)
```

Any difference in the JSON (a value, a missing field, the order of rows) fails with the request and
the path of the first difference.

## Installing and offline use

A production build is an installable web app: on an iPhone open the hosted address in Safari, Share,
**Add to Home Screen**. It saves itself on the phone (about 36 MB, once; the Data screen says
"Works offline: yes" when it is done) and then opens with no connection. When a newer build is
published the app offers an **Update** button. Service workers need `https://` (or `localhost`), so
this works on the hosted site (M16) and on `localhost` in the iOS Simulator, not from
`make mobile-dev HOST=1` over plain http (there the app still runs, but is not installable).

Test it locally: `make mobile-build`, `cd mobile && npm run preview`, open `http://localhost:5174`,
load the demo data, stop the server, reload: everything still works.

iOS may remove a web app's stored data after a few weeks without use or when space runs low. The app
asks Safari to keep it, tells you if it was removed, and the `.cx5pack` file (keep it in Files) is
the real copy: importing it again takes a few seconds.

Icons: `python3 scripts/make_icons.py` redraws them into `public/`.
