"""The service log (PLAN.md M50): the file, its table, GET /api/service-log, the Mac-only POST and the day page."""

from datetime import date
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash.api.app import app
from mazda_dash.ingest import ingest
from mazda_dash.model.settings import (
    SERVICE_KINDS,
    add_service_entry,
    load_service_log,
    service_entries,
    service_line,
)
from mazda_dash.models import load_registry
from mazda_dash.pack import TABLES
from mazda_dash.sample import PROFILES, generate

REPO = Path(__file__).parents[2]


# ------------------------------------------------------------------ the file


def test_the_file_is_read_and_checked(tmp_path):
    log = tmp_path / "service_log.yaml"
    assert service_entries(log) == []  # no file, no entries
    log.write_text("# nothing yet\n")
    assert service_entries(log) == []
    log.write_text(
        "- {date: 2026-09-14, kind: oil_change, note: Oil and filter, odometer_km: 4310}\n"
        '- {date: 2026-10-02, kind: tires, note: "Winter tires, all four"}\n'
    )
    assert service_entries(log) == [
        (date(2026, 9, 14), "oil_change", "Oil and filter", 4310.0),
        (date(2026, 10, 2), "tires", "Winter tires, all four", None),
    ]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("kind: tires\n", "expected a list"),
        (
            "- {date: 2026-09-14, kind: oil_chnge, note: x}\n",
            "must be one of oil_change",
        ),
        ("- {date: 2026-09-14, kind: tires}\n", "must have `date`, `kind` and `note`"),
        (
            "- {date: 2026-09-14, kind: tires, note: x, cost: 5}\n",
            "may have `odometer_km`",
        ),
        ("- {date: 14 Sep, kind: tires, note: x}\n", "must be a date"),
        ("- {date: 2026-09-14, kind: tires, note: ''}\n", "one line of text"),
        (
            "- {date: 2026-09-14, kind: tires, note: x, odometer_km: far}\n",
            "number of kilometres",
        ),
        (
            "- {date: 2026-09-14, kind: tires, note: x, odometer_km: -1}\n",
            "number of kilometres",
        ),
    ],
)
def test_a_mistake_in_the_file_fails_loudly_and_names_it(tmp_path, text, message):
    log = tmp_path / "service_log.yaml"
    log.write_text(text)
    with pytest.raises(ValueError, match=message) as e:
        service_entries(log)
    assert str(log) in str(e.value)


def test_the_table_keeps_the_files_order(tmp_path):
    log = tmp_path / "service_log.yaml"
    log.write_text(
        "- {date: 2026-09-14, kind: service, note: first}\n- {date: 2026-09-14, kind: repair, note: second}\n"
    )
    con = duckdb.connect()
    assert load_service_log(con, log) == 2
    assert con.execute("SELECT n, kind FROM ref_service_log ORDER BY n").fetchall() == [
        (1, "service"),
        (2, "repair"),
    ]
    assert load_service_log(con, None) == 0  # always a table, empty without a file
    assert con.execute("SELECT count(*) FROM ref_service_log").fetchone() == (0,)
    assert "ref_service_log" in TABLES  # the phone's pack carries it


def test_adding_an_entry_keeps_what_was_there_and_never_adds_twice(tmp_path):
    log = tmp_path / "service_log.yaml"
    before = "# my own notes\n- {date: 2026-09-14, kind: oil_change, note: Oil and filter}  # at the dealer\n"
    log.write_text(before)
    assert (
        add_service_entry(log, "2026-10-02", "tires", 'Winter tires: "all four"', 5120)
        is True
    )
    text = log.read_text()
    assert text.startswith(before)  # comments and the old entry untouched
    assert text.endswith(
        '- {date: 2026-10-02, kind: tires, note: "Winter tires: \\"all four\\"", odometer_km: 5120}\n'
    )
    assert service_entries(log)[-1] == (
        date(2026, 10, 2),
        "tires",
        'Winter tires: "all four"',
        5120.0,
    )
    assert (
        add_service_entry(log, "2026-10-02", "tires", 'Winter tires: "all four"', 5120)
        is False
    )
    assert log.read_text() == text
    with pytest.raises(ValueError, match="must be one of"):
        add_service_entry(log, "2026-10-03", "wash", "x", None)
    assert log.read_text() == text  # a refused entry writes nothing


def test_a_new_file_gets_a_header_and_odd_notes_read_back(tmp_path):
    log = tmp_path / "service_log.yaml"
    for note in (
        "Brake pads: front",
        "50% worn #2",
        "it's {done}",
        "ünïcode — ok",
        "- leading dash",
    ):
        assert add_service_entry(log, "2026-11-01", "repair", note, None) is True
    assert log.read_text().startswith("# What was done to the car")
    assert [e[2] for e in service_entries(log)] == [
        "Brake pads: front", "50% worn #2", "it's {done}", "ünïcode — ok", "- leading dash",
    ]  # fmt: skip
    assert (
        service_line(date(2026, 1, 2), "other", "x", None)
        == '- {date: 2026-01-02, kind: other, note: "x"}'
    )


# ------------------------------------------------------------------- the API


@pytest.fixture
def root(tmp_path):
    """A repository root with one model, its sample data ingested from its own config folder."""
    (tmp_path / "config" / "models" / "cx5").mkdir(parents=True)
    (tmp_path / "config" / "models.yaml").write_text("models: [cx5]\n")
    cfg = tmp_path / "config" / "models" / "cx5"
    (cfg / "model.yaml").write_text(
        "id: cx5\nname: Mazda CX-5\nplatform: P\ndefault: true\n"
    )
    generate(tmp_path / "data" / "cx5", profile=PROFILES["cx5"])
    (cfg / "settings.yaml").write_text(
        (tmp_path / "data" / "cx5" / "settings.yaml").read_text()
    )
    (cfg / "fuel_log.yaml").write_text(
        (tmp_path / "data" / "cx5" / "fuel_log.yaml").read_text()
    )
    model = load_registry(tmp_path).get("cx5")
    ingest(model.data_dir, model.db_path, model.codes_dir, model.settings_path)
    mp = pytest.MonkeyPatch()
    mp.setenv("MAZDA_ROOT", str(tmp_path))
    for name in ("MAZDA_DB", "MAZDA_DB_PREFIX", "MAZDA_READONLY"):
        mp.delenv(name, raising=False)
    yield tmp_path
    mp.undo()


def test_the_data_suggests_entries_until_the_log_has_one_near(root):
    client = TestClient(app)
    got = client.get("/api/service-log").json()
    assert got["kinds"] == list(SERVICE_KINDS) and got["entries"] == []
    reasons = {s["reason"] for s in got["suggestions"]}
    assert "diagnostic_report" in reasons  # the sample car has three visits
    visits = [s for s in got["suggestions"] if s["reason"] == "diagnostic_report"]
    assert len(visits) == 3 and all(s["kind"] == "service" for s in visits)
    assert [s["date"] for s in got["suggestions"]] == sorted(
        (s["date"] for s in got["suggestions"]), reverse=True
    )
    # an entry within a week of a visit takes that suggestion away, whatever its kind
    day = visits[0]["date"]
    r = client.post(
        "/api/service-log", json={"date": day, "kind": "repair", "note": "Recall work"}
    )
    assert r.status_code == 200 and r.json() == {"added": True, "entries": 1}
    after = client.get("/api/service-log").json()
    assert after["entries"] == [
        {"date": day, "kind": "repair", "note": "Recall work", "odometer_km": None}
    ]
    assert day not in [s["date"] for s in after["suggestions"]]
    assert len(after["suggestions"]) == len(got["suggestions"]) - 1


def test_posting_writes_the_models_file_once(root):
    client = TestClient(app)
    log = root / "config" / "models" / "cx5" / "service_log.yaml"
    entry = {
        "date": "2026-04-02",
        "kind": "tires",
        "note": "Summer tires",
        "odometer_km": 1500,
    }
    assert client.get("/api/health").json()["writable"] is True
    assert client.post("/api/service-log", json=entry).json() == {
        "added": True,
        "entries": 1,
    }
    assert client.post("/api/service-log", json=entry).json() == {
        "added": False,
        "entries": 1,
    }
    assert log.read_text().count("Summer tires") == 1
    assert sorted(p.name for p in log.parent.iterdir()) == [
        "fuel_log.yaml",
        "model.yaml",
        "service_log.yaml",
        "settings.yaml",
    ]
    # it shows on its day, first, as a day and not a moment
    day = client.get("/api/day", params={"date": "2026-04-02"}).json()
    first = day["entries"][0]
    assert (first["kind"], first["code"], first["text"], first["odometer_km"]) == (
        "service",
        "tires",
        "Summer tires",
        1500,
    )
    assert first["at"] is None and first["local"] is None
    # a later `make model` reads the same file back
    con = duckdb.connect(str(load_registry(root).get("cx5").db_path))
    assert load_service_log(con, log) == 1
    con.close()


def test_a_bad_entry_is_refused_and_nothing_is_written(root):
    client = TestClient(app)
    log = root / "config" / "models" / "cx5" / "service_log.yaml"
    for bad in (
        {"date": "2026-04-02", "kind": "wash", "note": "x"},
        {"date": "yesterday", "kind": "tires", "note": "x"},
        {"date": "2026-04-02", "kind": "tires", "note": "  "},
        {"date": "2026-04-02", "kind": "tires", "note": "two\nlines"},
        {"date": "2026-04-02", "kind": "tires"},
    ):
        assert client.post("/api/service-log", json=bad).status_code == 422, bad
    assert not log.exists()
    assert client.post(
        "/api/service-log", params={"model": "nope"}, json={}
    ).status_code in (404, 422)


@pytest.mark.parametrize("name", ["MAZDA_READONLY", "MAZDA_DB_PREFIX"])
def test_a_read_only_server_refuses_to_write(root, name, monkeypatch):
    client = TestClient(app)
    log = root / "config" / "models" / "cx5" / "service_log.yaml"
    monkeypatch.setenv(name, "demo-" if name == "MAZDA_DB_PREFIX" else "1")
    if name == "MAZDA_READONLY":
        assert client.get("/api/health").json()["writable"] is False
        r = client.post(
            "/api/service-log",
            json={"date": "2026-04-02", "kind": "tires", "note": "x"},
        )
        assert r.status_code == 403 and "read-only" in r.json()["detail"]
    else:  # the demo's databases are not there under this root: refused before anything is written
        r = client.post(
            "/api/service-log",
            json={"date": "2026-04-02", "kind": "tires", "note": "x"},
        )
        assert r.status_code in (403, 503)
    assert not log.exists()


def test_writing_is_refused_while_the_database_is_busy(root):
    client = TestClient(app)
    log = root / "config" / "models" / "cx5" / "service_log.yaml"
    import subprocess
    import sys

    holder = subprocess.Popen(  # another process holding the write lock, as `make ingest` does
        [sys.executable, "-c", "import duckdb,sys,time; c=duckdb.connect(sys.argv[1]); print('held', flush=True); time.sleep(30)",
         str(load_registry(root).get("cx5").db_path)],
        stdout=subprocess.PIPE, text=True,
    )  # fmt: skip
    try:
        assert holder.stdout.readline().strip() == "held"
        r = client.post(
            "/api/service-log",
            json={"date": "2026-04-02", "kind": "tires", "note": "x"},
        )
        assert r.status_code == 503 and "busy" in r.json()["detail"]
        assert not log.exists()  # refused before the file is touched
    finally:
        holder.kill()
        holder.wait()


# ----------------------------------------------------------- the sample cars


@pytest.mark.parametrize("pid", list(PROFILES))
def test_the_sample_car_has_a_log_and_suggestions(tmp_path, pid, monkeypatch):
    data = tmp_path / "data"
    generate(data, profile=PROFILES[pid])
    assert len(service_entries(data / "service_log.yaml")) == 2
    db = tmp_path / "car.duckdb"
    ingest(data, db, REPO / "config" / "models" / pid / "codes", data / "settings.yaml")
    monkeypatch.setenv("MAZDA_DB", str(db))
    client = TestClient(app)
    got = client.get("/api/service-log").json()
    assert [e["kind"] for e in got["entries"]] == ["software", "tires"]  # newest first
    assert got["suggestions"]  # the diagnostic visits, at least
    assert (
        client.get("/api/health").json()["writable"] is False
    )  # a database override: never written
    assert (
        client.post(
            "/api/service-log",
            json={"date": "2026-04-02", "kind": "tires", "note": "x"},
        ).status_code
        == 403
    )
    # each entry is on its day's page
    for e in got["entries"]:
        day = client.get("/api/day", params={"date": e["date"]}).json()
        assert (
            day["entries"][0]["kind"] == "service"
            and day["entries"][0]["text"] == e["note"]
        )
