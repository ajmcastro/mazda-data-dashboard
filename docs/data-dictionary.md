# Data dictionary

Findings from milestone M1. Regenerate the detailed per-file profiles (gitignored) with `make profile` → `docs/profile/*.md`. Counts below are for the export covering 2026-06-12 → 2026-10-22; one VIN only.

## Conventions

- CSVs are comma-separated, all fields quoted, header row; **empty string = missing**. Read as text first, then cast.
- Timestamps come in two shapes:
  - `COPIED_DT_TM`, `fileid_datetime`: `YYYY-MM-DD HH:MM:SS`, no zone (assumed UTC; to be confirmed).
  - `*_TM`, `datacreationtime`: ISO-8601 UTC with `Z`.
- Single VIN everywhere; keep a `vin` column in the DB anyway.
- `rts`, `vis`, `alt` use the `<signal>_value` + `<signal>_validstatus` pair pattern. `validstatus` is `Valid`/`Invalid`; **an `Invalid` value must not be trusted** (it appears in `vis`, e.g. `drstatdrv`, `locklinkswdrv`, `dropnwrn`).

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
- `STATUS_CODE`: 1 (ok, 1012), 4 (153), 2 (1). `DISPLAY_STATUS` (hex: `28`, `08`, `0A`) and `DTC_STATUS_FLAG` (0–7) are UDS status bytes; decoding still to do.
- DTC format is `<code>:<failure type byte>`; the diag-tool file lists the same codes with `-<status>` suffix (e.g. `C1681:13-28`).

### `dtc-h` — DTC header (47 rows)
One row per transaction: `COPIED_DT_TM`, `WARNING_TRIGGER_OCCURRENCE_TM` (2 null), `ODO_INFORMATION_KM` (1,275–6,205), `DIAGNOSTICS_ACQUISITION_TM` (only 2 non-null). `HOURS=1`, `MINUTES=0` constant → ignore.

### `dtc-ssr` — DTC freeze-frame snapshots (137 rows, 83 transactions, 487 columns)
- **404 of 487 columns are always empty** (tire pressure/temp, wipers, etc.) and 53 more are constant → only ~30 columns carry information. Ingest as a narrow key/value (long) table, dropping empty columns, rather than 487 wide columns.
- Identification: `DISPLAY_DTC`, `ECU_NAME_MKT`, `DTC_SNAPSHOT_RECORD_NUMBER`, `WARNING_TRIGGER_OCCURRENCE_TM`, odometer; snapshot time is split over `Time_UTC_Information_{Year,Month,Date,Hour,Minute,…}`.
- Varying signals include battery/voltage-like and temperature-like values (unit semantics unknown), vehicle-speed and ignition flags.

### `rts` — remote vehicle status (214 rows)
`requesttype=RemoteConfirm`, `isinservicemode=false` (constant). Mostly constant signals (163 of 237 columns); useful varying ones:
`ododispvalue` (odometer, km, 59.1→6,243.0), `drv1avlfuele/g` (available fuel/range), `drv1drvtm`, `drv1distnc` (trip), `enginestate`, `powercontrolstatus`, `fuelsegementdactl` (fuel gauge segments), tire-pressure display values (`fltprsdispkp`, `frtprsdispkp`, `rltprsdispkp`, `rrtprsdispkp` in kPa, with `tprsdisp*` timestamp parts), `remoildistk/m` (oil change distance), seatbelt and occupant-sensor flags.
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
- `dtcs` section: per `ModuleName:<ECU>` lists of `CODE:FT-STATUS` (ADU, DCM, …; DCM codes are manufacturer-specific, prefix `X`).
- Trailing block of OBD monitor results: `OBDMID: <hex>, Test: <hex>, Min, Max, Value` lines with optional units.
- Parsing approach: a small state machine keyed on non-indented section headings and the `(KEY) = value unit` regex; DTC lists and OBDMID lines parsed separately.

## Implications for next milestones

1. **Ingestion (M2)**: store `war` exploded to one row per code; treat sentinels (`2147483647`, `4294967295`, odo `-1`) as NULL; filter `dtc-d` pseudo-codes (`19 02 8F`, `7F 19 10`) into a "read errors" category; `dtc-ssr` to long format; keep `Invalid` values flagged rather than dropped.
2. **Dedup keys**: `war`/`dtc-h`/`dtc-d`/`dtc-ssr`: `X_TRANSACTION_ID` (+ DTC / record number for detail rows); `rts`/`vis`/`alt`: `(vin, datacreationtime)`.
3. **Alerts (M5)** should be rate/new-code based: `$210` fires in ~98% of rows, and 906/1,166 `dtc-d` rows are "no fault".

## Open questions

- Timezone of `COPIED_DT_TM` / `fileid_datetime` (assumed UTC).
- Meaning of `$` warning codes, `DISPLAY_STATUS`/`DTC_STATUS_FLAG` values, burglar/alarm reason codes, `HOURS`/`MINUTES` in `war`.
- Whether `dtc-ssr`'s ~30 informative columns map to known signal names with units.
