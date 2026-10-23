"""Loading a later export on top of an earlier one must equal loading everything at once.

The earlier export covers the first part of the sample period, the later one overlaps it
(the car re-sends recent rows) and runs to the end, which is what a monthly re-export looks like.
"""

import csv
import shutil
from pathlib import Path

import duckdb
import pytest

from mazda_dash.ingest import ingest
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config" / "codes"
TIME_COLUMN = {
    "war": "COPIED_DT_TM",
    "dtc-h": "COPIED_DT_TM",
    "dtc-d": "COPIED_DT_TM",
    "dtc-ssr": "COPIED_DT_TM",
    "rts": "datacreationtime",
    "vis": "datacreationtime",
    "alt": "datacreationtime",
}
TABLES = [
    "warning_events", "warning_codes", "dtc_headers", "dtc_readings", "dtc_snapshots",
    "dtc_snapshot_values", "signal_readings", "diag_reports", "diag_values", "diag_dtcs",
]  # fmt: skip


def split(
    source: Path, early: Path, late: Path, cut_early_end: str, cut_late_start: str
) -> None:
    """early gets rows before cut_early_end, late gets rows from cut_late_start on (overlapping)."""
    early.mkdir()
    late.mkdir()
    for path in source.iterdir():
        kind = next((k for k in TIME_COLUMN if f"_{k}-" in path.name), None)
        if kind is None:  # the diagnostic-tool dump belongs to the earlier export only
            shutil.copy(path, early / path.name)
            continue
        with path.open(newline="") as f:
            reader = csv.reader(f)
            header = next(reader)
            rows = list(reader)
        col = header.index(TIME_COLUMN[kind])
        for out, keep in (
            (early, lambda t: t < cut_early_end),
            (late, lambda t: t >= cut_late_start),
        ):
            with (out / path.name).open("w", newline="") as f:
                w = csv.writer(f, quoting=csv.QUOTE_ALL)
                w.writerow(header)
                w.writerows(r for r in rows if keep(r[col]))


def fingerprint(db: Path) -> dict[str, tuple[int, int]]:
    con = duckdb.connect(str(db), read_only=True)
    try:
        return {
            t: con.execute(f"SELECT count(*), sum(hash(x)) FROM {t} x").fetchone()
            for t in TABLES
        }
    finally:
        con.close()


@pytest.fixture(scope="module")
def exports(tmp_path_factory):
    root = tmp_path_factory.mktemp("incremental")
    generate(root / "all")
    # 2026-03..06: first export ends mid-May, the second starts two weeks earlier (overlap)
    split(root / "all", root / "early", root / "late", "2026-05-15", "2026-05-01")
    return root


def test_appending_a_later_export_equals_loading_everything(exports):
    ingest(exports / "all", exports / "full.duckdb", CONFIG)

    ingest(exports / "early", exports / "step.duckdb", CONFIG)
    before = fingerprint(exports / "step.duckdb")
    ingest(exports / "late", exports / "step.duckdb", CONFIG)
    after = fingerprint(exports / "step.duckdb")

    assert after == fingerprint(
        exports / "full.duckdb"
    )  # nothing lost, nothing duplicated
    assert (
        after["warning_events"][0] > before["warning_events"][0]
    )  # new rows were added
    assert after["diag_reports"] == before["diag_reports"]  # the earlier dump is kept


def test_overlapping_rows_are_not_duplicated(exports):
    ingest(exports / "early", exports / "dup.duckdb", CONFIG)
    ingest(exports / "late", exports / "dup.duckdb", CONFIG)
    results = ingest(
        exports / "late", exports / "dup.duckdb", CONFIG
    )  # the same export again
    assert all(new == 0 for *_, new in results)


def test_replacing_the_files_in_data_keeps_the_database(exports, tmp_path):
    """The usual workflow: overwrite data/ with the newest export and run ingest again."""
    data = tmp_path / "data"
    shutil.copytree(exports / "early", data)
    ingest(data, tmp_path / "db.duckdb", CONFIG)
    shutil.rmtree(data)
    shutil.copytree(exports / "late", data)  # same file names, different content
    ingest(data, tmp_path / "db.duckdb", CONFIG)
    full = tmp_path / "full.duckdb"
    ingest(exports / "all", full, CONFIG)
    got, want = fingerprint(tmp_path / "db.duckdb"), fingerprint(full)
    for table in TABLES:
        if table.startswith("diag"):
            continue  # the late export has no diagnostic dump; the early one is kept
        assert got[table] == want[table], table
