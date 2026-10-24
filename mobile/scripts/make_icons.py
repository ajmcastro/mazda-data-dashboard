"""Draws the app icons (the dashboard logo: red gauge arc, needle, hub on graphite). No dependencies.

    python3 scripts/make_icons.py        # writes public/icon-{180,192,512}.png and icon-maskable-512.png

The logo box (32 x 32, same as the favicon) is scaled into the middle 62 % so a round or rounded-square
mask never cuts it.
"""

import math
import struct
import zlib
from pathlib import Path

BG = (13, 14, 16)
RED = (224, 53, 69)
TEXT = (233, 230, 223)
SS = 3  # supersampling per axis


def png(size: int, pixels: list[list[tuple[int, int, int]]]) -> bytes:
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def dist_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def shade(x: float, y: float) -> tuple[int, int, int]:
    """Colour at a point of the 32 x 32 logo box."""
    r = math.hypot(x - 16, y - 23)
    if r <= 2.2:
        return TEXT
    if dist_to_segment(x, y, 16, 23, 21.5, 14) <= 1.25:
        return TEXT
    # arc: upper half of a circle of radius 11 around (16, 23), stroke 3 wide, round caps
    if y <= 23 and abs(r - 11) <= 1.5:
        return RED
    for cx in (5, 27):
        if math.hypot(x - cx, y - 23) <= 1.5:
            return RED
    return BG


def icon(size: int, fill: float) -> bytes:
    k = size * fill / 32
    ox, oy = size / 2 - 16 * k, size / 2 - 18 * k
    rows = []
    for j in range(size):
        row = []
        for i in range(size):
            acc = [0, 0, 0]
            for sj in range(SS):
                for si in range(SS):
                    x = (i + (si + 0.5) / SS - ox) / k
                    y = (j + (sj + 0.5) / SS - oy) / k
                    c = shade(x, y)
                    for n in range(3):
                        acc[n] += c[n]
            row.append(tuple(round(v / SS**2) for v in acc))
        rows.append(row)
    return png(size, rows)


out = Path(__file__).resolve().parent.parent / "public"
for size in (180, 192, 512):
    (out / f"icon-{size}.png").write_bytes(icon(size, 0.62))
(out / "icon-maskable-512.png").write_bytes(icon(512, 0.5))  # full-bleed background, logo well inside the safe zone
print("icons written to", out)
