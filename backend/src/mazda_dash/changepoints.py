"""Change points in a weighted series (PLAN.md M65): where the level of a series steps up or down.

Binary segmentation with a penalty. The series is one value per item with a weight (for consumption: each
stretch's l/100 km weighted by its km, so a 60 km stretch counts twelve times a 5 km one). A segment's cost is
the weighted sum of squares around its weighted mean. The best split of a segment is the one that lowers the
cost the most; it is kept only when

- the gain is larger than the penalty ``PENALTY x sigma2 x log(n)``, where ``sigma2`` is the noise of the whole
  series (robust: from the differences between neighbours, so a step does not inflate it),
- each side holds at least ``min_weight`` (km) and ``min_count`` items,
- the two sides' means differ by at least ``min_step``,

and both sides are split again the same way. Deterministic: ties go to the earliest split. Pure Python, no
random numbers; ``mobile/src/engine/changepoints.ts`` is the same algorithm line for line: change both together.
M68 reuses it for the voltage of the freeze frames."""

import itertools
import math
from dataclasses import dataclass

PENALTY = 7.0  # 1% false change points on a flat series like the sample's; a 0.9 l/100 km step found 99.5% of the time
# the median of a chi-square with one degree of freedom: turns a median of squared normals into a variance
CHI2_MEDIAN = 0.4549364231195724


@dataclass
class Segment:
    start: int  # first index, inclusive
    end: int  # last index, exclusive
    weight: float
    count: int
    mean: float


def _sums(
    values: list[float], weights: list[float]
) -> tuple[list[float], list[float], list[float]]:
    sw, swx, swxx = [0.0], [0.0], [0.0]
    for x, w in zip(values, weights, strict=True):
        sw.append(sw[-1] + w)
        swx.append(swx[-1] + w * x)
        swxx.append(swxx[-1] + w * x * x)
    return sw, swx, swxx


def noise(values: list[float], weights: list[float]) -> float:
    """The variance of one unit of weight, from neighbours: d = x[i] - x[i-1] has variance
    sigma2 x (1/w[i] + 1/w[i-1]); the median of d^2 / (1/w[i] + 1/w[i-1]) over CHI2_MEDIAN estimates sigma2."""
    ratios = sorted(
        (values[i] - values[i - 1]) ** 2 / (1 / weights[i] + 1 / weights[i - 1])
        for i in range(1, len(values))
    )
    if not ratios:
        return 0.0
    mid = len(ratios) // 2
    median = ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2
    return median / CHI2_MEDIAN


def segment(
    values: list[float],
    weights: list[float],
    min_weight: float,
    min_count: int,
    min_step: float,
) -> list[Segment]:
    """The series cut into segments of constant level, in order (one segment when there is no change)."""
    n = len(values)
    if n == 0:
        return []
    sw, swx, swxx = _sums(values, weights)

    def stats(a: int, b: int) -> tuple[float, float, float]:
        w = sw[b] - sw[a]
        m = (swx[b] - swx[a]) / w
        cost = (swxx[b] - swxx[a]) - w * m * m
        return w, m, cost

    penalty = PENALTY * noise(values, weights) * math.log(n)
    cuts: list[int] = []
    todo = [(0, n)]
    while todo:
        a, b = todo.pop()
        _, _, whole = stats(a, b)
        best: tuple[float, int] | None = None
        for k in range(a + min_count, b - min_count + 1):
            wl, ml, cl = stats(a, k)
            wr, mr, cr = stats(k, b)
            if wl < min_weight or wr < min_weight or abs(ml - mr) < min_step:
                continue
            gain = whole - cl - cr
            if best is None or gain > best[0]:
                best = (gain, k)
        if best is not None and best[0] > penalty:
            cuts.append(best[1])
            todo += [(a, best[1]), (best[1], b)]
    bounds = [0, *sorted(cuts), n]
    out = []
    for a, b in itertools.pairwise(bounds):
        w, m, _ = stats(a, b)
        out.append(Segment(a, b, w, b - a, m))
    return out
