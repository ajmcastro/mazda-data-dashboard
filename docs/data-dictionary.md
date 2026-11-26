# Data dictionary

What the Mazda export files contain, how they relate to each other, and how they are stored and exposed by this project (tables, views, code lookups). It was written while exploring the data and is kept in step with the code. Regenerate the detailed per-file profiles (gitignored) with `make profile` → `docs/profile/*.md`. Counts below are for the author's export covering 2026-06-12 → 2026-10-22; one VIN only.

## Conventions

- CSVs are comma-separated, all fields quoted, header row; **empty string = missing**. Read as text first, then cast.
- Timestamps come in two shapes:
  - `COPIED_DT_TM`, `fileid_datetime`: `YYYY-MM-DD HH:MM:SS`, no zone (assumed UTC; to be confirmed).
  - `*_TM`, `datacreationtime`: ISO-8601 UTC with `Z`.
- Single VIN everywhere; the database keeps a `vin` column anyway.
- Most signals in `rts`, `vis` and `alt` come as a `<signal>_value` + `<signal>_validstatus` pair (`rts` also has plain columns, see below). `validstatus` is `Valid`/`Invalid`; **an `Invalid` value must not be trusted** (it appears in `vis`, e.g. `drstatdrv`, `locklinkswdrv`, `dropnwrn`).
- Placeholder values meaning "unknown" are stored as NULL: `2147483647` (INT32_MAX), `4294967295` (UINT32_MAX) and an odometer of `-1`.

## How the files relate

```
war ──(WARNING_TRIGGER_OCCURRENCE_TM)── dtc-h ──(X_TRANSACTION_ID)── dtc-d
                    └──────────────── dtc-ssr
rts / vis / alt : independent snapshots, correlate only by time
```

Verified:
- `dtc-d` ↔ `dtc-h`: same 47 `X_TRANSACTION_ID`s (1 header row per transaction, many DTC rows per transaction — 1166 rows over 47 transactions, i.e. one row per ECU per read-out).
- `war` and `dtc-ssr` have **different** transaction ids from the other files (no overlap). They link through `WARNING_TRIGGER_OCCURRENCE_TM`: all 30 distinct trigger times in `dtc-ssr` and 44 of 45 non-null ones in `dtc-h` exist in `war`.
- `COPIED_DT_TM` is the batch upload time, not the event time; use the `*_TM` trigger time for event time.

## Files

### `war` — warnings (7,039 rows)
One row per warning event (all `X_TRANSACTION_ID` and trigger times unique; no duplicates).
- `WARNING_TRIGGER_OCCURRENCE_TM` event time; `ODO_INFORMATION_KM` odometer; `WARNING_LIST` comma-separated `$XXX` hex codes (1–6 per row, 21 distinct codes).
- Code frequency: `$210` 6,922 (≈ always present — likely a status/informational code, not a fault), `$2FE` 2,410, `$226` 840, `$290` 462, `$182` 232, `$2CD` 121, `$21D` 57, `$1B4` 37, `$000` 32, then rare ones (`$187 $184 $2DA $25E $08D $246 $260 $049 $072 $086 $0B5 $20F`).
- `HOURS`/`MINUTES` look like a time-since offset; **sentinel `2147483647` (INT32_MAX) = unknown** (13 rows). `ODO_INFORMATION_KM = -1` = unknown (7 rows). Odometer in the data goes up to 6,243 km.
- Volume: 936 / 1,234 / 2,268 / 1,445 / 1,156 rows for Jun–Oct, so event volume is high; alerts must be rate-based, not per-row.
- Meaning of `$` codes: unknown, to be mapped by the user (`config/models/<id>/codes/`).

### `dtc-d` — DTC detail (1,166 rows, 47 transactions)
- One row per ECU per read-out (26 distinct `ECU_NAME_MKT`, e.g. BCM, DCM, DSC, EPS, ADU, ECM, IC…), whether or not it has a fault.
- `DISPLAY_DTC` is **NULL in 906 rows** (ECU healthy / no DTC). Real codes: 18 distinct, e.g. `U0198:00`×25, `U3000:00`×17, `U2701:89`×9, `U2122/3/4:00`×7, `U2524:86`×7, `C1A0E/F, C1A10, C1AE1–4:87`, `C1681:13`, `C1C83:00`.
- `19 02 8F`×153 and `7F 19 10`×1 in `DISPLAY_DTC` are **not DTCs**: raw UDS requests/negative responses (`19 02 8F` = ReadDTCInformation request, `7F 19 10` = negative response) — rows with `STATUS_CODE=4/2` and NULL `DISPLAY_STATUS`; treat as read failures, not faults. Mazda's 24PF catalogue documents `STATUS_CODE`: 0 unset, 1 positive response, 2 negative response, 3 response too long, 4 no response, 5 command error, 6 unit specification error (M72; not shown on the pages, which count read errors per read-out).
- `STATUS_CODE`: 1 (ok, 1012), 4 (153), 2 (1). `DISPLAY_STATUS` (hex: `28`, `08`, `0A`) is the UDS status byte; `v_dtc_events` decodes its bits (`confirmed`, `pending`, `test_failed`, `warning_indicator`). `DTC_STATUS_FLAG` (0–7) is kept as is; its meaning is still unconfirmed.
- DTC format is `<code>:<failure type byte>`; the diag-tool file lists the same codes with `-<status>` suffix (e.g. `C1681:13-28`).

### `dtc-h` — DTC header (47 rows)
One row per transaction: `COPIED_DT_TM`, `WARNING_TRIGGER_OCCURRENCE_TM` (2 null), `ODO_INFORMATION_KM` (1,275–6,205), `DIAGNOSTICS_ACQUISITION_TM` (only 2 non-null). `HOURS=1`, `MINUTES=0` constant → ignore.

### `dtc-ssr` — DTC freeze-frame snapshots (137 rows, 83 transactions, 487 columns)
- **404 of 487 columns are always empty** (tire pressure/temp, wipers, etc.) and 53 more are constant → only ~30 columns carry information. They are stored as a narrow key/value (long) table (`dtc_snapshot_values`), with empty columns dropped, rather than as 487 wide columns.
- Identification: `DISPLAY_DTC`, `ECU_NAME_MKT`, `DTC_SNAPSHOT_RECORD_NUMBER`, `WARNING_TRIGGER_OCCURRENCE_TM`, odometer; snapshot time is split over `Time_UTC_Information_{Year,Month,Date,Hour,Minute,…}`.
- Varying signals include battery/voltage-like and temperature-like values (unit semantics unknown), vehicle-speed and ignition flags.

### `rts` — remote vehicle status (214 rows)
`requesttype=RemoteConfirm`, `isinservicemode=false` (constant). Mostly constant signals (163 of 237 columns); useful varying ones:
`ododispvalue` (odometer, km, 59.1→6,243.0), `drv1avlfuele/g` (available fuel/range), `drv1drvtm`, `drv1distnc` (trip), `enginestate`, `powercontrolstatus`, `fuelsegementdactl` (fuel gauge segments), tire-pressure display values (`fltprsdispkp`, `frtprsdispkp`, `rltprsdispkp`, `rrtprsdispkp` in kPa, with `tprsdispyear/month/date/hour/minute` = when the car measured them, in **its local time**, see `v_tire_readings`), `remoildistk/m` (distance left until the next oil change in km / miles, steps of 1,000 km; `65535` = unknown, see `v_oil_readings`), seatbelt and occupant-sensor flags.
- **Plain columns without a validity flag** (easy to miss: most columns are `_value` pairs): 6 `*_seatbelt_used` flags, 128 `vdt_2_warningpt_*` / `vdt_7_warningbody_*` warning bit flags (almost always 0; `vdt_7_warningbody_1_30` is 1 in 94 rows), and `latitude` / `longitude` — **location, populated in only 1 of 214 rows**. Treat as personal data (never commit; see the privacy rules in `PLAN.md`).
- Used as *the car's own warning flags* (all 0 in this export): `fltyrepresswarn`, `frtyrepresswarn`, `rltyrepresswarn`, `rrtyrepresswarn`, `tpmsstatus`, `tpmssystemflt`, `oillevelwarning`, `seatbeltwrndrq` (see `v_car_warning_readings`). Constant and unused: `remainingmileage`, the maintenance-reminder settings (`mntsetdist`, `remregdist`: `65535` / `255` = not set up), etc.
- Note 74 `Invalid`-status occurrences are counted across these columns; filter on `_validstatus`.

### `vis` — vehicle info status (197 rows)
`requesttype=ForgetInform` (constant). Door/lock/hazard/light snapshot. Only 5 signals vary: `drstatdrv`, `locklinkswdrv`, `locklinkswpsngr`, `hazardsw`, `lghtswstate`. Door statuses for passenger/rear/trunk/hood/fuel lid are constant. Several values are flagged `Invalid` sometimes.

### `alt` — alarm status (4 rows)
`burglarstatus_value` (1 ×3, **5 ×1**) and `balarmreasondactl_value` (0 ×3, **5 ×1**), dates 2026-08-16, 2026-10-04, 2026-10-18 ×2. The row with value 5 / reason 5 is a security alarm event worth an alert (meaning of the codes to be confirmed).

### Diagnostic tool dump (`*.txt`, 481 lines)
Came inside the zip download from the Mazda Vehicle Data portal, together with the CSV files. In the author's export it was made on 2026-10-15 09:56:59 (UTC+0100), ODO 5,781 km. Not CSV; line-oriented with sections:
- Header (date/time/timezone/ODO), then `Mode 9` for ECM: `VIN`, `CALID`, `CVN`, `IPT` counters (`(KEY) = value`).
- `VOD - …` and `* OCC Vehicle Data` sections of `(KEY) = value [unit]`: run/idle time (s), distance (km) and fuel used (l) for the "recent" (`_R`) and "lifetime" (`_L`) periods (e.g. lifetime 5,781.6 km / 423.38 l ⇒ ≈ 7.3 l/100 km), AAF/DSM/DCT/OCCT counters. Value `4294967295` (UINT32_MAX) = not available.
- `AES ID and Status`: repeated `(AESIDx) = <hex>` / `(AESIDx_Activity_State) = Not Active` pairs.
- `dtcs` and `Rob_dtcs` sections: per `ModuleName:<ECU>` lists of `CODE:FT-STATUS` (ADU, DCM, …; DCM codes are manufacturer-specific, prefix `X`). They are kept as two separate lists.
- `SnapshotData`: per DTC (`DTC:CODE:FT-STATUS`, `RecordNumber:NN`) the freeze-frame signals as `KEY:value unit`.
- `Mode 6`: OBD monitor results, `OBDMID: <hex>, Test: <hex>, Min, Max, Value` lines with optional units; a value outside its limits is a failed test.
- Parsing approach: a small state machine keyed on the block headings and the `(KEY) = value unit` regex. Each dump becomes one *report* identified by a hash of its content, so several dumps (even from the same day) are separate reports and an identical copy is skipped.

## Design decisions that followed from these findings

1. **Ingestion**: `war` is exploded to one row per code; sentinels become NULL; `dtc-d` pseudo-codes (`19 02 8F`, `7F 19 10`) are classed as `read_error` rows, not faults; `dtc-ssr` is stored in long format; `Invalid` readings are kept and flagged (`valid = false`) rather than dropped.
2. **Dedup keys** (see the table below): `war`/`dtc-h`/`dtc-d`/`dtc-ssr` by `X_TRANSACTION_ID` (+ DTC / record number for detail rows); `rts`/`vis`/`alt` by `(source, vin, created_at, signal)`; diagnostic reports by content hash.
3. **Alerts** are rate/new-code based: `$210` fires in ~98% of rows, and 906/1,166 `dtc-d` rows are "no fault".

## Open questions

- Timezone of `COPIED_DT_TM` / `fileid_datetime` (assumed UTC; the diagnostic dump states its own offset, which is applied).
- Meaning of `$` warning codes, `DTC_STATUS_FLAG` values, burglar/alarm reason codes, `HOURS`/`MINUTES` in `war`.
- Units of the `dtc-ssr` signals: the CSV has none. The frontend adds units for the signals the tool dump confirms (see the end of this file); the rest are shown raw.

## Model differences

The pipeline treats every Mazda model the same way: the same seven CSV kinds plus the diagnostic-tool dump, the
same columns, sentinels, join keys and `_value` / `_validstatus` pairs (everything above). What can differ per
model, and where this project keeps it, so that **nothing from one model leaks into another**:

| What differs | Where it lives | What happens when it differs |
|---|---|---|
| Platform code in the file names (`24pf` in the author's CX-5) | nowhere: files are found by their `_<kind>-` part | nothing; any code works |
| Which remote-status signals the car sends (`rts`, `vis`) | the data; `views.sql` names the ones it reads | a missing signal is an empty reading, never an error; `make compat` lists them and the views they feed |
| Meaning of warning codes (`$XXX`), fault codes, ECU names, lamp flags | `config/models/<id>/codes/*.yaml` | never shared or borrowed: an undescribed code stays "no description yet" |
| The car's local time zone (tire measurement clock), stale limit | `config/models/<id>/settings.yaml` | per model; `make timezone MODEL=<id>` checks it |
| Alert rules and thresholds | `config/models/<id>/alerts.yaml` | per model; built-in defaults when absent |
| Pages with no data for the model | `pages:` in `config/models/<id>/model.yaml` | the page leaves the navigation |
| The car's outer dimensions, steering side and outline (3D drawing on Status) | `body:` in `config/models/<id>/model.yaml` (`length_mm`, `width_mm`, `height_mm`, `wheelbase_mm`, `track_mm`, `wheel_diameter_mm`, `steering`, `shape`) | optional; millimetres; `shape` names an outline the code can draw (`generic`, `cx5`, `cx60`); served by `GET /api/models` and carried in the data pack's manifest. No new data is read for the drawing: it shows the status figures the other panels already use |
| How many diagnostic reports, and when | the exports you download | each dump is a report of its own (content hash) |
| The vehicle | one VIN per model folder | `make ingest` warns when a database holds two |

**What is verified and what is not.** Only one real export has been analysed: a CX-5 (platform 24PF, Europe,
2026), described in the rest of this file. The second model in the repository, a CX-60, exists in
`sample_data/cx60/` as **synthetic** data made to differ on purpose (another platform code, VIN, period and car
time zone, a diagnostic tool clock at UTC+0200, other codes and faults, two reports instead of three, no oil
countdown, two signals the CX-5 lacks); nothing in it says how a real CX-60 export looks. Signals a hybrid or
electric model would add (battery state, charging, electric range) are not read by any view yet: they appear
as "read by no view" in `make compat` until someone with such an export adds them (PLAN.md, M28).

## Database schema

Created by `make ingest` in `db/<id>.duckdb` (gitignored). All timestamps are naive UTC; sentinels are NULL; re-running is idempotent (rows are keyed as below and skipped if present, never updated).

| Table | Key | Source |
|---|---|---|
| `warning_events` | `transaction_id` | `war` |
| `warning_codes` | `transaction_id, code` | exploded `WARNING_LIST` |
| `dtc_headers` | `transaction_id` | `dtc-h` |
| `dtc_readings` | `transaction_id, ecu, raw_dtc` | `dtc-d`; `kind` = `none` / `fault` / `read_error` |
| `dtc_snapshots` | `transaction_id, ecu, raw_dtc, record_number` | `dtc-ssr` metadata, `snapshot_at` built from `Time_UTC_Information_*` |
| `dtc_snapshot_values` | snapshot key + `signal` | `dtc-ssr` unpivoted, non-empty values only (64 signals) |
| `signal_readings` | `source, vin, created_at, signal` | `rts` / `vis` / `alt` in long format; `valid` NULL when the signal has no validity flag |
| `diag_reports` | `report_id` (hash of the file's content) | diag-tool `.txt` header |
| `diag_values`, `diag_dtcs`, `diag_snapshots`, `diag_obd_tests` | per `report_id` | Mode 9 counters, DTC lists (`dtcs`, `rob_dtcs`), snapshot data, Mode 6 tests |
| `ingest_runs` | – | audit log of rows read / new per file |
| `alerts` | `dedup_key` | raised by the alert rules (`config/models/<id>/alerts.yaml`); `status` new / acknowledged. Lives in the same file, so `make reset-db` loses acknowledgements |
| `ref_warning_codes`, `ref_dtc_codes`, `ref_ecus`, `ref_failure_types`, `ref_warning_flags` | code | rebuilt from `config/models/<id>/codes/*.yaml` by `make model` |
| `ref_settings` | setting | rebuilt from `config/models/<id>/settings.yaml` by `make model` (`car_timezone`, `tire_stale_hours`, `warning_episode_minutes`, and `fuel_currency` when a fuel price is set) |
| `ref_fuel_paid` | — | what the owner noted paying for fuel (`paid_on`, `paid`, `litres`), from `config/models/<id>/fuel_log.yaml`, in the currency of the settings; empty without the file. Matched to `v_refuels` by date inside `GET /api/fuel/refuels`; never added to an estimate |
| `ref_signal_values` | `signal, value` | what the values of some signals mean, as Mazda documents them for the model's platform (M72): `label` (English) and `state` (`ok`, `info`, `attention`, `unknown`), from `config/platforms/<platform>/signal_values.yaml`, only for a model whose `model.yaml` names that platform (or, for a model with none, whose settings file does: the CX-60 sample); empty otherwise. `ref_settings` then also holds `platform` and `signal_values_source`. Source of the 24PF file: Mazda's data catalogue for the platform (`rtspf24`, the vehicle status alert file, `altpf24`), version 20260408, sent to the owner as PDFs (kept out of the repository) |
| `ref_service_log` | `n` | what the owner noted was done to the car (`served_on`, `kind`, `note`, `odometer_km`; `n` = the position in the file), from `config/models/<id>/service_log.yaml`; empty without the file. `GET /api/service-log` lists it and, next to it, suggestions the data hints at (the oil countdown going up in `v_oil_readings`, a day with a `diag_reports` row) that have nothing in the log within 7 days; a suggestion is never stored |
| `ref_fuel_prices` | `valid_from` | the fuel price per litre from a date on (`fuel_prices` / `fuel_price_per_l` of the same file); empty when no price is set. The view `v_fuel_prices` gives each price its span (`valid_to` = the next price's date; the earliest price also applies before its own date). The cost figures are the litres of each trip (`v_trip_segments.fuel_l`) times the price in force on its day, so they are **estimates**, not what was paid |

Row counts on the current export: 7,039 warnings (11,177 codes), 47 DTC headers, 1,166 DTC readings (106 faults, 906 none, 154 read errors), 137 snapshots (2,745 values), 42,108 signal readings, 1 diagnostic report.

## Views and code lookups

`make model` (also run by `make ingest`) loads the model's `config/models/<id>/codes/*.yaml` into `ref_*` tables and recreates these views. Codes without a description fall back to `Unknown warning $XXX` / `Unknown DTC XXXXX` with `known = false`; `make unmapped` lists them (`v_unmapped_codes`).

| View | What it gives |
|---|---|
| `v_warnings`, `v_warning_frequency` | one row per warning code occurrence; per-code counts, share of events, days seen, first/last seen |
| `v_warning_episodes` | one row per warning **episode** (M63): a run of warning moments with no silence longer than `warning_episode_minutes` (default 10) between two of them; `episode` (numbered from the oldest), `start_at`, `end_at`, `moments`, `events`, `codes` (sorted list), `set_key` (its codes without the common ones), `pattern` (1 = the pattern with the most episodes over all the data) and `mode_key`. Built on two helper views: `v_warning_episode_sets` (the episodes and their sets; a code in 90% or more of all episodes, from 10 episodes on, is *common* and left out of the set) and `v_warning_set_modes` (each distinct set points to the most frequent set that is alike, Jaccard 0.6 or more, itself included, and follows those pointers to its *mode*; one pattern per mode; a recursive CTE, deterministic) |
| `v_unusual_reasons` | one row per reason a report is unlike the car's other reports (M64; all of the data is the baseline; nothing for a kind with fewer than 30 reports): `created_at`, `kind` (`status` = `v_vehicle_status`, `doors` = `v_door_status`), `feature`, `value`, `label`, `share_pct`, `z`, `usual_low` / `usual_high` (10th and 90th percentile). `fuel_drop_parked` (points the level fell between two status reports with the odometer moving under 1 km; a rise counts as 0, a rise of 5 or more is a fill-up and left out; from 10 pairs) and `tire_spread` (highest minus lowest pressure) by a robust z-score of 3.5 or more, scale 1.4826 × the median absolute deviation but at least 1 point / 5 kPa; `hour` (the car's local hour, per kind) and `open` (the set of open doors, trunk, hood, hazard lights) when under 1% of that kind's reports share it |
| `v_warning_pattern_codes` | each pattern's codes over all its episodes: `episodes_with`, `episodes`, `pct` and `role` = `core` (80% or more of the pattern's episodes), `sometimes`, or `common` |
| `v_dtc_events` | real faults only (not `none` / `read_error`), with ECU and failure-type titles, system (Powertrain/Chassis/Body/Network), scope, and the UDS status byte decoded (`confirmed`, `pending`, `test_failed`, `warning_indicator`) |
| `v_dtc_frequency` | per ECU + DTC: read-outs, first/last seen and odometer, `active_in_latest_readout` |
| `v_dtc_readout_summary` | per read-out: faults, read errors, ECUs reported |
| `v_dtc_snapshot_signals` | freeze-frame signals joined to their DTC |
| `v_tire_snapshots`, `v_tire_readings` | when the car **measured** the tire pressures of each status snapshot. The car sends the time as five numbers (`tprsdispyear`, `…month`, `…date`, `…hour`, `…minute`) in its own **local time**; `ref_settings.car_timezone` (from `config/models/<id>/settings.yaml`) turns it into UTC with ICU's rules, so daylight saving is handled (a local time that does not exist or happens twice resolves like DuckDB's ICU does). Missing, Invalid or impossible parts (255, year 0, 31 February) give no time. `age_minutes` = how much older the measurement was than the snapshot; `stale` = older than `tire_stale_hours`. `v_tire_readings` folds consecutive snapshots that repeat one measurement into one reading (first and last age, number of snapshots) and uses the snapshot time when the car sent no valid time (`time_known = false`). In the author's data the ages are 1 minute to 26 hours (median 12 minutes) |
| `v_vehicle_status` | wide remote-status timeline: odometer, fuel level, range, trip counters, engine state, tire pressures (kPa); `Invalid` signals are NULL. Latitude/longitude are deliberately left out |
| `v_door_status`, `v_alarm_events` | door/lock/light snapshots; burglar alarm status and reason |
| `v_oil_readings` | the car's own oil-change countdown (`remoildistk`, km left): valid readings only (`65535` = unknown and `Invalid` are dropped), with the previous value, the service interval (a reading higher than the one before = the oil was changed) and the odometer at the time. The car counts in coarse steps (1,000 km or more); it is the car's value, not a calculation |
| `v_car_warning_readings`, `v_car_warning_episodes` | the car's own warning flags (tire pressure per wheel, tire pressure system status and fault, oil level, seat belt reminder, door open; the first eight in `rts`, the door flag in `vis`): every valid reading with `is_on` (non-zero) and its raw value, and the runs of consecutive readings with a flag on (`ongoing` = includes the latest reading). In the author's export all nine are 0 in every valid reading. For a platform that documents the values (M72, `ref_signal_values`) a reading is on when its documented state is `attention`, so a value documented as not available or reserved is not a warning; without documented values any non-zero counts as a warning. To follow another flag, add it to the `CASE` in `views.sql` |
| `v_warning_flag_readings`, `v_warning_flag_episodes`, `v_warning_flags` | the car's **128 warning-lamp bit flags** (`vdt_2_warningpt_<word>_<bit>` for the power train and `vdt_7_warningbody_<word>_<bit>` for the body: plain columns, no validity flag, 0/1). They look like the state of dashboard warning lamps; Mazda does not publish them and almost all never change, so **only flags that take more than one value are visible** (4 of 128 in the author's export). Per flag: readings, readings on, share, first and last on, whether it is on now, the runs in which it was on, and whether it was first set on a day a diagnostic report was taken (in the author's data the two power-train flags were first set on 15 Oct, the day of the report). Your own meanings come from `config/models/<id>/codes/warning_flags.yaml` (`ref_warning_flags`); flags without one appear in `v_unmapped_codes` as kind `warning flag`. Hints (`/api/status/warning-flags/hints`) rank the `$` warning codes and faults that appear within a few hours of the readings with a flag on more often than of those with it off, as a starting point for finding out what a flag is, not a finding |
| `v_odometer_readings`, `v_odometer_daily` | odometer from every source; daily max and km since the previous day with data |
| `v_trip_log`, `v_trip_segments`, `v_fuel_monthly` | trip-1 counters, consumption between consecutive snapshots, monthly km / litres / l per 100 km |
| `v_occupancy` | the seat belts of each status snapshot: the driver's and front passenger's (`firstrowbuckle*`, value/validity pairs) and the rear left and right (`rear_*_seatbelt_used`, plain columns), 1 = buckled, NULL = unknown or not sent. `GET /api/status/occupancy` counts, among snapshots with the **driver's** belt buckled, those with the passenger's or a rear belt buckled too. Seat belts only (a passenger who does not buckle up is not seen); the third-row belts (read 1 on almost every snapshot of a car with no third row) are not read. Since M72 it also has the four seat sensors (occupant classification: `ocsstatus` = the front passenger's seat, `rlocsstatdactl`, `rcocsstatdactl`, `rrocsstatdactl`; 0 unknown, 1 empty, 2 occupied, 3 malfunction), and `v_seat_sensors` gives each sensor reading of a snapshot with the driver belted together with its documented label and state (no rows without documented values). A sensor weighs the seat: a bag reads occupied too |
| `v_frame_signals` | one value per signal of each **distinct** freeze frame (ECU, DTC, record, snapshot time): the same frame is reported again in later read-outs with identical values, so it is taken once. `GET /api/dtcs/frame-summary` compares one fault's frames with all other faults' frames (battery voltage, battery charge, coolant temperature, speed) as a **hint**; faults recorded at the same moment share a frame and count separately. The alert `low_battery_frame` reads it for supply voltages below `min_voltage` (default 12.0 V) |
| `v_activity_events` | the moments the car is in use, each with the car's **local** time (`local_at`, from `car_timezone`; ICU rules handle summer time): a `warning` (with its `code`) and the end of a `drive`, a stretch of trip counter growth between two status snapshots at most 3 hours apart (with its `km`). `GET /api/activity/pattern` groups them by local hour and weekday, **per day, never per event** (the warnings table is mostly repeats), and counts each weekday's days between the first and last activity in the period, so a weekday with more days does not look busier. Shows when the car is used, not how it is driven |
| `v_refuels` | fill-ups: every rise of 5 points or more of the fuel level between two consecutive status snapshots (`before_at`, `after_at`, their local days, `level_before`, `level_after`, `points`, `gap_hours`, `odometer_km`). `litres` = points × `tank_litres` ÷ 100 (NULL without the setting; a lower bound, fuel burned between the two reports is not seen), `est_cost` = litres × the price in force on the later day (NULL without a price), and since the previous fill-up `km_since_previous`, `used_since_previous_l` (the fall of the gauge) and `l_per_100km_since_previous` (from 50 km on). `doubtful` = under `refuel_min_points` (default 15), or seen across 48 hours or more without a report |
| `v_fuel_prices` | the fuel price in force from a date to the next one, from `ref_fuel_prices` (the earliest price also applies before its own date); empty without a price. Joined to `v_trip_segments` by the day of each trip to turn litres into an **estimated** cost (never what was paid) |
| `v_diag_values`, `v_diag_summary` | diagnostic-tool counters; lifetime and recent distance, fuel and l/100 km |
| `v_diag_obd` | Mode 6 monitor results with `in_range` (value within its min/max) and `position` (0 = at min, 1 = at max) |
| `v_diag_aes` | AES id / activity-state pairs from the tool dump (28 ids, all "Not Active" in the current report) |
| `v_freeze_frames` | one row per distinct freeze frame (ECU, DTC, record number, capture time) with how many read-outs repeated it. A DTC can have several records (e.g. ADU `C1A0F` has records 20-25); the car re-reports the same frames in later read-outs |
| `v_unmapped_codes` | warning codes, DTCs and ECUs seen in the data that have no description yet (`make unmapped`) |

Signal interpretations used by the views (inferred from the values; since M72 Mazda's 24PF catalogue confirms the fuel economy pair: `drv1avlfuele` is km/l and `drv1avlfuelg` l/100 km of the current drive, and documents the value lists in `config/platforms/24PF/signal_values.yaml`): `drv1avlfuele` = km/l, `drv1avlfuelg` = l/100 km (`102.2` = no data), `drv1distnc` = trip km, `drv1drvtm` = trip seconds, `fuelsegementdactl` = fuel level 0-100, `smaphremdrvdistnum` = remaining range km. Cross-checks: 100 / km-per-l equals l/100 km; trip km tracks the odometer delta; fuel economy comes out at 6.7-7.2 l/100 km per month, and the diagnostic tool reports 7.32 l/100 km lifetime.

Caveats: trip segments cover about 70% of the odometer distance (km driven before a counter reset that no snapshot saw are lost); a single segment's l/100 km is noisy, so use `v_fuel_monthly` or segments of 5+ km. DTC failure-type titles only list entries known with confidence; ECU titles marked "(inferred)" are guesses.

Freeze-frame signal units (km/h, rpm, V, ...) are not in the CSV; the frontend adds them from a small table in `frontend/src/lib.ts`, taken from the tool dump's printout of the same frames.

## Where the API goes beyond the views

The API is a thin layer over these views, with a few exceptions. Endpoints that take a period (`from` / `to`) re-aggregate inside the endpoint so the range applies *before* grouping: `fuel/monthly`, `warnings/frequency` and `dtcs/frequency` mirror `v_fuel_monthly`, `v_warning_frequency` and `v_dtc_frequency` (the last one always keeps faults still active in the latest read-out). The Trends page's monthly figures (`/api/trends/monthly`) are computed in `backend/src/mazda_dash/api/trends.py`: distance from the odometer, consumption from trip segments, counts from the event tables, and `days_covered` / `partial` per month. The **hints** of `/api/status/warning-flags/hints` are also computed in the endpoint: for one flag, which warning codes and faults appear within a window of the readings with the flag on, compared with the readings with it off (the SQL is in `api/app.py` and, identically, `mobile/src/engine/warningflags.ts`). The **estimated fuel cost** is also built in the endpoints: `cost_per_100km` and `fuel_cost_est` in the monthly figures and the period cost on the Overview join each trip to the price in force on its day (`v_fuel_prices`), in `api/trends.py` / `api/app.py` and identically in `mobile/src/engine/`. `GET /api/status/occupancy` (the "Who rides" panel) is also grouped in the endpoint over `v_occupancy` (`api/app.py` and, identically, `mobile/src/engine/occupancy.ts`). `GET /api/activity/pattern` (the Status page's "When the car is used") runs its grouping in the endpoint over `v_activity_events` (the SQL is in `api/app.py` and, identically, `mobile/src/engine/activity.ts`). `GET /api/garage` (the "All cars" card) adds nothing new: it calls the overview for the 30 days up to the newest day with data, the oil countdown and the car's own warnings. `GET /api/models` is not about one model's data at all (it lists the models and whether each has a database).

## What the data covers (Data health page)

`GET /api/data/health` describes the exports in a period; it adds no table or view. Per kind of file it gives the first and last record, the number of records and the days that have one: `war` (`warning_events.triggered_at`), `dtc-h` (`dtc_headers.triggered_at`), `dtc-d` (`v_dtc_events.event_at`), `dtc-ssr` (`dtc_snapshots.triggered_at`), `rts` / `vis` / `alt` (the distinct `created_at` of `signal_readings` per source: one record per report), `diag` (`diag_reports.taken_at`). A *silence* is the time between two consecutive status reports (`v_vehicle_status.created_at`) when it is 48 hours or more. A reading is *Invalid* when its `_validstatus` column said so (`valid IS FALSE`); of the `rts` source only the signals a view reads by name are counted, the `vis` and `alt` sources whole, and the GPS signals never.

`GET /api/fuel/refuels` lists the fill-ups of a period (by the later of the two snapshots) from `v_refuels` and matches the payments of `ref_fuel_paid` in the endpoint (`api/refuels.py` and, identically, `mobile/src/engine/refuels.ts`). Since M70 every fill-up up to 3 days from a payment's date is a candidate (`days_off` = 0 when the date lies between the two snapshots' local days; the litres agree when the gauge saw 0.6 to 1.15 times the litres paid); the payment goes to its cheapest candidate (ten per day off, five for litres that disagree; ties: the earliest), a fill-up adds up the payments it got and carries the lowest `confidence` among them (`high`, `medium`, `low`), `days_off` and `litres_differ`, and a payment with no candidate is returned as `unmatched`. The totals keep the estimate (`est_cost`) and the amount paid (`paid`, with `paid_fill_ups` = how many fill-ups it covers) apart.

`GET /api/trips/pattern` (the Trends page's "How the car is driven") groups `v_trip_segments` in the endpoint (`api/driving.py` and, identically, `mobile/src/engine/driving.ts`); it adds no table or view. A *stretch* is one row of that view: the driving between two consecutive status reports. Stretches are put in four bands by `km` (under 5, 5 to 20, 20 to 100, over 100; a stretch of exactly 5 km is in the second), except those with `gap_hours` of 48 or more, which are counted apart as `unclassified`. A consumption (`100 * sum(fuel_l) / sum(km)`) and an average speed are given only when the distance summed is 20 km or more. The month rows count every stretch of the month (so their consumption equals `/api/trends/monthly`), their `bands` only the stretches put in one.

`GET /api/day?date=` (the Day page) builds one list of everything on one day of the car's **local** calendar (`car_timezone`), in the endpoint (`api/day.py` and, identically, `mobile/src/engine/day.ts`); it adds no table or view. The entries come from `v_trip_segments` (`drive`), `v_vehicle_status` (`status`), `v_door_status` (`doors`, only when what is open changed), `v_warnings` (`warning`, one per code and day), `v_dtc_readout_summary` with the codes of `v_dtc_events` (`readout`), `v_alarm_events` (`alarm`), `v_refuels` (`fill_up`), `diag_reports` (`diag`) and `alerts` (`alert`, by `occurred_at`). A drive and a fill-up are placed on the day of the later of their two reports. `local` / `local_until` are the car's local time as text; `at` / `until` stay UTC.

`GET /api/status/tire-forecast` reads `v_tire_readings` only (measurements with a known time and all four wheels). For each wheel it takes the difference from the mean of the other three over the last 30 days, restarts at a refill, and estimates the slope as the median of the slopes between every pair of measurements at least a day apart (`backend/src/mazda_dash/tires.py`, the same SQL in `mobile/src/engine/tires.ts`). The limit it aims at is `ref_settings.tire_limit_kpa`, copied from `low_tire_pressure.min_kpa` of the model's `alerts.yaml` when the settings are loaded. Because the slope is a median over pairs a day or more apart, a wheel that reads lower at one time of day than another (it cools faster, the sun warms the others) is not taken for a leak (checked in M69, no adjustment needed); a daily swing of about 15 kPa on one wheel can, however, pass the refill rule and restart that wheel's series.

`GET /api/forecast` (the Overview's "Looking ahead") reads `v_odometer_readings`, `v_oil_readings` and two keys of `ref_settings` (`mileage_limit_km`, `mileage_start`, from `mileage` in `settings.yaml`), in one SQL (`backend/src/mazda_dash/forecast.py`, the same in `mobile/src/engine/forecast.ts`). All of it is counted from the newest odometer reading's local day: the pace over the last 30 and 90 days, the oil countdown less the distance since it was read divided by each pace, and the distance since the anniversary of the mileage start date with its projection to the next one.

`GET /api/warnings/episodes` (the Warnings page's "Patterns", M63) reads `v_warning_episodes` and `v_warning_pattern_codes` (`api/episodes.py` and, identically, `mobile/src/engine/episodes.ts`). The patterns and the codes' roles come from all the data; the period only decides which episodes are counted (by `start_at`). A pattern is `recurring` from 3 episodes over all the data. A fault (`v_dtc_events`) is listed next to a pattern when it was read out within 24 hours of at least 3 of the pattern's episodes in the period and near a share of them (`pct`) at least 1.5 times its share of all the period's episodes (`pct_all`), so a fault read out in nearly every read-out is never listed. `companions` gives, for each code in 3 or more episodes (all the data), the other codes in 80% or more of those episodes, common codes left out: the hint shown next to a code that has no description.

`GET /api/status/unusual` (the Status page's "Unusual reports", M64) lists the reports of a period that have a row in `v_unusual_reasons`, newest first, each with its reasons and the car's local time as text (`api/unusual.py` and, identically, `mobile/src/engine/unusual.ts`), and counts the status and door reports looked at. The alert rule `unusual_report` (off by default) reads the same view.

`GET /api/trends/change-points` (the Trends page's "Steps in consumption", M65) adds no table or view: it reads `v_trip_segments` (stretches of 5 km or more with `gap_hours` under 48 and a `fuel_l`, in time order), and cuts their l/100 km, weighted by km, into segments of constant level by binary segmentation (`changepoints.py`, identically `mobile/src/engine/changepoints.ts`). Each segment gives its first and last time, stretches, km, weighted l/100 km and the share of all its classified stretches (`gap_hours` under 48) under 5 km.

`GET /api/trips/routines` (the Trends page's "Routines", M66) adds no table or view: it reads `v_trip_segments` (`gap_hours` under 48, `km` above 0) with each stretch's END in the car's local time (`car_timezone`), groups them by k-medoids (`routines.py`, identically `mobile/src/engine/routines.ts`) and describes each group of 8 stretches on 4 days or more (the median length and positive driving time, the weekend share, the circular mean end hour and its 10th–90th percentile range, the consumption from 20 km leaving out negative fuel figures). `members` gives each stretch's routine by its `end_at`.

`GET /api/dtcs/comeback` (the Faults page's "Comes back?", M67) adds no table or view: it reads `dtc_readings` with `dtc_headers` (a read-out's time is `coalesce(triggered_at, copied_at)`), keeps per unit the read-outs where it answered (`kind` `none` or `fault`), and for each fault walks them: a wait from the first read-out without it to the next one with it, censored at the unit's newest read-out. With 3 waits that ended it adds a Kaplan–Meier estimate (share still not back after 7, 30 and 90 days; the median wait). Titles come from `v_dtc_events` (only the owner's own descriptions).

`GET /api/dtcs/frame-voltage` (the Faults page's "Battery voltage in the freeze frames", M68) adds no table or view: from `v_frame_signals`, one frame per `snapshot_at` with `Main_ECU_Voltage_Supply` (else `ECU_Power_Voltage`), `Ambient_Air_Temperature`, `Engine_RPM`, `Time_Since_Engine_Start` and `SOC_StateOfCharge`; `state` = `off` (rpm 0), `starting` (running, under 60 s since the start) or `running`. Per running and off group with 12 frames on 4 days over 60 days: `per_degree` (Theil–Sen, pairs 3 °C apart), `per_30_days` of the temperature-adjusted voltage (Theil–Sen, pairs a day apart), `flat` (under 0.05 V), and a change point (`changepoints.segment`).

`GET /api/forecast/month` (the Overview's "Looking ahead", M71) adds no table or view: from `v_odometer_daily` over the 90 calendar days up to the newest day with data (each day's `km_since_previous`, 0 for a day without a report), a block bootstrap of 1,000 imagined 30-day months made of 7-day blocks (a Park–Miller generator, seed 1) gives the 10th, 50th and 90th percentile of the distance; litres use the consumption of `v_trip_segments` over the window (or since the last change point of M65 inside it), cost the price of `v_fuel_prices` in force on the newest day.

`import_log` (`imported_at`, `source`, `summary` as JSON) is created by the first import made from the dashboard (`POST /api/import`, `backend/src/mazda_dash/importer.py`) and read by `GET /api/imports`. It is not part of a fresh database's schema and is never exported to a pack. `ingest_runs` keeps recording every file of every load, from the dashboard or from `make ingest`.
