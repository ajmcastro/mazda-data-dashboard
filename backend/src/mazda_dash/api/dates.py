"""The ``from`` / ``to`` query parameters shared by the period-based endpoints.

Both are calendar days in UTC and inclusive: ``to=2026-06-30`` includes the whole of 30 June.
Either may be left out; with neither, nothing is filtered (all time)."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import HTTPException, Query


@dataclass(frozen=True)
class DateRange:
    start: date | None = None
    end: date | None = None  # inclusive

    @property
    def open(self) -> bool:
        return self.start is None and self.end is None

    @property
    def start_ts(self) -> datetime | None:
        return datetime.combine(self.start, time.min) if self.start else None

    @property
    def end_ts(self) -> datetime | None:
        """Exclusive upper bound: midnight after the last included day."""
        return (
            datetime.combine(self.end + timedelta(days=1), time.min)
            if self.end
            else None
        )

    def conds(self, col: str) -> tuple[list[str], list]:
        conds, params = [], []
        if self.start_ts:
            conds.append(f"{col} >= ?")
            params.append(self.start_ts)
        if self.end_ts:
            conds.append(f"{col} < ?")
            params.append(self.end_ts)
        return conds, params

    def clause(self, col: str, prefix: str = "WHERE") -> tuple[str, list]:
        """SQL fragment limiting ``col`` to the range ('' when the range is open)."""
        conds, params = self.conds(col)
        return (f"{prefix} " + " AND ".join(conds), params) if conds else ("", [])


def date_range(
    from_: Annotated[
        date | None, Query(alias="from", description="first day, inclusive (UTC)")
    ] = None,
    to: Annotated[date | None, Query(description="last day, inclusive (UTC)")] = None,
) -> DateRange:
    if from_ and to and from_ > to:
        raise HTTPException(422, "'from' must not be after 'to'")
    return DateRange(from_, to)
