"""Import from the dashboard (PLAN.md M53): POST /api/import, GET /api/imports and the checks before writing."""

import io
import zipfile
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from mazda_dash import importer
from mazda_dash.api.app import app
from mazda_dash.importer import ImportRefused, kind_of, members, safe_name, vins_of
from mazda_dash.ingest import find_files
from mazda_dash.sample import PROFILES, generate

RAW = {"Content-Type": "application/octet-stream"}


@pytest.fixture(scope="module")
def download(tmp_path_factory) -> Path:
    """Mazda's download for the sample CX-5: the export files in a folder of their own."""
    out = tmp_path_factory.mktemp("download")
    generate(out, profile=PROFILES["cx5"])
    for extra in out.glob(
        "*.yaml"
    ):  # the generator's settings are not part of a download
        extra.unlink()
    return out


@pytest.fixture
def root(tmp_path, monkeypatch) -> Path:
    """An empty project: one model with no data and no database yet."""
    cfg = tmp_path / "config" / "models" / "cx5"
    cfg.mkdir(parents=True)
    (tmp_path / "config" / "models.yaml").write_text("models: [cx5]\n")
    (cfg / "model.yaml").write_text(
        "id: cx5\nname: Mazda CX-5\nplatform: P\ndefault: true\n"
    )
    monkeypatch.setenv("MAZDA_ROOT", str(tmp_path))
    for name in ("MAZDA_DB", "MAZDA_DB_PREFIX", "MAZDA_READONLY"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


def zipped(folder: Path, prefix="", only=None, edit=None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for _kind, path in find_files(folder):
            if only and not any(part in path.name for part in only):
                continue
            data = path.read_bytes()
            z.writestr(prefix + path.name, edit(path.name, data) if edit else data)
    return buf.getvalue()


def first_part(share: float):
    """An older download: every CSV cut to its first `share` of rows (the files are in time order)."""

    def edit(name: str, data: bytes) -> bytes:
        if not name.endswith(".csv"):
            return data
        lines = data.split(b"\n")
        return b"\n".join(lines[: max(2, int(len(lines) * share))]) + b"\n"

    return edit


def post(client, name: str, data: bytes, **params):
    return client.post(
        "/api/import", params={"name": name, **params}, content=data, headers=RAW
    )


def stored(root: Path) -> list[str]:
    folder = root / "data" / "cx5"
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


# ------------------------------------------------------------------- pieces


def test_a_file_is_recognised_by_its_name_as_the_ingest_does():
    assert kind_of("all-war-24pf_war-24pf.csv") == "war"
    assert kind_of("all-dtc-ssr-24pf_dtc-ssr-24pf.csv") == "dtc-ssr"
    assert kind_of("all-dtc-d-24pf_dtc-d-24pf.csv") == "dtc-d"
    assert kind_of("all-24pf-diag-tool_24pf-diag-tool_1_20261015_090243.txt") == "diag"
    for other in (
        "notes.txt",
        "war.csv",
        "photo.jpg",
        "all-war-24pf_war-24pf.csv.exe",
        "settings.yaml",
    ):
        assert kind_of(other) is None, other


def test_only_a_plain_base_name_is_ever_used():
    assert safe_name("all-war-24pf_war-24pf.csv") == "all-war-24pf_war-24pf.csv"
    assert safe_name("some/folder/x_war-1.csv") == "x_war-1.csv"
    assert (
        safe_name("..\\..\\x_war-1.csv") == "x_war-1.csv"
    )  # the path is dropped, the name kept
    for bad in (
        "..",
        "../",
        ".hidden_war-1.csv",
        "x_war-1.csv\x00.txt",
        "a\nb_war-1.csv",
        "",
        "x" * 300 + "_war-1.csv",
    ):
        with pytest.raises(ImportRefused):
            safe_name(bad)


def test_a_zip_gives_its_files_and_skips_what_a_mac_adds(download):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("export/all-war-x_war-x.csv", "a")
        z.writestr("export/", "")
        z.writestr("__MACOSX/export/._all-war-x_war-x.csv", "junk")
        z.writestr("export/.DS_Store", "junk")
    assert members("download.zip", buf.getvalue()) == [("all-war-x_war-x.csv", b"a")]
    assert members("x_war-1.csv", b"VIN\n") == [("x_war-1.csv", b"VIN\n")]
    with pytest.raises(ImportRefused, match="empty"):
        members("x_war-1.csv", b"")
    empty = io.BytesIO()
    with zipfile.ZipFile(empty, "w"):
        pass
    with pytest.raises(ImportRefused, match="no files"):
        members("empty.zip", empty.getvalue())


def test_the_vin_is_read_from_each_kind_of_file(download):
    for kind, path in find_files(download):
        assert vins_of(path.name, kind, path.read_bytes()) == {"SAMPLEVIN00000001"}, (
            path.name
        )
    with pytest.raises(ImportRefused, match="no VIN column"):
        vins_of("x_war-1.csv", "war", b"a,b\n1,2\n")
    with pytest.raises(ImportRefused, match="not a CSV"):
        vins_of("x_war-1.csv", "war", b"\xff\xfe\x00")


# ------------------------------------------------------------------ the API


def test_the_zip_as_it_arrives_is_loaded_and_summarised(root, download):
    client = TestClient(app)
    r = post(client, "mazda-export.zip", zipped(download, prefix="export/"))
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["source"] == "mazda-export.zip"
    assert {f["status"] for f in s["files"]} == {"added"} and len(s["files"]) == len(
        find_files(download)
    )
    assert stored(root) == sorted(
        p.name for _k, p in find_files(download)
    )  # flat, in the model's folder
    assert [k["kind"] for k in s["rows_new"]] == [
        "war",
        "dtc-h",
        "dtc-d",
        "dtc-ssr",
        "rts",
        "vis",
        "alt",
        "diag",
    ]
    assert all(k["rows"] > 0 for k in s["rows_new"])
    assert (
        s["newest_day_before"] is None
        and s["newest_day_after"] == "2026-06-30"
        and s["km_since"] is None
    )
    assert s["new_warning_codes"] and s["faults_cleared"] == []
    assert s["open_alerts"] == len(s["new_alerts"]) > 0
    # the dashboard has the data, without a terminal
    assert client.get("/api/overview").json()["odometer_km"] > 4000
    assert client.get("/api/imports").json() == [s]


def test_the_same_download_again_changes_nothing(root, download):
    client = TestClient(app)
    data = zipped(download)
    assert post(client, "a.zip", data).status_code == 200
    again = post(client, "a.zip", data).json()
    assert {f["status"] for f in again["files"]} == {"already there"}
    assert (
        again["rows_new"] == [] and again["new_alerts"] == [] and again["km_since"] == 0
    )
    assert (
        again["faults_appeared"]
        == again["faults_cleared"]
        == again["new_warning_codes"]
        == []
    )
    assert len(client.get("/api/imports").json()) == 2
    assert len(stored(root)) == len(find_files(download))


def test_a_newer_download_with_the_same_names_is_kept_next_to_the_old_one(
    root, download
):
    client = TestClient(app)
    older = post(
        client, "older.zip", zipped(download, only=[".csv"], edit=first_part(0.4))
    ).json()
    newer = post(client, "newer.zip", zipped(download)).json()
    assert older["newest_day_after"] < newer["newest_day_after"] == "2026-06-30"
    assert newer["newest_day_before"] == older["newest_day_after"]
    assert newer["km_since"] > 100  # the odometer moved on
    status = {f["kind"]: f for f in newer["files"]}
    assert status["rts"]["status"] == "added" and status["diag"]["status"] == "added"
    # the name was taken by the older file: both are kept, the new one with a short hash, still read as rts
    assert (
        status["rts"]["saved_as"] != status["rts"]["name"]
        and kind_of(status["rts"]["saved_as"]) == "rts"
    )
    assert (
        status["diag"]["saved_as"] == status["diag"]["name"]
    )  # a new name is stored as it is
    assert len([n for n in stored(root) if "_rts-" in n]) == 2
    assert {"war", "rts", "diag"} <= {k["kind"] for k in newer["rows_new"]}
    assert post(client, "newer.zip", zipped(download)).json()["rows_new"] == []
    listed = client.get("/api/imports").json()
    assert [s["source"] for s in listed] == [
        "newer.zip",
        "newer.zip",
        "older.zip",
    ]  # newest first


def test_loose_files_one_after_the_other(root, download):
    client = TestClient(app)
    files = find_files(download)
    for _kind, path in files:
        r = post(client, path.name, path.read_bytes())
        assert r.status_code == 200, r.text
        assert [f["status"] for f in r.json()["files"]] == ["added"]
    assert len(stored(root)) == len(files) and len(
        client.get("/api/imports").json()
    ) == len(files)
    assert client.get("/api/overview").json()["active_faults"] >= 0


@pytest.mark.parametrize(
    ("name", "data", "message"),
    [
        ("holiday.jpg", b"\xff\xd8\xff", "not one of Mazda's export files"),
        ("notes.txt", b"hello", "not one of Mazda's export files"),
        ("x_war-1.csv", b"a,b\n1,2\n", "no VIN column"),
        ("..", b"x", "not a plain file name"),
    ],
)
def test_what_is_not_an_export_is_refused_and_nothing_is_written(
    root, name, data, message
):
    r = post(TestClient(app), name, data)
    assert r.status_code == 422 and message in r.json()["detail"]
    assert stored(root) == [] and not (root / "db").exists()
    assert (
        post(TestClient(app), "x_war-1.csv", b"").status_code == 422
    )  # nothing sent at all


def test_one_wrong_file_in_a_zip_refuses_all_of_it(root, download):
    buf = io.BytesIO(zipped(download))
    with zipfile.ZipFile(buf, "a") as z:
        z.writestr("readme.txt", "not an export")
    r = post(TestClient(app), "mixed.zip", buf.getvalue())
    assert (
        r.status_code == 422
        and "'readme.txt' is not one of Mazda's export files" in r.json()["detail"]
    )
    assert stored(root) == []


def test_a_path_that_tries_to_leave_the_folder_stays_inside_it(root, download):
    war = next(p for k, p in find_files(download) if k == "war")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../../../escaped_war-1.csv", war.read_bytes())
    r = post(TestClient(app), "tricky.zip", buf.getvalue())
    assert r.status_code == 200
    assert stored(root) == ["escaped_war-1.csv"]  # only the base name was used
    outside = [
        p
        for p in root.parent.rglob("escaped_war-1.csv")
        if (root / "data" / "cx5") not in p.parents
    ]
    assert outside == []


def test_another_cars_files_are_refused(root, download):
    client = TestClient(app)
    assert post(client, "mine.zip", zipped(download)).status_code == 200
    before = stored(root)
    other = zipped(
        download,
        only=["_war-"],
        edit=lambda _n, d: d.replace(b"SAMPLEVIN00000001", b"SAMPLEVIN00000009"),
    )
    r = post(client, "theirs.zip", other)
    assert r.status_code == 422 and "another car" in r.json()["detail"]
    assert stored(root) == before
    # and a single upload that mixes two cars, into an empty model
    (root / "db" / "cx5.duckdb").unlink()
    for p in (root / "data" / "cx5").iterdir():
        p.unlink()
    buf = io.BytesIO(zipped(download, only=["_war-"]))
    with zipfile.ZipFile(buf, "a") as z:
        rts = next(p for k, p in find_files(download) if k == "rts")
        z.writestr(
            rts.name,
            rts.read_bytes().replace(b"SAMPLEVIN00000001", b"SAMPLEVIN00000009"),
        )
    assert post(client, "two-cars.zip", buf.getvalue()).status_code == 422
    assert stored(root) == []


def test_refused_on_a_read_only_server_and_while_another_load_runs(
    root, download, monkeypatch
):
    client = TestClient(app)
    data = zipped(download, only=["_war-"])
    assert importer._running.acquire(blocking=False)  # another import is in progress
    try:
        r = post(client, "a.zip", data)
        assert (
            r.status_code == 503 and "Another import is running" in r.json()["detail"]
        )
    finally:
        importer._running.release()
    monkeypatch.setenv("MAZDA_READONLY", "1")
    r = post(client, "a.zip", data)
    assert r.status_code == 403 and "read-only" in r.json()["detail"]
    assert stored(root) == []
    monkeypatch.delenv("MAZDA_READONLY")
    assert post(client, "a.zip", data).status_code == 200
    assert post(client, "a.zip", data, model="nope").status_code == 404


def test_a_database_held_by_another_program_refuses_the_load(root, download):
    import subprocess
    import sys

    client = TestClient(app)
    assert post(client, "a.zip", zipped(download, only=["_war-"])).status_code == 200
    holder = subprocess.Popen(  # another process holding the write lock, as `make ingest` does
        [sys.executable, "-c", "import duckdb,sys,time; c=duckdb.connect(sys.argv[1]); print('held', flush=True); time.sleep(30)",
         str(root / "db" / "cx5.duckdb")],
        stdout=subprocess.PIPE, text=True,
    )  # fmt: skip
    try:
        assert holder.stdout.readline().strip() == "held"
        r = post(client, "b.zip", zipped(download, only=["_alt-"]))
        assert r.status_code == 503 and "busy" in r.json()["detail"]
    finally:
        holder.kill()
        holder.wait()
    # afterwards the load goes through and the lock was given back
    assert post(client, "b.zip", zipped(download, only=["_alt-"])).status_code == 200


def test_the_list_is_empty_before_any_import(root, download):
    client = TestClient(app)
    assert client.get("/api/imports").status_code == 503  # no database yet
    from mazda_dash.ingest import ingest
    from mazda_dash.models import load_registry

    model = load_registry(root).get("cx5")
    ingest(download, model.db_path, model.codes_dir)
    assert client.get("/api/imports").json() == []
    con = duckdb.connect(str(model.db_path), read_only=True)
    assert not con.execute(
        "SELECT 1 FROM duckdb_tables() WHERE table_name = 'import_log'"
    ).fetchone()
    con.close()
