import subprocess
from pathlib import Path

import pytest

from mazda_dash.audit import audit, collect_tokens, mask
from mazda_dash.sample import VIN, generate

SECRET_VIN = "ZZZREALVIN0000042"  # made up for the test; looks like a VIN, is not one


def git(repo: Path, *args: str) -> None:
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=T",
            "-c",
            "user.email=t@example.com",
            *args,
        ],
        check=True,
        capture_output=True,
    )


@pytest.fixture
def repo(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / "x_war-1.csv").write_text(f'"VIN","other"\n"{SECRET_VIN}","a"\n')
    (data / "diag-tool.txt").write_text(f"VIN   {SECRET_VIN}\nVIN   {VIN}\n")
    (data / "all-rts_rts-1.csv").write_text(
        '"vin","latitude","longitude"\n"V","41.1234","-8.5678"\n'
    )
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    (repo / ".gitignore").write_text("*.duckdb\n")
    (repo / "README.md").write_text("nothing private here\n")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "init")
    return repo, data


def test_tokens_come_from_the_data_not_from_safe_values(repo):
    _, data = repo
    assert collect_tokens(data, []) == {SECRET_VIN, "41.1234", "-8.5678", "V"} - {"V"}


def test_clean_repo_passes(repo):
    repo_dir, data = repo
    report = audit(data, repo_dir)
    assert report.clean and report.tokens == 3
    assert report.emails == ["T <t@example.com>"]


def test_finds_secrets_in_files_and_in_history(repo):
    repo_dir, data = repo
    (repo_dir / "notes.md").write_text(f"vehicle {SECRET_VIN}\n")
    git(repo_dir, "add", ".")
    git(repo_dir, "commit", "-qm", "oops")
    (repo_dir / "notes.md").write_text(
        "scrubbed\n"
    )  # fixed in the tree, still in history
    git(repo_dir, "commit", "-qam", "scrub")
    report = audit(data, repo_dir)
    assert not report.clean
    assert report.file_hits == []
    assert len(report.history_hits) == 2  # added, then removed
    (repo_dir / "again.txt").write_text(f"{SECRET_VIN}\n")
    report = audit(data, repo_dir)
    assert report.file_hits == [("again.txt", 1, mask(SECRET_VIN))]


def test_flags_databases_and_data_files(repo):
    repo_dir, data = repo
    (repo_dir / "mazda.duckdb").write_text("x")  # ignored by .gitignore: fine
    (repo_dir / "other.wal").write_text("x")
    (repo_dir / "data").mkdir()
    (repo_dir / "data" / "export.csv").write_text("a\n")
    report = audit(data, repo_dir)
    assert sorted(report.bad_files) == ["data/export.csv", "other.wal"]


def test_mask_hides_most_of_the_value():
    assert "REALVIN" not in mask(SECRET_VIN)
    assert mask("abc") == "abc"


def test_sample_data_is_clean_and_deterministic(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    generate(a, seed=3)
    generate(b, seed=3)
    assert sorted(p.name for p in a.iterdir()) == sorted(p.name for p in b.iterdir())
    for p in a.iterdir():
        assert p.read_bytes() == (b / p.name).read_bytes()
    assert collect_tokens(a, []) == set()  # only the safe sample VIN, no positions
