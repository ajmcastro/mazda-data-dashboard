"""Warning episodes and their patterns (PLAN.md M63), from the views ``v_warning_episodes`` and
``v_warning_pattern_codes`` (``views.sql`` explains how episodes are cut and patterns are found).

The patterns and each code's role in them are learned from ALL the data, so they do not change with the period;
the period only decides which episodes are counted (by the time an episode starts). A pattern is *recurring*
from ``MIN_EPISODES`` episodes on (over all the data). A fault is listed next to a pattern when it was read
out within ``FAULT_HOURS`` of at least ``MIN_FAULT_EPISODES`` of the pattern's episodes in the period AND near a
share of them at least ``FAULT_LIFT`` times its share of all the period's episodes: a fault read out in nearly
every read-out is near everything and says nothing about one pattern. A co-occurrence, never a cause.

A code's *companions* are the other codes in ``COMPANION_SHARE`` or more of the episodes that hold it (from
``MIN_EPISODES`` such episodes, all the data, codes common to nearly every episode left out): the hint shown
next to a code nobody has described yet.

The same SQL runs in the phone app (``mobile/src/engine/episodes.ts``): keep the two identical."""

import duckdb

from . import models as m
from .dates import DateRange
from .db import one, rows

MIN_EPISODES = 3
FAULT_HOURS = 24
MAX_FAULTS = 5
MIN_FAULT_EPISODES = 3
FAULT_LIFT = 1.5
COMPANION_SHARE = 0.8
DEFAULT_GAP_MINUTES = 10

GAP_SQL = (
    "SELECT coalesce(try_cast(max(value) FILTER (WHERE key = 'warning_episode_minutes') AS INTEGER), "
    f"{DEFAULT_GAP_MINUTES}) AS gap FROM ref_settings"
)
PATTERNS_SQL = (
    "SELECT e.pattern, count(*) AS episodes, any_value(t.total) AS episodes_total, "
    "count(DISTINCT CAST(e.start_at AS DATE)) AS days, min(e.start_at) AS first_at, max(e.start_at) AS last_at, "
    "round(median(date_diff('second', e.start_at, e.end_at)) / 60.0, 1) AS median_minutes "
    "FROM v_warning_episodes e "
    "JOIN (SELECT pattern, count(*) AS total FROM v_warning_episodes GROUP BY pattern) t USING (pattern) "
    "{where} GROUP BY e.pattern ORDER BY episodes DESC, e.pattern"
)
CODES_SQL = (
    "SELECT pc.pattern, pc.code, r.title, pc.role, pc.pct FROM v_warning_pattern_codes pc "
    "LEFT JOIN ref_warning_codes r ON r.code = pc.code WHERE pc.role <> 'common' "
    "ORDER BY pc.pattern, CASE pc.role WHEN 'core' THEN 0 ELSE 1 END, pc.pct DESC, pc.code"
)
COMMON_SQL = (
    "SELECT pc.code, any_value(r.title) AS title, "
    "round(100.0 * sum(pc.episodes_with) / any_value(t.n), 1) AS pct "
    "FROM v_warning_pattern_codes pc CROSS JOIN (SELECT count(*) AS n FROM v_warning_episodes) t "
    "LEFT JOIN ref_warning_codes r ON r.code = pc.code WHERE pc.role = 'common' "
    "GROUP BY pc.code ORDER BY pct DESC, pc.code"
)
FAULTS_SQL = (
    "WITH e AS (SELECT e.episode, e.pattern, e.start_at, e.end_at FROM v_warning_episodes e {where}), "
    "near AS (SELECT DISTINCT e.episode, e.pattern, d.ecu, d.dtc_code FROM e JOIN v_dtc_events d "
    f"ON d.event_at >= e.start_at - INTERVAL {FAULT_HOURS} HOUR "
    f"AND d.event_at <= e.end_at + INTERVAL {FAULT_HOURS} HOUR), "
    "sizes AS (SELECT pattern, count(*) AS n FROM e GROUP BY pattern), "
    "base AS (SELECT ecu, dtc_code, count(*) AS n FROM near GROUP BY ecu, dtc_code), "
    "titles AS (SELECT ecu, dtc_code, any_value(CASE WHEN known THEN title END) AS title "
    "FROM v_dtc_events GROUP BY ecu, dtc_code) "
    "SELECT nr.pattern, nr.ecu, nr.dtc_code, any_value(t.title) AS title, count(*) AS episodes, "
    "round(100.0 * count(*) / any_value(s.n), 1) AS pct, "
    "round(100.0 * any_value(b.n) / any_value(a.n), 1) AS pct_all "
    "FROM near nr JOIN sizes s USING (pattern) JOIN base b USING (ecu, dtc_code) "
    "CROSS JOIN (SELECT count(*) AS n FROM e) a LEFT JOIN titles t USING (ecu, dtc_code) "
    "GROUP BY nr.pattern, nr.ecu, nr.dtc_code "
    f"HAVING count(*) >= {MIN_FAULT_EPISODES} "
    f"AND count(*) * any_value(a.n) >= {FAULT_LIFT} * any_value(b.n) * any_value(s.n) "
    "ORDER BY nr.pattern, episodes DESC, nr.ecu, nr.dtc_code"
)
COMPANIONS_SQL = (
    "WITH ec AS (SELECT DISTINCT episode, code FROM "
    "(SELECT episode, unnest(codes) AS code FROM v_warning_episodes) u), "
    "common AS (SELECT DISTINCT code FROM v_warning_pattern_codes WHERE role = 'common'), "
    "n AS (SELECT code, count(*) AS n FROM ec GROUP BY code) "
    "SELECT a.code, any_value(n.n) AS episodes, b.code AS other, count(*) AS together "
    "FROM ec a JOIN ec b ON a.episode = b.episode AND a.code <> b.code JOIN n ON n.code = a.code "
    "WHERE a.code NOT IN (SELECT code FROM common) AND b.code NOT IN (SELECT code FROM common) "
    "GROUP BY a.code, b.code "
    f"HAVING any_value(n.n) >= {MIN_EPISODES} AND count(*) >= {COMPANION_SHARE} * any_value(n.n) "
    "ORDER BY a.code, together DESC, other"
)


def warning_episodes(
    con: duckdb.DuckDBPyConnection, rng: DateRange
) -> m.WarningEpisodes:
    where, params = rng.clause("e.start_at")
    gap = one(con, GAP_SQL)["gap"]
    patterns = rows(con, PATTERNS_SQL.format(where=where), params)
    codes: dict[int, list[dict]] = {}
    for r in rows(con, CODES_SQL):
        codes.setdefault(r.pop("pattern"), []).append(r)
    faults: dict[int, list[dict]] = {}
    for r in rows(con, FAULTS_SQL.format(where=where), params):
        found = faults.setdefault(r.pop("pattern"), [])
        if len(found) < MAX_FAULTS:
            found.append(r)
    companions: dict[str, dict] = {}
    for r in rows(con, COMPANIONS_SQL):
        found = companions.setdefault(
            r["code"], {"code": r["code"], "episodes": r["episodes"], "codes": []}
        )
        found["codes"].append(r["other"])
    listed = [
        {
            **p,
            "recurring": p["episodes_total"] >= MIN_EPISODES,
            "codes": codes.get(p["pattern"], []),
            "faults": faults.get(p["pattern"], []),
        }
        for p in patterns
    ]
    return m.WarningEpisodes(
        gap_minutes=gap,
        min_episodes=MIN_EPISODES,
        fault_hours=FAULT_HOURS,
        episodes=sum(p["episodes"] for p in listed),
        recurring_patterns=sum(1 for p in listed if p["recurring"]),
        one_off_episodes=sum(p["episodes"] for p in listed if not p["recurring"]),
        common=rows(con, COMMON_SQL),
        companions=list(companions.values()),
        patterns=listed,
    )
