"""Driving routines (PLAN.md M66): stretches grouped by k-medoids into the car's recurring kinds of stretch.

Each stretch is a point of four numbers, each on a comparable scale: the length (``log(1 + km)``, standardised
to mean 0 and standard deviation 1), the time of day it ended (the car's local hour on a circle: cosine and sine,
so 23:30 is next to 00:30) and whether it ended on a weekend (0 or 1). The distance is Euclidean.

k-medoids, deterministic: the BUILD start of PAM (the most central point first, then each next medoid the point
that lowers the total distance most), then alternating steps (each point to its nearest medoid; each group's
medoid the point with the least total distance to its group) until nothing changes. Ties go to the lowest
index. k from ``MIN_K`` to ``MAX_K`` is chosen by the mean silhouette (ties: the smaller k). Pure Python, no
random numbers; ``mobile/src/engine/routines.ts`` is the same algorithm line for line: change both together."""

import math

MIN_K = 2
MAX_K = 6
MAX_STEPS = 50


def features(
    km: list[float], hours: list[float], weekend: list[bool]
) -> list[list[float]]:
    """The points, each number rounded to 9 decimals: Python and the browser may differ in the last bit of a
    logarithm or a cosine, and rounding makes both see the same numbers."""
    lengths = [round(math.log(1 + k), 9) for k in km]
    n = len(lengths)
    mean = sum(lengths) / n
    sd = round(math.sqrt(sum((x - mean) ** 2 for x in lengths) / n), 9) or 1.0
    return [
        [
            round((lengths[i] - mean) / sd, 9),
            round(math.cos(2 * math.pi * hours[i] / 24), 9),
            round(math.sin(2 * math.pi * hours[i] / 24), 9),
            1.0 if weekend[i] else 0.0,
        ]
        for i in range(n)
    ]


def distances(points: list[list[float]]) -> list[list[float]]:
    n = len(points)
    d = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            s = 0.0
            for a, b in zip(points[i], points[j], strict=True):
                s += (a - b) * (a - b)
            d[i][j] = d[j][i] = math.sqrt(s)
    return d


def _nearest(d: list[list[float]], medoids: list[int], i: int) -> int:
    best = 0
    for m in range(1, len(medoids)):
        if d[i][medoids[m]] < d[i][medoids[best]]:
            best = m
    return best


def kmedoids(d: list[list[float]], k: int) -> tuple[list[int], list[int]]:
    """(medoids, the group of each point: an index into medoids)."""
    n = len(d)
    totals = [sum(row) for row in d]
    medoids = [min(range(n), key=lambda i: (totals[i], i))]
    near = [d[i][medoids[0]] for i in range(n)]
    while len(medoids) < k:
        best, best_gain = -1, -1.0
        for c in range(n):
            if c in medoids:
                continue
            gain = 0.0
            for i in range(n):
                if d[i][c] < near[i]:
                    gain += near[i] - d[i][c]
            if gain > best_gain:
                best, best_gain = c, gain
        medoids.append(best)
        near = [min(near[i], d[i][best]) for i in range(n)]
    groups = [_nearest(d, medoids, i) for i in range(n)]
    for _ in range(MAX_STEPS):
        changed = False
        for g in range(k):
            members = [i for i in range(n) if groups[i] == g]
            if not members:
                continue
            centre = min(members, key=lambda c: (sum(d[c][i] for i in members), c))
            if centre != medoids[g]:
                medoids[g] = centre
                changed = True
        new_groups = [_nearest(d, medoids, i) for i in range(n)]
        if new_groups != groups:
            groups = new_groups
            changed = True
        if not changed:
            break
    return medoids, groups


def silhouette(d: list[list[float]], groups: list[int], k: int) -> float:
    n = len(d)
    total = 0.0
    for i in range(n):
        sums = [0.0] * k
        counts = [0] * k
        for j in range(n):
            if j != i:
                sums[groups[j]] += d[i][j]
                counts[groups[j]] += 1
        own = groups[i]
        if counts[own] == 0:
            continue  # a group of one: silhouette 0
        a = sums[own] / counts[own]
        b = min(sums[g] / counts[g] for g in range(k) if g != own and counts[g] > 0)
        total += (b - a) / max(a, b) if max(a, b) > 0 else 0.0
    return total / n


def cluster(points: list[list[float]]) -> tuple[int, list[int], list[int], float]:
    """(k, medoids, groups, silhouette) for the best k; k = 1 when there are too few points."""
    n = len(points)
    if n < 2 * MIN_K:
        return 1, [0] if n else [], [0] * n, 0.0
    d = distances(points)
    best: tuple[int, list[int], list[int], float] | None = None
    for k in range(MIN_K, min(MAX_K, n - 1) + 1):
        medoids, groups = kmedoids(d, k)
        s = silhouette(d, groups, k)
        if best is None or s > best[3]:
            best = (k, medoids, groups, s)
    return best


def median(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def hours_around(hours: list[float]) -> tuple[float, float, float]:
    """(typical hour, low, high) on the 24-hour circle: the circular mean, and the 10th and 90th percentile of
    each hour's offset from it (so a routine around midnight is 23:00 to 01:00, not 01:00 to 23:00)."""
    sx = sum(round(math.cos(2 * math.pi * h / 24), 9) for h in hours)
    sy = sum(round(math.sin(2 * math.pi * h / 24), 9) for h in hours)
    mean = round(math.atan2(sy, sx) * 24 / (2 * math.pi), 9) % 24
    offsets = sorted(((h - mean + 12) % 24) - 12 for h in hours)
    n = len(offsets)
    lo = offsets[math.floor(0.1 * (n - 1))]
    hi = offsets[math.ceil(0.9 * (n - 1))]
    return mean, (mean + lo) % 24, (mean + hi) % 24
