"""Parser for the diagnostic tool's "Collect Diagnostic Information" text dump.

The file is line oriented. Top-level blocks are ``Mode 9``, ``Mode 9 Workaround``,
``dtcs``, ``Rob_dtcs``, ``SnapshotData`` and ``Mode 6``; ``ModuleName:<ECU>``
switches the ECU in every block."""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

UINT32_MAX = 4294967295
NUM_RE = re.compile(r"^([-+]?\d+(?:\.\d+)?)(?:\s*(\S.*))?$")
KV_RE = re.compile(r"^\s+\((?P<k>[^)]+)\)\s*=\s*(?P<v>.*)$")
DTC_LINE_RE = re.compile(r"^(X?[PCBU][0-9A-F]{4}):([0-9A-F]{2})-([0-9A-F]{2})$")
OBD_RE = re.compile(
    r"^OBDMID:\s*(\w+),\s*Test:\s*(\w+),\s*Min:\s*(.+?),\s*Max:\s*(.+?),\s*Value:\s*(.+)$"
)
TZ_RE = re.compile(r"UTC([+-])(\d{2})(\d{2})")
# Keys whose digits are identifiers, not quantities.
NON_NUMERIC_KEYS = {"AESIDx", "VIN", "CALID", "CVN", "RecordNumber"}


def parse_value(text: str, key: str = "") -> tuple[str, float | None, str | None]:
    """Split ``"141795.010 min"`` into (text, number, unit). UINT32_MAX means n/a."""
    text = text.strip()
    if key in NON_NUMERIC_KEYS:
        return text, None, None
    m = NUM_RE.match(text)
    if not m:
        return text, None, None
    num = float(m[1])
    if num == UINT32_MAX:
        num = None
    return text, num, (m[2] or None)


@dataclass
class DiagReport:
    report_id: str
    source_file: str
    vin: str | None = None
    taken_at: datetime | None = None
    odometer_km: float | None = None
    values: list[tuple] = field(
        default_factory=list
    )  # ecu, section, seq, key, value, num, unit
    dtcs: list[tuple] = field(
        default_factory=list
    )  # list_name, ecu, code, ftype, status
    snapshots: list[tuple] = field(
        default_factory=list
    )  # ecu, code, ftype, status, rec, sig, val, num, unit
    obd_tests: list[tuple] = field(
        default_factory=list
    )  # ecu, mid, test, min, max, value, unit


def _num(text: str) -> tuple[float | None, str | None]:
    _, n, u = parse_value(text)
    return n, u


def parse_diag_text(text: str, source_file: str = "") -> DiagReport:
    report = DiagReport(hashlib.sha256(text.encode()).hexdigest()[:12], source_file)
    date = time = None
    tz = timedelta(0)
    mode = None  # 'mode9' | 'dtcs' | 'rob_dtcs' | 'snapshots' | 'mode6' | None
    ecu = section = None
    seqs: dict[tuple, int] = {}
    snap: dict | None = None  # current snapshot: code, ftype, status, rec

    for raw in text.splitlines():
        line = raw.rstrip()
        s = line.strip()
        if not s:
            continue
        if s.startswith("Date:"):
            date = s[5:]
        elif s.startswith("Time:"):
            time = s[5:]
        elif s.startswith("TimeZone:"):
            if m := TZ_RE.search(s):
                tz = timedelta(hours=int(m[2]), minutes=int(m[3])) * (
                    1 if m[1] == "+" else -1
                )
        elif s.startswith("ODO:"):
            report.odometer_km, _ = _num(s[4:].removesuffix("km"))
        elif s == "Mode 9":
            mode, section, ecu = "mode9", None, None
        elif s == "Mode 6":
            mode, section = "mode6", None
        elif s == "Mode 9 Workaround":
            mode = None
        elif s == "dtcs":
            mode = "dtcs"
        elif s == "Rob_dtcs":
            mode = "rob_dtcs"
        elif s == "SnapshotData":
            mode, snap = "snapshots", None
        elif s.startswith("ModuleName:"):
            ecu = s.split(":", 1)[1].strip()
        elif mode == "mode9":
            if m := KV_RE.match(line):
                k = m["k"]
                text_v, num, unit = parse_value(m["v"], k)
                seq = seqs[(ecu, section, k)] = seqs.get((ecu, section, k), 0) + 1
                report.values.append((ecu, section, seq, k, text_v, num, unit))
            elif not line.startswith(" "):
                parts = re.split(r"\s{2,}", s, maxsplit=1)
                if len(parts) == 2 and parts[1]:
                    key, value = parts
                    if key == "VIN":
                        report.vin = value
                    report.values.append(
                        (ecu, "identification", 1, key, value, None, None)
                    )
                else:
                    section = s
        elif mode in ("dtcs", "rob_dtcs"):
            if m := DTC_LINE_RE.match(s):
                report.dtcs.append((mode, ecu, m[1], m[2], m[3]))
        elif mode == "snapshots":
            if s.startswith("DTC:"):
                m = DTC_LINE_RE.match(s[4:])
                snap = (
                    {"code": m[1], "ftype": m[2], "status": m[3], "rec": None}
                    if m
                    else None
                )
            elif snap is not None and ":" in s:
                key, value = s.split(":", 1)
                if key == "RecordNumber":
                    snap["rec"] = value.strip()
                else:
                    text_v, num, unit = parse_value(value, key)
                    report.snapshots.append(
                        (
                            ecu,
                            snap["code"],
                            snap["ftype"],
                            snap["status"],
                            snap["rec"],
                            key,
                            text_v,
                            num,
                            unit,
                        )
                    )
        elif mode == "mode6" and (m := OBD_RE.match(s)):
            mn, _ = _num(m[3])
            mx, _ = _num(m[4])
            val, unit = _num(m[5])
            report.obd_tests.append((ecu, m[1], m[2], mn, mx, val, unit))

    if date and time:
        local = datetime.strptime(f"{date} {time}", "%Y/%m/%d %H:%M:%S")
        report.taken_at = local - tz
    return report


def parse_diag_file(path: Path) -> DiagReport:
    return parse_diag_text(path.read_text(errors="replace"), path.name)
