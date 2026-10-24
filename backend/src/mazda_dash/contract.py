"""Golden responses of the real API, for the phone app's contract tests.

The phone app (``mobile/``) re-implements the API in TypeScript. This script runs the *Python*
API on the synthetic sample data for a wide matrix of requests and saves what it answered, plus
the data pack the phone engine loads. ``mobile/`` tests then replay every request against the
TypeScript engine and require the same JSON. The files are regenerated each time (they are not
committed), so the TypeScript engine is always compared with the current Python API.

Usage: python -m mazda_dash.contract --out ../mobile/contract
"""

import argparse
import json
import os
import shutil
import tempfile
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from .alerts import evaluate
from .api.app import app
from .ingest import ingest
from .pack import build_pack

REPO = Path(__file__).resolve().parents[3]

RANGE_ENDPOINTS = [
    "/api/overview",
    "/api/trends/monthly",
    "/api/odometer/daily",
    "/api/fuel/monthly",
    "/api/trips/segments",
    "/api/status/timeline",
    "/api/doors/timeline",
    "/api/alarms",
    "/api/warnings/frequency",
    "/api/warnings/daily",
    "/api/warnings/events",
    "/api/dtcs/frequency",
    "/api/dtcs/events",
    "/api/dtcs/readouts",
]


def _ranges(first: date, last: date) -> list[dict]:
    mid = first + (last - first) // 2
    month_start = date(mid.year, mid.month, 1)
    next_month = date(mid.year + (mid.month == 12), mid.month % 12 + 1, 1)
    return [
        {},
        {"from": mid.isoformat()},
        {"to": mid.isoformat()},
        {
            "from": month_start.isoformat(),
            "to": (next_month - timedelta(days=1)).isoformat(),
        },
        {
            "from": (first + timedelta(days=9)).isoformat(),
            "to": (last - timedelta(days=11)).isoformat(),
        },
        {"from": mid.isoformat(), "to": mid.isoformat()},
        {"from": first.isoformat(), "to": first.isoformat()},
        {"from": last.isoformat(), "to": last.isoformat()},
        {"from": "2031-01-01", "to": "2031-01-31"},
        {"from": "2000-01-01", "to": "2000-01-31"},
        {"from": "2000-01-01", "to": (first + timedelta(days=3)).isoformat()},
        {"from": mid.isoformat(), "to": "2031-01-01"},
        # invalid
        {"from": last.isoformat(), "to": first.isoformat()},
        {"from": "not-a-date"},
        {"to": "2026-13-45"},
    ]


def _normalise(body):
    """Things that legitimately differ between runs or implementations."""
    if isinstance(body, dict) and isinstance(body.get("detail"), list):
        return {
            "detail": "<validation>"
        }  # FastAPI's exact error structure is not part of the contract
    if isinstance(body, list):
        return [_normalise(x) for x in body]
    if isinstance(body, dict):
        return {
            k: ("<now>" if k == "acknowledged_at" and v is not None else _normalise(v))
            for k, v in body.items()
        }
    return body


class Recorder:
    def __init__(self, client: TestClient):
        self.client = client
        self.cases: list[dict] = []

    def get(self, path: str, **params) -> dict | list:
        qs = urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{path}?{qs}" if qs else path
        return self.call("GET", url)

    def call(self, method: str, url: str):
        r = self.client.request(method, url)
        try:
            body = r.json()
        except ValueError:
            body = r.text
        self.cases.append(
            {
                "method": method,
                "url": url,
                "status": r.status_code,
                "body": _normalise(body),
            }
        )
        return body


def record(client: TestClient) -> list[dict]:
    rec = Recorder(client)
    span = rec.get("/api/span")
    first, last = (
        date.fromisoformat(span["first_day"]),
        date.fromisoformat(span["last_day"]),
    )
    ranges = _ranges(first, last)

    # --- period endpoints x periods
    for path in RANGE_ENDPOINTS:
        for r in ranges:
            rec.get(path, **r)

    mid = {"from": (first + timedelta(days=20)).isoformat()}
    # --- endpoint-specific parameters
    for limit in (1, 5, 5000, 0, 5001, "x"):
        rec.get("/api/trips/segments", limit=limit)
        rec.get("/api/doors/timeline", limit=limit)
    rec.get("/api/trips/segments", limit=3, **mid)
    codes = [w["code"] for w in rec.get("/api/warnings/frequency")]
    for code in codes[:6] + ["$NOPE", ""]:
        rec.get("/api/warnings/events", code=code, limit=7)
    for limit, offset in (
        (100, 0),
        (10, 0),
        (10, 10),
        (10, 100000),
        (1000, 0),
        (1001, 0),
        (10, -1),
    ):
        rec.get("/api/warnings/events", limit=limit, offset=offset)
    rec.get("/api/warnings/events", code=codes[0], limit=5, offset=3, **mid)

    faults = rec.get("/api/dtcs/frequency")
    pairs = sorted({(f["ecu"], f["dtc_code"]) for f in faults})
    for ecu in sorted({e for e, _ in pairs}) + ["NOPE"]:
        rec.get("/api/dtcs/events", ecu=ecu, limit=50)
    for ecu, dtc in pairs + [("ADU", "ZZZZZ")]:
        rec.get("/api/dtcs/events", ecu=ecu, dtc_code=dtc)
        rec.get("/api/dtcs/events", ecu=ecu, dtc_code=dtc, **mid)
        rec.get("/api/dtcs/snapshots", ecu=ecu, dtc_code=dtc)
        rec.get("/api/dtcs/frames", ecu=ecu, dtc_code=dtc)
    rec.get("/api/dtcs/events", limit=3)
    rec.get("/api/dtcs/events", limit=0)
    rec.get("/api/dtcs/snapshots")
    rec.get("/api/dtcs/snapshots", ecu="ADU")
    rec.get("/api/dtcs/frames", dtc_code="X")

    readouts = rec.get("/api/dtcs/readouts")
    for tx in [r["transaction_id"] for r in readouts]:
        rec.get("/api/dtcs/context", transaction_id=tx)
    for tx in [r["transaction_id"] for r in readouts[:3]]:
        for hours in (0.25, 0.5, 6, 48, 0, 49, -1):
            rec.get("/api/dtcs/context", transaction_id=tx, window_hours=hours)
    rec.get("/api/dtcs/context", transaction_id="nope")
    rec.get("/api/dtcs/context")

    rec.get("/api/codes/unmapped")

    # --- diagnostic tool
    reports = rec.get("/api/diag/reports")
    rec.get("/api/diag/history")
    ids = [r["report_id"] for r in reports]
    for rid in ids + ["nope"]:
        rec.get(f"/api/diag/reports/{rid}")
        rec.get(f"/api/diag/reports/{rid}/frames")
    for a in ids:
        for b in ids:
            rec.get("/api/diag/compare", a=a, b=b)
    rec.get("/api/diag/compare", a=ids[0], b="nope")
    rec.get("/api/diag/compare", a="nope", b=ids[0])
    rec.get("/api/diag/compare", a=ids[0])

    # --- alerts: reads first, then the state changes in a fixed order
    for status in ("new", "acknowledged", "all", "bogus"):
        rec.get("/api/alerts", status=status)
    rec.get("/api/alerts")
    rec.get("/api/overview")
    new = rec.get("/api/alerts", status="new")
    if new:
        rec.call("POST", f"/api/alerts/{new[0]['alert_id']}/acknowledge")
        rec.call("POST", f"/api/alerts/{new[0]['alert_id']}/acknowledge")  # idempotent
        rec.get("/api/alerts", status="new")
        rec.get("/api/alerts", status="acknowledged")
        rec.get("/api/overview")
    rec.call("POST", "/api/alerts/999999/acknowledge")
    rec.call("POST", "/api/alerts/abc/acknowledge")
    rec.call("POST", "/api/alerts/acknowledge-all")
    rec.call("POST", "/api/alerts/acknowledge-all")
    rec.get("/api/alerts", status="all")
    rec.get("/api/overview")

    # --- routing
    rec.get("/api/nope")
    rec.call("POST", "/api/overview")
    rec.call("GET", "/api/alerts/1/acknowledge")
    return rec.cases


def generate(out: Path, source_db: Path | None = None) -> dict:
    """Record the goldens into ``out``. With ``source_db`` (e.g. your real database) that database is
    used instead of the sample data; it is copied first because the alert requests change state."""
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "contract.duckdb"
        if source_db:
            shutil.copyfile(source_db, db)
        else:
            ingest(REPO / "sample_data", db, REPO / "config" / "codes")
            evaluate(db, REPO / "config" / "alerts.yaml")
        build_pack(db, out / "sample.cx5pack")
        previous = os.environ.get("MAZDA_DB")
        os.environ["MAZDA_DB"] = str(db)
        try:
            cases = record(TestClient(app))
        finally:
            if previous is None:
                del os.environ["MAZDA_DB"]
            else:
                os.environ["MAZDA_DB"] = previous
    (out / "golden.json").write_text(
        json.dumps(cases, indent=None, separators=(",", ":"))
    )
    return {"cases": len(cases), "bytes": (out / "golden.json").stat().st_size}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=REPO / "mobile" / "contract")
    ap.add_argument(
        "--db",
        type=Path,
        help="record from this database instead of the sample data (it is copied)",
    )
    args = ap.parse_args()
    info = generate(args.out, args.db)
    print(
        f"{args.out}: {info['cases']} golden responses ({info['bytes'] / 1024:.0f} KiB) + sample.cx5pack"
    )


if __name__ == "__main__":
    main()
