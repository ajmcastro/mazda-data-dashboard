"""Check that nothing private from your own data is about to be published.

The private values (VINs, positions) are read from your real export files, so they never need
to be written down anywhere. The tool then looks for them in every file git would publish
(tracked files and untracked files that are not ignored) and in the whole git history, and
lists the commit author emails for you to review.

Usage: python -m mazda_dash.audit --data ../data --repo ..   (exit status 1 when something is found)
"""

import argparse
import csv
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

VIN_RE = re.compile(r"\bVIN\s+([A-HJ-NPR-Z0-9]{17})\b")
SENSITIVE_COLUMNS = {"vin", "latitude", "longitude"}
# Obviously fake values used by the sample data and tests; never reported.
SAFE = {"SAMPLEVIN00000001", "TESTVIN0000000001"}


@dataclass
class Report:
    tokens: int = 0
    file_hits: list[tuple[str, int, str]] = field(
        default_factory=list
    )  # path, line, masked token
    history_hits: list[tuple[str, str]] = field(
        default_factory=list
    )  # commit, masked token
    bad_files: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not (self.file_hits or self.history_hits or self.bad_files)


def mask(token: str) -> str:
    return (
        token if len(token) <= 6 else f"{token[:3]}…{token[-3:]} ({len(token)} chars)"
    )


def collect_tokens(data_dir: Path, extra: list[str]) -> set[str]:
    """Private values found in the raw exports, plus any ``extra`` ones given explicitly."""
    tokens = {t for t in extra if t}
    for path in sorted(data_dir.glob("*.csv")) if data_dir.exists() else []:
        with path.open(newline="", errors="replace") as f:
            reader = csv.DictReader(f)
            columns = [
                c for c in reader.fieldnames or [] if c.lower() in SENSITIVE_COLUMNS
            ]
            for row in reader:
                tokens.update(row[c] for c in columns if row[c])
    for path in sorted(data_dir.glob("*.txt")) if data_dir.exists() else []:
        tokens.update(VIN_RE.findall(path.read_text(errors="replace")))
    return {t for t in tokens if t not in SAFE and len(t) >= 5}


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=False
    )
    return result.stdout if result.returncode == 0 else ""


def publishable_files(repo: Path) -> list[Path]:
    out = _git(repo, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    return [repo / p for p in out.split("\0") if p]


def audit(data_dir: Path, repo: Path, extra: list[str] | None = None) -> Report:
    report = Report()
    tokens = collect_tokens(data_dir, extra or [])
    report.tokens = len(tokens)
    files = publishable_files(repo)

    for path in files:
        rel = str(path.relative_to(repo))
        if re.search(r"\.(duckdb|wal)$|(^|/)\.env$", rel) or rel.startswith("data/"):
            report.bad_files.append(rel)
            continue
        try:
            text = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            report.file_hits += [(rel, n, mask(t)) for t in tokens if t in line]

    for token in sorted(tokens):
        commits = _git(
            repo, "log", "--all", f"-S{token}", "--format=%h %s"
        ).splitlines()
        report.history_hits += [(c, mask(token)) for c in commits]

    report.emails = sorted(
        set(_git(repo, "log", "--all", "--format=%an <%ae>").splitlines())
    )
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=Path("../data"))
    ap.add_argument("--repo", type=Path, default=Path(".."))
    ap.add_argument(
        "--extra", action="append", default=[], help="another private value to look for"
    )
    args = ap.parse_args()
    extra = [*args.extra, *os.environ.get("AUDIT_EXTRA", "").split(",")]
    report = audit(args.data, args.repo, extra)

    print(f"Looked for {report.tokens} private value(s) taken from {args.data}")
    if report.tokens == 0:
        print("  (no private values found; is --data pointing at your real exports?)")
    for rel in report.bad_files:
        print(f"  NOT FOR PUBLISHING: {rel} would be published (data or database file)")
    for rel, line, token in report.file_hits:
        print(f"  FILE    {rel}:{line} contains {token}")
    for commit, token in report.history_hits:
        print(f"  HISTORY commit {commit} touches {token}")
    print("Commit authors (check these emails are ones you want public):")
    for e in report.emails:
        print(f"  {e}")
    print("OK: nothing private found" if report.clean else "PROBLEMS FOUND")
    sys.exit(0 if report.clean else 1)


if __name__ == "__main__":
    main()
