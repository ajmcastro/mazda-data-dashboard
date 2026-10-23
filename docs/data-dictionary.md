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
- Meaning of `$` codes: unknown, to be mapped by the user (`config/codes/`).

### `dtc-d` — DTC detail (1,166 rows, 47 transactions)
- One row per ECU per read-out (26 distinct `ECU_NAME_MKT`, e.g. BCM, DCM, DSC, EPS, ADU, ECM, IC…), whether or not it has a fault.
- `DISPLAY_DTC` is **NULL in 906 rows** (ECU healthy / no DTC). Real codes: 18 distinct, e.g. `U0198:00`×25, `U3000:00`×17, `U2701:89`×9, `U2122/3/4:00`×7, `U2524:86`×7, `C1A0E/F, C1A10, C1AE1–4:87`, `C1681:13`, `C1C83:00`.
- `19 02 8F`×153 and `7F 19 10`×1 in `DISPLAY_DTC` are **not DTCs**: raw UDS requests/negative responses (`19 02 8F` = ReadDTCInformation request, `7F 19 10` = negative response) — rows with `STATUS_CODE=4/2` and NULL `DISPLAY_STATUS`; treat as read failures, not faults.
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
`ododispvalue` (odometer, km, 59.1→6,243.0), `drv1avlfuele/g` (available fuel/range), `drv1drvtm`, `drv1distnc` (trip), `enginestate`, `powercontrolstatus`, `fuelsegementdactl` (fuel gauge segments), tire-pressure display values (`fltprsdispkp`, `frtprsdispkp`, `rltprsdispkp`, `rrtprsdispkp` in kPa, with `tprsdisp*` timestamp parts), `remoildistk/m` (oil change distance), seatbelt and occupant-sensor flags.
- **Plain columns without a validity flag** (easy to miss: most columns are `_value` pairs): 6 `*_seatbelt_used` flags, 128 `vdt_2_warningpt_*` / `vdt_7_warningbody_*` warning bit flags (almost always 0; `vdt_7_warningbody_1_30` is 1 in 94 rows), and `latitude` / `longitude` — **location, populated in only 1 of 214 rows**. Treat as personal data (never commit; see the privacy rules in `PLAN.md`).
- Always-constant (ignore initially): `tpmsstatus`, `oillevelwarning`, `remainingmileage`, maintenance settings, etc.
- Note 74 `Invalid`-status occurrences are counted across these columns; filter on `_validstatus`.

### `vis` — vehicle info status (197 rows)
`requesttype=ForgetInform` (constant). Door/lock/hazard/light snapshot. Only 5 signals vary: `drstatdrv`, `locklinkswdrv`, `locklinkswpsngr`, `hazardsw`, `lghtswstate`. Door statuses for passenger/rear/trunk/hood/fuel lid are constant. Several values are flagged `Invalid` sometimes.

### `alt` — alarm status (4 rows)
`burglarstatus_value` (1 ×3, **5 ×1**) and `balarmreasondactl_value` (0 ×3, **5 ×1**), dates 2026-08-16, 2026-10-04, 2026-10-18 ×2. The row with value 5 / reason 5 is a security alarm event worth an alert (meaning of the codes to be confirmed).

### Diagnostic tool dump (`*.txt`, 481 lines)
Run on 2026-10-15 09:56:59 (UTC+0100), ODO 5,781 km. Not CSV; line-oriented with sections:
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

## Database schema

Created by `make ingest` in `db/mazda.duckdb` (gitignored). All timestamps are naive UTC; sentinels are NULL; re-running is idempotent (rows are keyed as below and skipped if present, never updated).

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
| `alerts` | `dedup_key` | raised by the alert rules (`config/alerts.yaml`); `status` new / acknowledged. Lives in the same file, so `make reset-db` loses acknowledgements |
| `ref_warning_codes`, `ref_dtc_codes`, `ref_ecus`, `ref_failure_types` | code | rebuilt from `config/codes/*.yaml` by `make model` |

Row counts on the current export: 7,039 warnings (11,177 codes), 47 DTC headers, 1,166 DTC readings (106 faults, 906 none, 154 read errors), 137 snapshots (2,745 values), 42,108 signal readings, 1 diagnostic report.

## Views and code lookups

`make model` (also run by `make ingest`) loads `config/codes/*.yaml` into `ref_*` tables and recreates these views. Codes without a description fall back to `Unknown warning $XXX` / `Unknown DTC XXXXX` with `known = false`; `make unmapped` lists them (`v_unmapped_codes`).

| View | What it gives |
|---|---|
| `v_warnings`, `v_warning_frequency` | one row per warning code occurrence; per-code counts, share of events, days seen, first/last seen |
| `v_dtc_events` | real faults only (not `none` / `read_error`), with ECU and failure-type titles, system (Powertrain/Chassis/Body/Network), scope, and the UDS status byte decoded (`confirmed`, `pending`, `test_failed`, `warning_indicator`) |
| `v_dtc_frequency` | per ECU + DTC: read-outs, first/last seen and odometer, `active_in_latest_readout` |
| `v_dtc_readout_summary` | per read-out: faults, read errors, ECUs reported |
| `v_dtc_snapshot_signals` | freeze-frame signals joined to their DTC |
| `v_vehicle_status` | wide remote-status timeline: odometer, fuel level, range, trip counters, engine state, tire pressures (kPa); `Invalid` signals are NULL. Latitude/longitude are deliberately left out |
| `v_door_status`, `v_alarm_events` | door/lock/light snapshots; burglar alarm status and reason |
| `v_odometer_readings`, `v_odometer_daily` | odometer from every source; daily max and km since the previous day with data |
| `v_trip_log`, `v_trip_segments`, `v_fuel_monthly` | trip-1 counters, consumption between consecutive snapshots, monthly km / litres / l per 100 km |
| `v_diag_values`, `v_diag_summary` | diagnostic-tool counters; lifetime and recent distance, fuel and l/100 km |
| `v_diag_obd` | Mode 6 monitor results with `in_range` (value within its min/max) and `position` (0 = at min, 1 = at max) |
| `v_diag_aes` | AES id / activity-state pairs from the tool dump (28 ids, all "Not Active" in the current report) |
| `v_freeze_frames` | one row per distinct freeze frame (ECU, DTC, record number, capture time) with how many read-outs repeated it. A DTC can have several records (e.g. ADU `C1A0F` has records 20-25); the car re-reports the same frames in later read-outs |
| `v_unmapped_codes` | warning codes, DTCs and ECUs seen in the data that have no description yet (`make unmapped`) |

Signal interpretations used by the views (inferred from the values, not documented by Mazda): `drv1avlfuele` = km/l, `drv1avlfuelg` = l/100 km (`102.2` = no data), `drv1distnc` = trip km, `drv1drvtm` = trip seconds, `fuelsegementdactl` = fuel level 0-100, `smaphremdrvdistnum` = remaining range km. Cross-checks: 100 / km-per-l equals l/100 km; trip km tracks the odometer delta; fuel economy comes out at 6.7-7.2 l/100 km per month, and the diagnostic tool reports 7.32 l/100 km lifetime.

Caveats: trip segments cover about 70% of the odometer distance (km driven before a counter reset that no snapshot saw are lost); a single segment's l/100 km is noisy, so use `v_fuel_monthly` or segments of 5+ km. DTC failure-type titles only list entries known with confidence; ECU titles marked "(inferred)" are guesses.

Freeze-frame signal units (km/h, rpm, V, ...) are not in the CSV; the frontend adds them from a small table in `frontend/src/lib.ts`, taken from the tool dump's printout of the same frames.

## Where the API goes beyond the views

The API is a thin layer over these views, with two exceptions. Endpoints that take a period (`from` / `to`) re-aggregate inside the endpoint so the range applies *before* grouping: `fuel/monthly`, `warnings/frequency` and `dtcs/frequency` mirror `v_fuel_monthly`, `v_warning_frequency` and `v_dtc_frequency` (the last one always keeps faults still active in the latest read-out). The Trends page's monthly figures (`/api/trends/monthly`) are computed in `backend/src/mazda_dash/api/trends.py`: distance from the odometer, consumption from trip segments, counts from the event tables, and `days_covered` / `partial` per month.
