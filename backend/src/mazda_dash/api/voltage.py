"""Battery voltage in the freeze frames (PLAN.md M68): the supply voltage recorded with faults, over time.

One frame per distinct moment (``snapshot_at``: several faults recorded at the same moment carry the same values).
Its voltage is ``Main_ECU_Voltage_Supply`` (``ECU_Power_Voltage`` when the first is missing). The voltage depends
first on whether the engine runs (the alternator charges at about 13.5-14.5 V; with the engine off it is the
battery's own 12-13 V), so frames are kept in two groups by ``Engine_RPM``, and a running frame in the first
``STARTING_SECONDS`` after a start (``Time_Since_Engine_Start``) is set apart: the starter pulls the voltage down.

For each group, with ``MIN_FRAMES`` frames on ``MIN_DAYS`` different days over ``MIN_SPAN_DAYS``: the voltage's
dependence on the outside temperature (``Ambient_Air_Temperature``) as a Theil-Sen slope (pairs ``MIN_TEMP_GAP``
degrees apart), the temperature-adjusted voltage's slope per 30 days (Theil-Sen, pairs a day or more apart), and
a change point in it (``changepoints.segment``, as M65). Frames are only taken when a fault is recorded, so they are
not a fair sample of the car's life: the words say "the voltage recorded with faults".

The same in the phone app (``mobile/src/engine/voltage.ts``): keep the two identical. Only medians, sums and
divisions, apart from the change point's penalty (as M65)."""

import duckdb

from .. import changepoints
from . import models as m
from .db import rows

STARTING_SECONDS = 60
MIN_FRAMES = 12
MIN_DAYS = 4
MIN_SPAN_DAYS = 60
MIN_TEMP_GAP = 3.0
MIN_STEP = 0.3  # volts, for a change point
MIN_SIDE = 5  # frames on each side of a change point
FLAT = 0.05  # volts per 30 days: less is "about flat"

FRAMES_SQL = (
    "SELECT snapshot_at, "
    "coalesce(min(value_num) FILTER (WHERE signal = 'Main_ECU_Voltage_Supply'), "
    "min(value_num) FILTER (WHERE signal = 'ECU_Power_Voltage')) AS voltage, "
    "min(value_num) FILTER (WHERE signal = 'Ambient_Air_Temperature') AS ambient, "
    "min(value_num) FILTER (WHERE signal = 'Engine_RPM') AS rpm, "
    "min(value_num) FILTER (WHERE signal = 'Time_Since_Engine_Start') AS since_start, "
    "min(value_num) FILTER (WHERE signal = 'SOC_StateOfCharge') AS soc "
    "FROM v_frame_signals WHERE snapshot_at IS NOT NULL GROUP BY snapshot_at ORDER BY snapshot_at"
)


def _median(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def theil_sen(xs: list[float], ys: list[float], min_gap: float) -> float | None:
    """The median of the slopes between every pair of points at least ``min_gap`` apart in x."""
    slopes = [
        (ys[j] - ys[i]) / (xs[j] - xs[i])
        for i in range(len(xs))
        for j in range(i + 1, len(xs))
        if abs(xs[j] - xs[i]) >= min_gap
    ]
    return _median(slopes)


def _state(f: dict) -> str | None:
    if f["rpm"] is None:
        return None
    if f["rpm"] <= 0:
        return "off"
    return (
        "starting"
        if f["since_start"] is not None and f["since_start"] < STARTING_SECONDS
        else "running"
    )


def _group(state: str, frames: list[dict]) -> dict:
    days = sorted({f["snapshot_at"].date() for f in frames})
    span = (
        (frames[-1]["snapshot_at"] - frames[0]["snapshot_at"]).total_seconds() / 86400
        if frames
        else 0.0
    )
    volts = [f["voltage"] for f in frames]
    out = {
        "state": state,
        "frames": len(frames),
        "days": len(days),
        "first_at": frames[0]["snapshot_at"] if frames else None,
        "last_at": frames[-1]["snapshot_at"] if frames else None,
        "span_days": round(span, 1),
        "median": round(_median(volts), 2) if volts else None,
        "low": round(min(volts), 2) if volts else None,
        "high": round(max(volts), 2) if volts else None,
        "enough": len(frames) >= MIN_FRAMES
        and len(days) >= MIN_DAYS
        and span >= MIN_SPAN_DAYS,
        "per_degree": None,
        "per_30_days": None,
        "flat": None,
        "change_at": None,
        "change_before": None,
        "change_after": None,
    }
    if not out["enough"]:
        return out
    t0 = frames[0]["snapshot_at"]
    t = [(f["snapshot_at"] - t0).total_seconds() / 86400 for f in frames]
    with_temp = [f for f in frames if f["ambient"] is not None]
    per_degree = theil_sen(
        [f["ambient"] for f in with_temp],
        [f["voltage"] for f in with_temp],
        MIN_TEMP_GAP,
    )
    centre = _median([f["ambient"] for f in with_temp])
    adjusted = [
        f["voltage"]
        - (
            per_degree * (f["ambient"] - centre)
            if per_degree is not None and f["ambient"] is not None
            else 0
        )
        for f in frames
    ]
    slope = theil_sen(t, adjusted, 1.0)
    segs = changepoints.segment(
        adjusted, [1.0] * len(adjusted), MIN_SIDE, MIN_SIDE, MIN_STEP
    )
    out["per_degree"] = round(per_degree, 3) if per_degree is not None else None
    out["per_30_days"] = round(30 * slope, 2) if slope is not None else None
    out["flat"] = abs(30 * slope) < FLAT if slope is not None else None
    if len(segs) > 1:  # the first change, as the panel names one
        out["change_at"] = frames[segs[1].start]["snapshot_at"]
        out["change_before"] = round(segs[0].mean, 2)
        out["change_after"] = round(segs[1].mean, 2)
    return out


def frame_voltage(con: duckdb.DuckDBPyConnection) -> m.FrameVoltage:
    frames = [f for f in rows(con, FRAMES_SQL) if f["voltage"] is not None]
    listed = [
        {
            "at": f["snapshot_at"],
            "voltage": f["voltage"],
            "ambient": f["ambient"],
            "soc": f["soc"],
            "state": _state(f) or "unknown",
        }
        for f in frames
    ]
    return m.FrameVoltage(
        starting_seconds=STARTING_SECONDS,
        min_frames=MIN_FRAMES,
        min_days=MIN_DAYS,
        min_span_days=MIN_SPAN_DAYS,
        frames=listed,
        groups=[
            _group(state, [f for f in frames if _state(f) == state])
            for state in ("running", "off")
        ],
    )
