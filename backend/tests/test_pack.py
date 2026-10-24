"""The data pack for the offline mobile app: contents, privacy, and that it can rebuild every view."""

import json
import zipfile
from pathlib import Path

import duckdb
import pytest

from mazda_dash.ingest import ingest
from mazda_dash.pack import (
    GPS_SIGNALS,
    PACK_FORMAT,
    TABLES,
    build_pack,
    used_signals,
    views_sql,
)
from mazda_dash.sample import generate

CONFIG = Path(__file__).parents[2] / "config" / "codes"


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = tmp_path_factory.mktemp("pack")
    generate(root / "data")
    db = root / "p.duckdb"
    ingest(root / "data", db, CONFIG)
    out = root / "p.cx5pack"
    manifest = build_pack(db, out, with_reference=True)
    return db, out, manifest


def test_the_zip_holds_a_manifest_and_one_parquet_file_per_table(built):
    _, out, manifest = built
    with zipfile.ZipFile(out) as z:
        names = set(z.namelist())
        assert names == {"manifest.json", *(f"tables/{t}.parquet" for t in TABLES)}
        assert all(
            i.compress_type == zipfile.ZIP_STORED for i in z.infolist()
        )  # parquet is compressed
        assert json.loads(z.read("manifest.json")) == manifest
    assert manifest["format"] == PACK_FORMAT and manifest["kind"] == "cx5pack"
    assert (manifest["first_data_day"], manifest["last_data_day"]) == (
        "2026-03-01",
        "2026-06-30",
    )
    assert manifest["tables"]["warning_events"]["rows"] > 500


def test_manifest_checksums_match_the_files(built):
    import hashlib

    _, out, manifest = built
    with zipfile.ZipFile(out) as z:
        for table, info in manifest["tables"].items():
            data = z.read(f"tables/{table}.parquet")
            assert (
                hashlib.sha256(data).hexdigest() == info["sha256"]
                and len(data) == info["bytes"]
            )


def test_gps_positions_are_not_in_the_pack(built, tmp_path):
    db, out, manifest = built
    src = duckdb.connect(str(db), read_only=True)
    assert (
        src.execute(
            "SELECT count(*) FROM signal_readings WHERE signal IN ('latitude','longitude')"
        ).fetchone()[0]
        > 0
    )
    src.close()
    with zipfile.ZipFile(out) as z:
        z.extract("tables/signal_readings.parquet", tmp_path)
    con = duckdb.connect()
    path = tmp_path / "tables/signal_readings.parquet"
    assert (
        con.execute(
            f"SELECT count(*) FROM '{path}' WHERE signal IN ('latitude','longitude')"
        ).fetchone()[0]
        == 0
    )
    assert "latitude" in manifest["excluded"]


def _assert_rebuild_reproduces_views(out: Path, tmp_path: Path) -> None:
    """Load the Parquet files into an empty database, run views.sql, check every fingerprint."""
    ref = json.loads(Path(f"{out}.reference.json").read_text())
    with zipfile.ZipFile(out) as z:
        z.extractall(tmp_path)
    con = duckdb.connect()
    for table in TABLES:
        con.execute(
            f"CREATE TABLE {table} AS SELECT * FROM read_parquet('{tmp_path}/tables/{table}.parquet')"
        )
    con.execute(views_sql())
    assert len(ref["views"]) >= 20
    for view, entry in ref["views"].items():
        cur = con.execute(entry["sql"])
        got = dict(zip([d[0] for d in cur.description], cur.fetchone(), strict=True))
        for key, want in entry["expected"].items():
            if isinstance(want, float):
                assert got[key] == pytest.approx(want, rel=1e-9, abs=1e-6), (view, key)
            else:
                assert got[key] == want, (view, key)
    for table, rows in ref["tables"].items():
        assert (
            con.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == rows
            or table == "signal_readings"
        )


def test_a_browser_style_rebuild_reproduces_every_view(built, tmp_path):
    _, out, _ = built
    _assert_rebuild_reproduces_views(out, tmp_path)


def test_trimming_keeps_views_that_count_across_a_whole_source(built, tmp_path):
    """Real data has readings of signals no view names: an invalid one still counts in
    v_door_status.invalid_signals, and a snapshot of only unnamed signals is still a row of
    v_vehicle_status. Trimming must not change either (found by replaying the API on real data)."""
    db, _, _ = built
    copy = tmp_path / "extra.duckdb"
    copy.write_bytes(db.read_bytes())
    con = duckdb.connect(str(copy))
    con.execute(
        "INSERT INTO signal_readings VALUES "
        "('vis', 'V', 'x', TIMESTAMP '2026-05-01 10:00:00', NULL, 'unnamed_vis_signal', '1', 1, false), "
        "('vis', 'V', 'x', TIMESTAMP '2026-05-01 10:00:00', NULL, 'drstatdrv', '0', 0, true), "
        "('rts', 'V', 'x', TIMESTAMP '2026-05-01 11:00:00', NULL, 'unnamed_rts_signal', '1', 1, true), "
        "('rts', 'V', 'x', TIMESTAMP '2026-05-01 11:00:00', NULL, 'another_unnamed', '2', 2, true)"
    )
    con.close()
    out = tmp_path / "extra.cx5pack"
    build_pack(copy, out, with_reference=True)
    _assert_rebuild_reproduces_views(out, tmp_path / "x")
    kept, _ = _signals_in(out, tmp_path / "k", source=None)
    assert "unnamed_vis_signal" in kept  # small sources are exported whole
    assert (
        len({"unnamed_rts_signal", "another_unnamed"} & kept) == 1
    )  # one row keeps the snapshot


def test_the_reference_records_the_view_script_it_belongs_to(built):
    _, out, manifest = built
    ref = json.loads(Path(f"{out}.reference.json").read_text())
    assert ref["views_sql_sha256"] == manifest["views_sql_sha256"]
    assert "CREATE OR REPLACE VIEW v_trip_segments" in views_sql()


def test_alerts_table_is_exported_even_when_it_does_not_exist(tmp_path):
    generate(tmp_path / "data")
    db = tmp_path / "n.duckdb"
    ingest(
        tmp_path / "data", db, CONFIG
    )  # no alerts config given: alerts never evaluated
    out = tmp_path / "n.cx5pack"
    manifest = build_pack(db, out, compression="snappy")
    assert (
        manifest["tables"]["alerts"]["rows"] == 0
        and manifest["compression"] == "snappy"
    )


def test_an_unprepared_database_gets_a_clear_message(tmp_path):
    empty = tmp_path / "e.duckdb"
    duckdb.connect(str(empty)).close()
    with pytest.raises(SystemExit, match="make ingest"):
        build_pack(empty, tmp_path / "x.cx5pack")


def _signals_in(
    pack: Path, tmp: Path, source: str | None = "rts"
) -> tuple[set[str], int]:
    """Distinct signals and row count of the pack's signal_readings (of one source, or all)."""
    with zipfile.ZipFile(pack) as z:
        z.extract("tables/signal_readings.parquet", tmp)
    con = duckdb.connect()
    path = tmp / "tables/signal_readings.parquet"
    where = f"WHERE source = '{source}'" if source else ""
    rows = con.execute(f"SELECT DISTINCT signal FROM '{path}' {where}").fetchall()
    return {r[0] for r in rows}, con.execute(
        f"SELECT count(*) FROM '{path}' {where}"
    ).fetchone()[0]


def test_by_default_only_the_signals_the_views_read_are_in_the_pack(built, tmp_path):
    _, out, manifest = built
    kept, _ = _signals_in(out, tmp_path)  # remote-status signals
    everywhere, _ = _signals_in(out, tmp_path / "all", source=None)
    used = set(used_signals())
    lamps = {
        s for s in kept if s.startswith(("vdt_2_warningpt_", "vdt_7_warningbody_"))
    }
    assert kept - lamps <= used and len(used) >= 20  # nothing the views do not read ...
    assert {
        "ododispvalue",
        "fuelsegementdactl",
        "drstatdrv",
        "burglarstatus",
    } <= everywhere  # ... and what they do (the small vis / alt sources are whole)
    assert manifest["signals"] == sorted(used)
    assert not set(GPS_SIGNALS) & everywhere


def test_every_signal_used_by_a_view_is_found_by_the_scan():
    """Guards the scan: if views.sql starts referring to signals another way, this must be updated."""
    import re

    sql = views_sql()
    every_literal = set(
        re.findall(
            r"signal\s*(?:=|IN|LIKE)\s*\(?'([a-z0-9_]+)'", sql, flags=re.IGNORECASE
        )
    )
    assert every_literal == set(used_signals(sql))
    assert "signal IN" not in sql and "signal LIKE" not in sql


def test_all_signals_option_keeps_the_rest_but_never_gps(built, tmp_path):
    db, out, _ = built
    full = tmp_path / "full.cx5pack"
    manifest = build_pack(db, full, all_signals=True)
    kept_all, rows_all = _signals_in(full, tmp_path / "a")
    kept_default, rows_default = _signals_in(out, tmp_path / "b")
    assert manifest["signals"] == "all"
    assert kept_default < kept_all and rows_default < rows_all
    assert not set(GPS_SIGNALS) & kept_all


def test_the_warning_lamp_families_are_read_by_prefix_and_only_changing_flags_are_exported(
    built, tmp_path
):
    """128 bit flags, almost all constant: the views see only the ones that change, so only those rows
    are in the pack (and the 20 view fingerprints still match, see the rebuild test)."""
    from mazda_dash.pack import used_signal_prefixes

    db, out, manifest = built
    assert used_signal_prefixes() == ["vdt_2_warningpt_", "vdt_7_warningbody_"]
    assert manifest["signal_prefixes"] == used_signal_prefixes()
    src = duckdb.connect(str(db), read_only=True)
    varying = {
        r[0]
        for r in src.execute(
            "SELECT signal FROM signal_readings WHERE starts_with(signal, 'vdt_') "
            "GROUP BY signal HAVING count(DISTINCT value_num) > 1"
        ).fetchall()
    }
    constant = {
        r[0]
        for r in src.execute(
            "SELECT signal FROM signal_readings WHERE starts_with(signal, 'vdt_') "
            "GROUP BY signal HAVING count(DISTINCT value_num) = 1"
        ).fetchall()
    }
    src.close()
    assert len(varying) >= 3 and constant  # the sample has both kinds
    packed, _ = _signals_in(out, tmp_path / "lamps")
    assert varying <= packed and not constant & packed
