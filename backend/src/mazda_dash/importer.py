"""Import Mazda's download from the dashboard (PLAN.md M53): what ``POST /api/import`` does.

One upload is the zip as Mazda sends it, or one loose export file. Every file in it must be a kind the ingest
knows (by its name, as ``find_files`` reads it); anything else refuses the whole upload, and nothing is written.
Files go into the model's own data folder and nowhere else: only a file's base name is used, and a name that is
not plain is refused. A file whose content is already in the folder is skipped; one whose NAME is there with
other content (Mazda's download keeps the same names) is stored next to it under a name that carries a short
hash, so no raw export is ever overwritten. A file of another car (a VIN the database does not have) refuses
the upload. Then the same ``ingest`` and alert evaluation as ``make ingest`` run, and what changed is worked
out from the database before and after and kept in ``import_log``."""

import csv
import hashlib
import io
import json
import re
import tempfile
import threading
import time
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from .alerts import evaluate
from .ingest import distinct_vins, ingest
from .ingest.csv_loaders import ORDER
from .ingest.diag_parser import parse_diag_file
from .models import Model

MAX_FILES = 200
MAX_BYTES = 500 * 1024 * 1024  # of one upload, unpacked
PLAIN_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ +()-]{0,180}$")
KIND_LABEL = {
    "war": "warnings",
    "dtc-h": "fault read-outs",
    "dtc-d": "faults",
    "dtc-ssr": "freeze frames",
    "rts": "status reports",
    "vis": "door reports",
    "alt": "alarm reports",
    "diag": "diagnostic reports",
}
_running = threading.Lock()
# The page that sent the upload is also reading: its requests hold read-only connections in this same
# process for a moment, and DuckDB will not open a writing one next to them. Wait for them, briefly.
RETRY_SECONDS = 15.0


def _patiently(step, *args, **kwargs):
    """Run a step that opens the database, waiting while this server's own readers hold it."""
    deadline = time.monotonic() + RETRY_SECONDS
    while True:
        try:
            return step(*args, **kwargs)
        except duckdb.ConnectionException as e:
            if time.monotonic() >= deadline:
                raise ImportBusy(
                    "The database stayed busy - try again in a moment"
                ) from e
            time.sleep(0.15)


class ImportRefused(ValueError):
    """The upload cannot be taken; the message says why. Nothing was written."""


class ImportBusy(RuntimeError):
    """Another import is running, or another program (``make ingest``) holds the database."""


def kind_of(name: str) -> str | None:
    """The kind of export a file name says it is, exactly as the ingest decides it."""
    low = name.lower()
    if low.endswith(".csv"):
        for kind in ORDER:
            if f"_{kind}-" in name:
                return kind
    if low.endswith(".txt") and "diag-tool" in name:
        return "diag"
    return None


def safe_name(name: str) -> str:
    """The base name of an uploaded file, refused unless it is a plain file name."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not PLAIN_NAME.match(base) or ".." in base:
        raise ImportRefused(f"{name!r} is not a plain file name")
    return base


def members(name: str, data: bytes) -> list[tuple[str, bytes]]:
    """The files of one upload: the entries of a zip, or the file itself."""
    if not data:
        raise ImportRefused(f"{name!r} is empty")
    if not zipfile.is_zipfile(io.BytesIO(data)):
        return [(safe_name(name), data)]
    out, total = [], 0
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            base = info.filename.replace("\\", "/").rsplit("/", 1)[-1]
            if (
                info.is_dir()
                or not base
                or base.startswith(".")
                or "__MACOSX" in info.filename
            ):
                continue  # folders and what a Mac adds to a zip
            total += info.file_size
            if len(out) >= MAX_FILES or total > MAX_BYTES:
                raise ImportRefused(
                    f"{name!r} holds too much (over {MAX_FILES} files or {MAX_BYTES >> 20} MB)"
                )
            out.append((safe_name(info.filename), z.read(info)))
    if not out:
        raise ImportRefused(f"{name!r} holds no files")
    return out


def vins_of(name: str, kind: str, data: bytes) -> set[str]:
    """The VINs a file is about (normally one)."""
    if kind == "diag":
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / name
            path.write_bytes(data)
            try:
                vin = parse_diag_file(path).vin
            except Exception as e:
                raise ImportRefused(
                    f"{name!r} is not a diagnostic report this dashboard can read"
                ) from e
        return {vin} if vin else set()
    try:
        rows = csv.reader(io.StringIO(data.decode("utf-8-sig")))
        header = next(rows)
    except (UnicodeDecodeError, StopIteration, csv.Error) as e:
        raise ImportRefused(
            f"{name!r} is not a CSV file this dashboard can read"
        ) from e
    at = next((i for i, col in enumerate(header) if col.strip().lower() == "vin"), None)
    if at is None:
        raise ImportRefused(
            f"{name!r} has no VIN column: it does not look like a Mazda export"
        )
    return {row[at].strip() for row in rows if len(row) > at and row[at].strip()}


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _snapshot(db: Path) -> dict:
    """What the summary compares: empty for a database that does not exist yet."""
    if not db.exists():
        return {"day": None, "km": None, "active": [], "codes": [], "alert": 0}
    con = duckdb.connect(str(db), read_only=True)
    try:
        day, km = con.execute(
            "SELECT CAST(max(read_at) AS DATE), max(odometer_km) FROM v_odometer_readings"
        ).fetchone()
        active = con.execute(
            "SELECT DISTINCT dtc_code FROM v_dtc_events WHERE transaction_id = "
            "(SELECT transaction_id FROM v_dtc_readout_summary ORDER BY event_at DESC, transaction_id LIMIT 1) "
            "ORDER BY 1"
        ).fetchall()
        codes = con.execute(
            "SELECT DISTINCT code FROM v_warnings ORDER BY 1"
        ).fetchall()
        has_alerts = con.execute(
            "SELECT 1 FROM duckdb_tables() WHERE table_name = 'alerts'"
        ).fetchone()
        alert = (
            con.execute("SELECT coalesce(max(alert_id), 0) FROM alerts").fetchone()[0]
            if has_alerts
            else 0
        )
    finally:
        con.close()
    return {
        "day": day.isoformat() if day else None,
        "km": km,
        "active": [r[0] for r in active],
        "codes": [r[0] for r in codes],
        "alert": alert,
    }


def _record(db: Path, at: datetime, source: str, summary: dict) -> None:
    con = duckdb.connect(str(db))
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS import_log (imported_at TIMESTAMP, source VARCHAR, summary VARCHAR)"
        )
        con.execute(
            "INSERT INTO import_log VALUES (?, ?, ?)", [at, source, json.dumps(summary)]
        )
    finally:
        con.close()


def past_imports(con: duckdb.DuckDBPyConnection, limit: int = 20) -> list[dict]:
    """The loads made from the dashboard, newest first (none for a database that never had one)."""
    if not con.execute(
        "SELECT 1 FROM duckdb_tables() WHERE table_name = 'import_log'"
    ).fetchone():
        return []
    rows = con.execute(
        "SELECT summary FROM import_log ORDER BY imported_at DESC LIMIT ?", [limit]
    ).fetchall()
    return [json.loads(r[0]) for r in rows]


def import_upload(
    model: Model, name: str, data: bytes, now: datetime | None = None
) -> dict:
    """Take one upload for ``model``: check it whole, store what is new, load it, and say what changed."""
    if not _running.acquire(blocking=False):
        raise ImportBusy("Another import is running - try again in a moment")
    try:
        return _import(model, name, data, now or datetime.now(UTC).replace(tzinfo=None))
    except duckdb.IOException as e:
        raise ImportBusy(
            "Database is busy (is `make ingest` running?) - try again"
        ) from e
    finally:
        _running.release()


def _import(model: Model, name: str, data: bytes, now: datetime) -> dict:
    files = members(name, data)
    # --- check everything before anything is written
    kinds, vins = [], set()
    for fname, content in files:
        kind = kind_of(fname)
        if kind is None:
            raise ImportRefused(
                f"{fname!r} is not one of Mazda's export files (their names hold _war-, _dtc-h-, _dtc-d-, "
                "_dtc-ssr-, _rts-, _vis-, _alt- or diag-tool); nothing was imported"
            )
        kinds.append(kind)
        vins |= vins_of(fname, kind, content)
    known = set(distinct_vins(model.db_path)) if model.db_path.exists() else set()
    if len(vins) > 1 or (known and vins - known):
        raise ImportRefused(
            f"These files are about another car than the one in {model.name}'s data (a different VIN). One model "
            "holds one car: import them into that car's own model. Nothing was imported"
        )
    # --- store what the folder does not have yet (never overwrite, never leave the folder)
    folder = model.data_dir
    folder.mkdir(parents=True, exist_ok=True)
    root = folder.resolve()
    have = {_digest(p.read_bytes()) for p in folder.iterdir() if p.is_file()}
    listed = []
    for (fname, content), kind in zip(files, kinds, strict=True):
        digest = _digest(content)
        if digest in have:
            listed.append(
                {
                    "name": fname,
                    "kind": kind,
                    "status": "already there",
                    "saved_as": None,
                }
            )
            continue
        target = folder / fname
        if (
            target.exists()
        ):  # Mazda's names repeat: keep both, the new one with a short hash in its name
            target = folder / f"{target.stem}-{digest[:8]}{target.suffix}"
        if target.resolve().parent != root or kind_of(target.name) != kind:
            raise ImportRefused(
                f"{fname!r} cannot be stored in the model's data folder"
            )
        tmp = target.with_name(f".{target.name}.part")
        tmp.write_bytes(content)
        tmp.rename(target)
        have.add(digest)
        listed.append(
            {"name": fname, "kind": kind, "status": "added", "saved_as": target.name}
        )
    # --- load, as `make ingest` does, and compare
    before = _patiently(_snapshot, model.db_path)
    results = _patiently(
        ingest, folder, model.db_path, model.codes_dir, model.settings_path
    )
    created, open_alerts = _patiently(
        evaluate, model.db_path, model.alerts_path, label=model.name
    )
    after = _patiently(_snapshot, model.db_path)
    rows: dict[str, int] = {}
    for kind, _file, _read, new in results:
        rows[kind] = rows.get(kind, 0) + new
    summary = {
        "imported_at": now.isoformat(timespec="seconds") + "Z",
        "source": safe_name(name),
        "files": listed,
        "rows_new": [
            {"kind": k, "label": KIND_LABEL[k], "rows": rows[k]}
            for k in [*ORDER, "diag"]
            if rows.get(k)
        ],
        "newest_day_before": before["day"],
        "newest_day_after": after["day"],
        "km_since": (
            round(after["km"] - before["km"], 1)
            if after["km"] is not None and before["km"] is not None
            else None
        ),
        "faults_appeared": sorted(set(after["active"]) - set(before["active"])),
        "faults_cleared": sorted(set(before["active"]) - set(after["active"])),
        "new_warning_codes": sorted(set(after["codes"]) - set(before["codes"])),
        "new_alerts": [c.title for c in created],
        "open_alerts": open_alerts,
    }
    _patiently(_record, model.db_path, now, summary["source"], summary)
    return summary
