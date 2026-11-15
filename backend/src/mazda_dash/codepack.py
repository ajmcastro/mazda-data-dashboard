"""Code description packs (PLAN.md M61): share what an owner has learned about the codes, and take in what
another owner shares, without ever sharing anything about the car.

**Export** writes ``<model>-codes.yaml``: only the entries that HAVE a title, each with its ``source`` (how the
owner knows: the entry's own ``source``, else its ``notes``, else "not stated"), and the model's name and
platform. No VIN, no counts, no dates: it reads the description files only, never the data, and it refuses to
write a file in which a VIN-like value or a value of the model's own exports appears.

**Import** compares a pack with the model's descriptions (``new`` = no title here yet, ``same``, ``differs``) and
adds only the entries the owner names, each marked ``from: <file>`` so it can be told from their own. Nothing is
automatic, an entry that differs is replaced only when named with ``--replace``, and a pack made for another
model says so first. The description files keep their comments: only the named entry's lines change."""

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from .audit import collect_tokens
from .model.lookups import SEVERITIES
from .models import Model, add_model_option, resolve

FORMAT = 1
# seventeen characters of a VIN's alphabet (no I, O, Q), with a letter and a digit: no description needs one
VIN_LIKE = re.compile(
    r"\b(?=[A-HJ-NPR-Z0-9]*[0-9])(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b"
)
# kind -> the file under codes/, in the order they are listed
KINDS = {
    "warnings": "warnings.yaml",
    "dtcs": "dtcs.yaml",
    "ecus": "ecus.yaml",
    "failure_types": "failure_types.yaml",
    "warning_flags": "warning_flags.yaml",
}
WITH_SEVERITY = {"warnings", "dtcs", "warning_flags"}
SHARED_FIELDS = ("title", "severity", "category", "notes", "source")


class PackError(ValueError):
    """The pack cannot be written or read; the message says why."""


def _entries(path: Path) -> dict[str, dict]:
    """A description file as code -> fields (a bare string is a title, as failure_types.yaml has them)."""
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    if not isinstance(data, dict):
        raise PackError(f"{path}: expected a mapping of code -> details")
    return {
        str(k): ({"title": v} if isinstance(v, str) else dict(v or {}))
        for k, v in data.items()
    }


def build(model: Model) -> dict:
    """The pack of a model: its titled entries, with a source each. Reads config only."""
    kinds: dict[str, dict] = {}
    for kind, file in KINDS.items():
        out = {}
        for code, fields in _entries(model.codes_dir / file).items():
            title = fields.get("title")
            if not isinstance(title, str) or not title.strip():
                continue  # nothing learned about this code: nothing to share
            entry = {"title": title.strip()}
            for key in ("severity", "category", "notes"):
                if fields.get(key) not in (None, "", "unknown"):
                    entry[key] = fields[key]
            entry["source"] = str(
                fields.get("source") or fields.get("notes") or "not stated"
            )
            out[code] = entry
        if out:
            kinds[kind] = out
    return {
        "format": FORMAT,
        "model": {"id": model.id, "name": model.name, "platform": model.platform},
        "kinds": kinds,
    }


def private_values(pack: dict, model: Model | None = None) -> list[str]:
    """Anything in a pack that looks like a VIN, or is a value of the model's own exports. Must be empty."""
    text = yaml.safe_dump(pack, allow_unicode=True)
    found = set(VIN_LIKE.findall(text))
    if model is not None:
        found |= {t for t in collect_tokens(model.data_dir, []) if t in text}
    return sorted(found)


def export(model: Model, out: Path) -> dict:
    pack = build(model)
    if not pack["kinds"]:
        raise PackError(f"{model.name} has no described code yet: nothing to share")
    leaked = private_values(pack, model)
    if leaked:
        raise PackError(
            f"refusing to write {out}: {len(leaked)} value(s) that look private are in the descriptions "
            "(a VIN, or a value from your own exports). Remove them from the description files first"
        )
    header = (
        f"# Code descriptions shared by an owner of a {model.name}"
        + (f" ({model.platform})" if model.platform else "")
        + ".\n# Each entry says how its author knows (source). Nothing here is about a particular car.\n"
        "# Import with: make codes-import MODEL=<your model> FILE=<this file>\n"
    )
    out.write_text(
        header + yaml.safe_dump(pack, allow_unicode=True, sort_keys=False, width=100)
    )
    return pack


def read(path: Path) -> dict:
    """A pack file, checked: its shape, its kinds and each entry's fields."""
    try:
        pack = yaml.safe_load(path.read_text())
    except (OSError, yaml.YAMLError) as e:
        raise PackError(
            f"{path}: cannot be read as a code description pack ({e})"
        ) from e
    if (
        not isinstance(pack, dict)
        or pack.get("format") != FORMAT
        or not isinstance(pack.get("kinds"), dict)
    ):
        raise PackError(f"{path}: not a code description pack of format {FORMAT}")
    model = pack.get("model")
    if not isinstance(model, dict) or not isinstance(model.get("id"), str):
        raise PackError(f"{path}: the pack does not say which model it is for")
    for kind, entries in pack["kinds"].items():
        if kind not in KINDS or not isinstance(entries, dict):
            raise PackError(
                f"{path}: unknown kind {kind!r} (known: {', '.join(KINDS)})"
            )
        for code, fields in entries.items():
            where = f"{path}: {kind} {code}"
            if not isinstance(fields, dict) or set(fields) - set(SHARED_FIELDS):
                raise PackError(
                    f"{where}: an entry may have {', '.join(SHARED_FIELDS)}"
                )
            if not isinstance(fields.get("title"), str) or not fields["title"].strip():
                raise PackError(f"{where}: an entry needs a title")
            if fields.get("severity", "unknown") not in SEVERITIES:
                raise PackError(
                    f"{where}: severity must be one of {', '.join(sorted(SEVERITIES))}"
                )
    leaked = private_values(pack)
    if leaked:
        raise PackError(
            f"{path}: holds {len(leaked)} value(s) that look like a VIN; a pack must not"
        )
    return pack


@dataclass(frozen=True)
class Row:
    kind: str
    code: str
    status: str  # new | same | differs
    theirs: str
    yours: str | None

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.code}"


def compare(model: Model, pack: dict) -> list[Row]:
    """Every entry of the pack against the model's own descriptions."""
    rows = []
    for kind, entries in pack["kinds"].items():
        own = _entries(model.codes_dir / KINDS[kind])
        for code, fields in entries.items():
            yours = own.get(str(code), {}).get("title")
            yours = yours.strip() if isinstance(yours, str) and yours.strip() else None
            theirs = fields["title"].strip()
            status = (
                "new" if yours is None else "same" if yours == theirs else "differs"
            )
            rows.append(Row(kind, str(code), status, theirs, yours))
    return rows


def other_model(model: Model, pack: dict) -> str | None:
    """A sentence when the pack was made for another model; None when it is for this one."""
    theirs = pack["model"]
    if theirs.get("id") == model.id:
        return None
    return (
        f"this pack is for a {theirs.get('name') or theirs.get('id')}; you are importing into a {model.name}. "
        "Codes can mean something else on another model"
    )


def _entry_text(kind: str, code: str, fields: dict, origin: str) -> str:
    entry = {"title": fields["title"].strip()}
    if kind in WITH_SEVERITY:
        entry["severity"] = fields.get("severity", "unknown")
    for key in ("category", "notes", "source"):
        if fields.get(key):
            entry[key] = fields[key]
    entry["from"] = origin
    return yaml.safe_dump(
        {str(code): entry}, allow_unicode=True, sort_keys=False, width=100
    )


def set_entry(text: str, code: str, entry: str) -> str:
    """Put ``entry`` (the YAML of one code) in a description file's text: in place of that code's own lines when
    it has them, at the end otherwise. Every other line, comments included, stays as it is."""
    start = re.compile(rf"""^(["']?){re.escape(code)}\1\s*:""")
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if start.match(line):
            j = i + 1
            while j < len(lines) and (
                lines[j][:1] in (" ", "\t") or lines[j].strip() == ""
            ):
                j += 1
            while j > i + 1 and lines[j - 1].strip() == "":
                j -= 1  # blank lines after the entry stay where they are
            return "".join(lines[:i]) + entry + "".join(lines[j:])
    if text and not text.endswith("\n"):
        text += "\n"
    return text + entry


def apply(
    model: Model, pack: dict, origin: str, add: set[str], replace: set[str]
) -> list[Row]:
    """Add the named ``new`` entries and replace the named ``differs`` ones; returns what was written. A name
    that is not in the pack, or names an entry in a state it cannot be taken in, is an error before anything
    is written."""
    rows = {r.key: r for r in compare(model, pack)}
    unknown = sorted((add | replace) - set(rows))
    if unknown:
        raise PackError(f"not in the pack: {', '.join(unknown)}")
    wrong = sorted(k for k in add if rows[k].status != "new") + sorted(
        k for k in replace if rows[k].status != "differs"
    )
    if wrong:
        raise PackError(
            f"{', '.join(wrong)}: --add takes entries you have no title for, --replace those that differ from yours"
        )
    chosen = [rows[k] for k in sorted(add | replace)]
    by_file: dict[Path, str] = {}
    for row in chosen:
        path = model.codes_dir / KINDS[row.kind]
        text = by_file.get(path, path.read_text() if path.exists() else "")
        by_file[path] = set_entry(
            text,
            row.code,
            _entry_text(row.kind, row.code, pack["kinds"][row.kind][row.code], origin),
        )
    for path, text in by_file.items():  # check every file reads back before writing any
        parsed = yaml.safe_load(text)
        if not isinstance(parsed, dict):
            raise PackError(
                f"{path}: would not read back after the change; nothing was written"
            )
    for path, text in by_file.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return chosen


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="command", required=True)
    ex = sub.add_parser(
        "export", help="write the model's described codes to a file to share"
    )
    add_model_option(ex)
    ex.add_argument(
        "--out",
        type=Path,
        help="the file to write (default: <model>-codes.yaml in the project)",
    )
    im = sub.add_parser(
        "import", help="compare a shared file with yours; add only what you name"
    )
    add_model_option(im)
    im.add_argument("--file", type=Path, required=True)
    im.add_argument(
        "--add",
        nargs="*",
        default=[],
        metavar="KIND:CODE",
        help="entries you have no title for",
    )
    im.add_argument(
        "--add-new", action="store_true", help="every entry you have no title for"
    )
    im.add_argument(
        "--replace",
        nargs="*",
        default=[],
        metavar="KIND:CODE",
        help="entries that differ from yours",
    )
    args = ap.parse_args(argv)
    model = resolve(args.model, args.root)
    try:
        if args.command == "export":
            out = args.out or (model.config_dir.parents[2] / f"{model.id}-codes.yaml")
            pack = export(model, out)
            n = sum(len(v) for v in pack["kinds"].values())
            print(
                f"{out}: {n} described code(s) of {model.name}; no VIN, no counts, no dates"
            )
            return 0
        pack = read(args.file)
        warning = other_model(model, pack)
        if warning:
            print(f"WARNING: {warning}.")
        rows = compare(model, pack)
        for r in rows:
            mine = f"   (yours: {r.yours})" if r.status == "differs" else ""
            print(f"  {r.status:8} {r.key:32} {r.theirs}{mine}")
        add = set(args.add) | (
            {r.key for r in rows if r.status == "new"} if args.add_new else set()
        )
        replace = set(args.replace)
        if not add and not replace:
            new = sum(r.status == "new" for r in rows)
            print(
                f"{new} new, {sum(r.status == 'differs' for r in rows)} differ. Nothing was changed: name what to take in with --add / --add-new / --replace."
            )
            return 0
        written = apply(model, pack, args.file.name, add, replace)
        print(
            f"{len(written)} entr{'y' if len(written) == 1 else 'ies'} written, each marked `from: {args.file.name}`. Run `make model` to load them."
        )
    except PackError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
