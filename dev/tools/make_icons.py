#!/usr/bin/env python3
"""
Builds the app icons, Python 3 only: python3 dev/tools/make_icons.py
  icon_front_8x8.png    a chunky green K, in the spirit of the Kickstarter mark
  icon_back_11x11.png   the same K in the single grey (#888888) the back screen expects
"""
import struct, zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "src" / "appmeta"
GREEN, GREY = (5, 206, 120), (136, 136, 136)

FRONT = [
    "###..###",
    "###.###.",
    "######..",
    "#####...",
    "#####...",
    "######..",
    "###.###.",
    "###..###",
]
BACK = [
    "####...####",
    "####..####.",
    "####.####..",
    "########...",
    "#######....",
    "######.....",
    "#######....",
    "########...",
    "####.####..",
    "####..####.",
    "####...####",
]


def png(rows, color, name):
    w, h = len(rows[0]), len(rows)
    raw = b"".join(b"\0" + b"".join(bytes((*color, 255)) if c == "#" else b"\0\0\0\0" for c in r) for r in rows)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    (OUT / name).write_bytes(data)


png(FRONT, GREEN, "icon_front_8x8.png")
png(BACK, GREY, "icon_back_11x11.png")
