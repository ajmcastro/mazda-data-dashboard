"""Two models side by side: data, code descriptions, settings and alerts never mix (PLAN.md M22)."""

import duckdb
import pytest
from conftest import ALT, DIAG, DTC_D, DTC_H, DTC_SSR, RTS, VIN, WAR

from mazda_dash.alerts import evaluate
from mazda_dash.ingest import distinct_vins, ingest
from mazda_dash.ingest import main as ingest_main
from mazda_dash.models import load_registry

VIN2 = "TESTVIN0000000002"


def write_model(root, model_id, files, config):
    cfg = root / "config" / "models" / model_id
    (cfg / "codes").mkdir(parents=True)
    (cfg / "model.yaml").write_text(f"id: {model_id}\nname: Mazda {model_id.upper()}\n")
    for name, text in config.items():
        (cfg / name).write_text(text)
    data = root / "data" / model_id
    data.mkdir(parents=True)
    for name, text in files.items():
        (data / name).write_text(text)


@pytest.fixture
def root(tmp_path):
    """cx5: the standard fixtures. cx60: another VIN, another platform code in the file names, other
    warning codes, another time zone and alert rules."""
    write_model(
        tmp_path,
        "cx5",
        {
            "all-war-24pf_war-24pf.csv": WAR,
            "all-dtc-h-24pf_dtc-h-24pf.csv": DTC_H,
            "all-dtc-d-24pf_dtc-d-24pf.csv": DTC_D,
            "all-dtc-ssr-24pf_dtc-ssr-24pf.csv": DTC_SSR,
            "all-rts-24pf_rts-24pf.csv": RTS,
            "all-alt-24pf_alt-24pf.csv": ALT,
            "all-24pf-diag-tool_24pf-diag-tool_1_20261015_090243.txt": DIAG,
        },
        {
            "settings.yaml": "car_timezone: Europe/Lisbon\n",
            "codes/warnings.yaml": '"$182": {title: CX-5 only title}\n',
        },
    )
    war60 = WAR.replace(VIN, VIN2).replace("$182", "$999").replace("$21D", "$998")
    write_model(
        tmp_path,
        "cx60",
        {"all-war-60xx_war-60xx.csv": war60},
        {
            "settings.yaml": "car_timezone: Asia/Tokyo\n",
            "alerts.yaml": "rules:\n  data_gap:\n    enabled: false\n",
        },
    )
    (tmp_path / "config" / "models.yaml").write_text("models: [cx5, cx60]\n")
    return tmp_path


@pytest.fixture
def dbs(root):
    registry = load_registry(root)
    out = {}
    for m in registry.models:
        ingest(m.data_dir, m.db_path, m.codes_dir)
        evaluate(m.db_path, m.alerts_path)
        out[m.id] = m
    return out


def rows(model, sql):
    con = duckdb.connect(str(model.db_path), read_only=True)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_each_database_holds_only_its_own_car(dbs):
    assert set(distinct_vins(dbs["cx5"].db_path)) == {VIN}
    assert set(distinct_vins(dbs["cx60"].db_path)) == {VIN2}
    assert rows(dbs["cx60"], "SELECT count(*) FROM dtc_readings") == [(0,)]


def test_code_descriptions_are_never_shared(dbs):
    sql = "SELECT code, title, known FROM v_warnings"
    cx5 = {r[0]: r[1:] for r in rows(dbs["cx5"], sql)}
    cx60 = {r[0]: r[1:] for r in rows(dbs["cx60"], sql)}
    assert cx5["$182"] == ("CX-5 only title", True)
    assert (
        "$182" not in cx60 and cx60["$999"][1] is False
    )  # no title: it is not borrowed
    unmapped = {r[1] for r in rows(dbs["cx60"], "SELECT * FROM v_unmapped_codes")}
    assert "$999" in unmapped and "$182" not in unmapped


def test_each_model_uses_its_own_time_zone(dbs):
    zone = "SELECT value FROM ref_settings WHERE key = 'car_timezone'"
    assert rows(dbs["cx5"], zone) == [("Europe/Lisbon",)]
    assert rows(dbs["cx60"], zone) == [("Asia/Tokyo",)]


def test_each_model_has_its_own_alert_rules_and_alerts(dbs):
    kinds = "SELECT DISTINCT rule FROM alerts"
    assert ("data_gap",) in rows(dbs["cx5"], kinds)
    # cx60's own alerts.yaml switches data_gap off; what it raises comes from its own warning codes
    assert rows(dbs["cx60"], kinds) == [("new_warning_code",)]
    sql = "SELECT title || detail FROM alerts"
    cx5 = " ".join(r[0] for r in rows(dbs["cx5"], sql))
    cx60 = " ".join(r[0] for r in rows(dbs["cx60"], sql))
    assert "$999" in cx60 and "$999" not in cx5 and "$182" not in cx60


def test_a_second_car_in_one_model_is_reported(dbs, root, capsys):
    cx5 = dbs["cx5"]
    (cx5.data_dir / "all-war-24pf_war-24pf-b.csv").write_text(
        WAR.replace(VIN, VIN2).replace("tx-w", "tx-z")
    )
    ingest_main_args = ["--model", "cx5", "--root", str(root), "--no-alerts"]
    import sys

    old, sys.argv = sys.argv, ["ingest", *ingest_main_args]
    try:
        ingest_main()
    finally:
        sys.argv = old
    out = capsys.readouterr().out
    assert "2 different VINs" in out and VIN not in out and VIN2 not in out  # masked


def test_an_empty_model_folder_is_reported_and_creates_no_database(root, capsys):
    registry = load_registry(root)
    for f in registry.get("cx60").data_dir.iterdir():
        f.unlink()
    import sys

    old, sys.argv = sys.argv, ["ingest", "--model", "cx60", "--root", str(root)]
    try:
        ingest_main()
    finally:
        sys.argv = old
    out = capsys.readouterr().out
    assert "no export files for Mazda CX60" in out
    assert not registry.get("cx60").db_path.exists()
