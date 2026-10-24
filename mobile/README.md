# mobile/ — offline phone app (work in progress)

Plan and decisions: [../PLAN.md](../PLAN.md), section "Standalone offline app for iPhone" (M12–M16).
Status: **M12, the feasibility spike.** `src/spike.ts` is throwaway code that measures whether the
data can be loaded and queried in the browser; the real app comes in M13–M15.

## Run the spike

```bash
make mobile-install          # once: npm install in this folder
make mobile-spike-prod       # builds the demo pack and the page, serves it at http://localhost:5174
```

Open <http://localhost:5174/?autorun=1&label=my-browser>. The page loads the demo data pack into
DuckDB (WebAssembly), rebuilds every SQL view from `backend/src/mazda_dash/model/views.sql`,
compares each view with the Python database, times typical queries, and sends its measurements to
the dev server, which writes them to `spike-results/<label>-<time>.json` (gitignored).

Without `?autorun=1` use the buttons: **Run with demo pack**, or choose your own `.cx5pack` file
(made by `make mobile-pack`, it contains your VIN; the results never include its content).

### On an iPhone (same Wi-Fi)

```bash
make mobile-spike-prod HOST=1
```

On the phone open the *Network* address printed (for example `http://192.168.1.20:5174/`) with
`?autorun=1&label=iphone` added, wait for the green line, and tell the result (or look in
`spike-results/`). Stop the server with Ctrl+C afterwards: `HOST=1` makes it reachable by every
device on your Wi-Fi (it serves only the synthetic demo pack and accepts small result files).

To try your own data on the phone, AirDrop `db/mazda.cx5pack` to it, open it from Files and use
the file chooser on the page.

### In the iOS Simulator (Xcode)

With `make mobile-spike-prod` running and an iPhone simulator booted:

```bash
xcrun simctl openurl booted "http://localhost:5174/?autorun=1&label=ios-sim"
```

The Simulator reaches your Mac's `localhost`. It runs real iOS Safari, but on the Mac's processor
and without the iPhone's memory limits, so treat its timings as optimistic.

## Round 2 on a real iPhone (speed)

Round 1 showed the phone is 10–40× slower than a Mac (see PLAN.md). Round 2 separates *downloading*
the engine from *compiling* it, benchmarks the phone's processor, and compares four packs of your own
data (all signals / trimmed, three compressions).

```bash
make mobile-variants          # writes 4 packs of YOUR data to db/variants/ (they contain your VIN)
make mobile-spike-prod HOST=1
```

1. iPhone, Safari: open `http://<mac-address>:5174/?autorun=1&label=iphone-r2-demo`. It runs the
   demo data again with the new measurements.
2. AirDrop the four files in `db/variants/` to the iPhone (select all four in Finder, Share, AirDrop).
3. Same page without `?autorun`: `http://<mac-address>:5174/?label=iphone-r2-variants`, tap **Choose
   File** under *Compare packs*, **Browse**, select **all four** files, **Open**. It loads each pack
   twice (second round in reverse order) and shows the load times in a table.
4. Press Ctrl+C on the Mac when done (`HOST=1` exposes the demo data to your Wi-Fi). Delete the
   AirDropped packs from the phone's Files app afterwards if you do not want to keep them there.

## The data engine (M13)

`src/engine/` is the Python API in TypeScript, so the existing pages can run on the phone with no
server. `createFetch(api)` answers `/api/...` from DuckDB-WASM, and `loadPack()` fills it from a
`.cx5pack`. It is not wired into a page yet (that is M14).

```bash
make mobile-test          # records the Python API's answers on the sample data, then replays them here
make mobile-golden-real   # same on your own database; then: rm -r mobile/contract/real (it holds your VIN)
```

When you change an endpoint in `backend/src/mazda_dash/api/`, change its twin in `src/engine/` and run
`make mobile-test`: any difference in the JSON (a value, a missing field, the order of rows) fails with the
request and the path of the first difference.
