"""Code description packs (PLAN.md M61): what is shared, what is refused, and that importing never overwrites."""

from pathlib import Path

import duckdb
import pytest
import yaml

from mazda_dash import codepack
from mazda_dash.codepack import (
    PackError,
    apply,
    build,
    compare,
    export,
    other_model,
    private_values,
    read,
    set_entry,
)
from mazda_dash.model.lookups import load_lookups
from mazda_dash.models import load_registry

WARNINGS = """# my notes on the warning codes
"$201":
  title: Tire pressure warning lamp
  severity: warning
  notes: Seen with a low rear tire, twice.
"$2B7":
  title: null
  severity: unknown
"$4E9": {title: null, severity: unknown}   # appeared in June
"$0F2":
  title: Door ajar chime
  severity: info
  source: owner's manual, page 212
"""
ECUS = "BCM: {title: Body control module}\nADU: {title: null}\n"
FAILURES = '"00": No sub type information\n"87": Missing message\n'


def make_root(
    tmp_path: Path, model="cx5", name="Mazda CX-5", warnings=WARNINGS
) -> Path:
    codes = tmp_path / "config" / "models" / model / "codes"
    codes.mkdir(parents=True)
    (tmp_path / "config" / "models.yaml").write_text(f"models: [{model}]\n")
    (codes.parent / "model.yaml").write_text(
        f"id: {model}\nname: {name}\nplatform: 24PF\ndefault: true\n"
    )
    (codes / "warnings.yaml").write_text(warnings)
    (codes / "ecus.yaml").write_text(ECUS)
    (codes / "failure_types.yaml").write_text(FAILURES)
    return tmp_path


def model_of(root: Path, model="cx5"):
    return load_registry(root).get(model)


# ------------------------------------------------------------------- export


def test_only_described_codes_are_shared_each_with_a_source(tmp_path):
    pack = build(model_of(make_root(tmp_path)))
    assert pack["format"] == 1 and pack["model"] == {
        "id": "cx5",
        "name": "Mazda CX-5",
        "platform": "24PF",
    }
    assert set(pack["kinds"]) == {
        "warnings",
        "ecus",
        "failure_types",
    }  # no dtcs file, no flags described
    assert set(pack["kinds"]["warnings"]) == {
        "$201",
        "$0F2",
    }  # the two without a title are left out
    assert pack["kinds"]["warnings"]["$201"] == {
        "title": "Tire pressure warning lamp", "severity": "warning", "notes": "Seen with a low rear tire, twice.",
        "source": "Seen with a low rear tire, twice.",
    }  # fmt: skip
    assert pack["kinds"]["warnings"]["$0F2"]["source"] == "owner's manual, page 212"
    assert pack["kinds"]["ecus"] == {
        "BCM": {"title": "Body control module", "source": "not stated"}
    }
    assert pack["kinds"]["failure_types"]["87"] == {
        "title": "Missing message",
        "source": "not stated",
    }


def test_the_file_says_nothing_about_the_car(tmp_path):
    root = make_root(tmp_path)
    data = root / "data" / "cx5"
    data.mkdir(parents=True)
    (data / "all-war-x_war-x.csv").write_text(
        '"VIN","WARNING_LIST"\n"JM3KFBCM5N0123456","$201"\n'
    )
    out = tmp_path / "shared.yaml"
    export(model_of(root), out)
    text = out.read_text()
    assert "JM3KFBCM5N0123456" not in text
    shared = yaml.safe_load(text)
    assert set(shared) == {"format", "model", "kinds"} and set(shared["model"]) == {
        "id",
        "name",
        "platform",
    }
    for entries in shared["kinds"].values():
        for fields in entries.values():
            assert set(fields) <= {
                "title",
                "severity",
                "category",
                "notes",
                "source",
            }  # no counts, no dates
    assert read(out) == shared  # what is written is a pack that can be read


def test_a_description_that_holds_a_private_value_is_not_exported(tmp_path):
    root = make_root(
        tmp_path,
        warnings='"$201":\n  title: Lamp on my car JM3KFBCM5N0123456\n  severity: info\n',
    )
    out = tmp_path / "shared.yaml"
    with pytest.raises(PackError, match="look private"):
        export(model_of(root), out)
    assert not out.exists()
    assert (
        private_values({"x": "an ordinary sentence about a CONTROLMODULEUNIT1"}) == []
    )  # 18 letters: not a VIN
    assert private_values({"x": "see JM3KFBCM5N0123456"}) == ["JM3KFBCM5N0123456"]


def test_nothing_described_means_nothing_to_share(tmp_path):
    root = make_root(tmp_path, warnings='"$201": {title: null, severity: unknown}\n')
    (root / "config" / "models" / "cx5" / "codes" / "ecus.yaml").write_text(
        "ADU: {title: null}\n"
    )
    (root / "config" / "models" / "cx5" / "codes" / "failure_types.yaml").write_text("")
    with pytest.raises(PackError, match="no described code yet"):
        export(model_of(root), tmp_path / "shared.yaml")


# ------------------------------------------------------------------- import


def shared_pack(tmp_path: Path, model_id="cx5", name="Mazda CX-5") -> Path:
    pack = {
        "format": 1,
        "model": {"id": model_id, "name": name, "platform": "24PF"},
        "kinds": {
            "warnings": {
                "$201": {
                    "title": "Tire pressure warning lamp",
                    "severity": "warning",
                    "source": "dealer",
                },
                "$2B7": {
                    "title": "Washer fluid low",
                    "severity": "info",
                    "source": "owner's manual",
                },
                "$4E9": {"title": "Key battery low", "source": "forum, unverified"},
                "$0F2": {"title": "Door open warning", "source": "dealer"},
                "$999": {"title": "A code you never saw", "source": "dealer"},
            },
            "ecus": {"ADU": {"title": "Audio unit", "source": "workshop manual"}},
        },
    }
    path = tmp_path / "friend-codes.yaml"
    path.write_text(yaml.safe_dump(pack, sort_keys=False))
    return path


def test_every_entry_is_new_the_same_or_different(tmp_path):
    model = model_of(make_root(tmp_path))
    rows = {r.key: r for r in compare(model, read(shared_pack(tmp_path)))}
    assert {k: r.status for k, r in rows.items()} == {
        "warnings:$201": "same", "warnings:$2B7": "new", "warnings:$4E9": "new", "warnings:$0F2": "differs",
        "warnings:$999": "new", "ecus:ADU": "new",
    }  # fmt: skip
    assert (rows["warnings:$0F2"].yours, rows["warnings:$0F2"].theirs) == (
        "Door ajar chime",
        "Door open warning",
    )


def test_only_the_named_entries_are_added_and_marked(tmp_path):
    root = make_root(tmp_path)
    model, path = model_of(root), shared_pack(tmp_path)
    file = model.codes_dir / "warnings.yaml"
    written = apply(
        model,
        read(path),
        path.name,
        {"warnings:$2B7", "warnings:$999", "ecus:ADU"},
        set(),
    )
    assert [r.key for r in written] == ["ecus:ADU", "warnings:$2B7", "warnings:$999"]
    text = file.read_text()
    now = yaml.safe_load(text)
    assert now["$2B7"] == {
        "title": "Washer fluid low",
        "severity": "info",
        "source": "owner's manual",
        "from": "friend-codes.yaml",
    }
    assert (
        now["$999"]["from"] == "friend-codes.yaml"
        and now["$999"]["severity"] == "unknown"
    )
    # everything not named is exactly as it was: the owner's own titles, the untitled code, the comments
    assert (
        now["$201"]["title"] == "Tire pressure warning lamp"
        and "from" not in now["$201"]
    )
    assert (
        now["$4E9"] == {"title": None, "severity": "unknown"}
        and now["$0F2"]["title"] == "Door ajar chime"
    )
    assert (
        text.startswith("# my notes on the warning codes\n")
        and "# appeared in June" in text
    )
    assert (
        text.count('"$2B7"') + text.count("'$2B7'") + text.count("$2B7:") == 1
    )  # replaced in place, not repeated
    assert (
        yaml.safe_load((model.codes_dir / "ecus.yaml").read_text())["ADU"]["title"]
        == "Audio unit"
    )
    # the description files still load into the database, the two new fields included
    con = duckdb.connect()
    load_lookups(con, model.codes_dir)
    assert con.execute(
        "SELECT title FROM ref_warning_codes WHERE code = '$2B7'"
    ).fetchone() == ("Washer fluid low",)


def test_nothing_is_ever_overwritten_without_being_named(tmp_path):
    root = make_root(tmp_path)
    model, path = model_of(root), shared_pack(tmp_path)
    file = model.codes_dir / "warnings.yaml"
    before = file.read_text()
    for add, replace, message in (
        (
            {"warnings:$0F2"},
            set(),
            "--add takes entries you have no title for",
        ),  # it differs: not an add
        (
            {"warnings:$201"},
            set(),
            "--add takes entries you have no title for",
        ),  # the same: nothing to add
        (set(), {"warnings:$2B7"}, "--replace those that differ"),  # new: not a replace
        ({"warnings:$123"}, set(), "not in the pack"),
    ):
        with pytest.raises(PackError, match=message):
            apply(model, read(path), path.name, add, replace)
        assert file.read_text() == before
    # one good and one bad name: nothing is written
    with pytest.raises(PackError):
        apply(model, read(path), path.name, {"warnings:$2B7", "warnings:$0F2"}, set())
    assert file.read_text() == before
    # a difference is taken only when named as a replacement
    apply(model, read(path), path.name, set(), {"warnings:$0F2"})
    now = yaml.safe_load(file.read_text())
    assert now["$0F2"] == {
        "title": "Door open warning",
        "severity": "unknown",
        "source": "dealer",
        "from": "friend-codes.yaml",
    }


def test_a_pack_for_another_model_says_so(tmp_path):
    model = model_of(make_root(tmp_path))
    theirs = read(shared_pack(tmp_path, "cx60", "Mazda CX-60"))
    assert other_model(model, theirs) == (
        "this pack is for a Mazda CX-60; you are importing into a Mazda CX-5. "
        "Codes can mean something else on another model"
    )
    assert other_model(model, read(shared_pack(tmp_path))) is None


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("- not a pack\n", "not a code description pack"),
        ("format: 2\nmodel: {id: cx5}\nkinds: {}\n", "not a code description pack"),
        ("format: 1\nkinds: {}\n", "does not say which model"),
        ("format: 1\nmodel: {id: cx5}\nkinds: {pumps: {}}\n", "unknown kind"),
        (
            "format: 1\nmodel: {id: cx5}\nkinds: {warnings: {'$1': {title: ''}}}\n",
            "needs a title",
        ),
        (
            "format: 1\nmodel: {id: cx5}\nkinds: {warnings: {'$1': {title: x, seen: 12}}}\n",
            "may have title",
        ),
        (
            "format: 1\nmodel: {id: cx5}\nkinds: {warnings: {'$1': {title: x, severity: bad}}}\n",
            "severity must be",
        ),
        (
            "format: 1\nmodel: {id: cx5}\nkinds: {warnings: {'$1': {title: on JM3KFBCM5N0123456}}}\n",
            "look like a VIN",
        ),
        ("format: [1\n", "cannot be read"),
    ],
)
def test_a_file_that_is_not_a_clean_pack_is_refused(tmp_path, text, message):
    path = tmp_path / "bad.yaml"
    path.write_text(text)
    with pytest.raises(PackError, match=message):
        read(path)


def test_an_entry_is_replaced_in_place_or_appended():
    text = '# top\n"$1":\n  title: null\n  severity: unknown\n\n# about two\n"$2": {title: Two}\n'
    one = '"$1":\n  title: One\n'
    assert (
        set_entry(text, "$1", one)
        == '# top\n"$1":\n  title: One\n\n# about two\n"$2": {title: Two}\n'
    )
    assert (
        set_entry(text, "$2", '"$2":\n  title: Deux\n')
        == '# top\n"$1":\n  title: null\n  severity: unknown\n\n# about two\n"$2":\n  title: Deux\n'
    )
    assert set_entry(text, "$3", '"$3":\n  title: Three\n').endswith(
        '"$2": {title: Two}\n"$3":\n  title: Three\n'
    )
    assert (
        set_entry(
            "BCM: {title: null}\nBCM2: {title: Other}\n", "BCM", "BCM:\n  title: Body\n"
        )
        == "BCM:\n  title: Body\nBCM2: {title: Other}\n"
    )
    assert set_entry("", "X", "X:\n  title: x\n") == "X:\n  title: x\n"
    assert (
        set_entry("A: {title: a}", "B", "B:\n  title: b\n")
        == "A: {title: a}\nB:\n  title: b\n"
    )


# ---------------------------------------------------------------------- CLI


def test_the_command_line_lists_and_changes_nothing_until_told(tmp_path, capsys):
    root = make_root(tmp_path)
    path = shared_pack(tmp_path, "cx60", "Mazda CX-60")
    file = root / "config" / "models" / "cx5" / "codes" / "warnings.yaml"
    before = file.read_text()
    assert codepack.main(["import", "--root", str(root), "--file", str(path)]) == 0
    out = capsys.readouterr().out
    assert "WARNING: this pack is for a Mazda CX-60" in out
    assert (
        "new" in out
        and "differs" in out
        and "(yours: Door ajar chime)" in out
        and "Nothing was changed" in out
    )
    assert file.read_text() == before
    assert (
        codepack.main(["import", "--root", str(root), "--file", str(path), "--add-new"])
        == 0
    )
    assert "4 entries written" in capsys.readouterr().out
    assert (
        yaml.safe_load(file.read_text())["$0F2"]["title"] == "Door ajar chime"
    )  # a difference is never part of --add-new
    out_file = tmp_path / "mine.yaml"
    assert codepack.main(["export", "--root", str(root), "--out", str(out_file)]) == 0
    assert (
        "no VIN, no counts, no dates" in capsys.readouterr().out
        and read(out_file)["kinds"]["warnings"]["$2B7"]
    )
    assert (
        codepack.main(
            ["import", "--root", str(root), "--file", str(tmp_path / "missing.yaml")]
        )
        == 1
    )
    assert "error:" in capsys.readouterr().err


def test_the_repositorys_own_descriptions_can_be_exported(tmp_path):
    """The real description files hold no private value, so the author's own pack can be made."""
    repo = Path(__file__).parents[2]
    for model in load_registry(repo).models:
        pack = build(model)
        assert private_values(pack) == []
