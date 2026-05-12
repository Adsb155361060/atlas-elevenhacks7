#!/usr/bin/env python3
"""
Generate placeholder Atlas icons.

Produces minimal valid 8-bit RGBA PNGs at the sizes Tauri 2 expects, plus
tray-state icons in five colors. Uses only the Python standard library
(struct + zlib) so it runs anywhere without PIL / ImageMagick.

These are *placeholder* assets. Real branding lands at Phase 17 once we
pick a public name and brand identity.

Usage:
    python3 scripts/gen-icons.py
        → writes to apps/desktop/src-tauri/icons/

Outputs:
    icons/icon.png            (1024x1024, source)
    icons/32x32.png
    icons/128x128.png
    icons/128x128@2x.png      (256x256)
    icons/tray-idle.png       (32x32, slate)
    icons/tray-listening.png  (32x32, emerald, with breathing ring)
    icons/tray-thinking.png   (32x32, amber)
    icons/tray-speaking.png   (32x32, violet)
    icons/tray-paused.png     (32x32, dim slate)
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# ──────────────────────────── PNG primitives ────────────────────────────


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png_rgba(path: Path, pixels: bytes, width: int, height: int) -> None:
    """Write an 8-bit RGBA PNG.

    `pixels` must be exactly `width * height * 4` bytes.
    """
    expected = width * height * 4
    if len(pixels) != expected:
        raise ValueError(
            f"pixels length {len(pixels)} != expected {expected} for {width}x{height} RGBA"
        )

    # Add filter-type byte (0 = None) at the start of each scanline.
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])

    compressed = zlib.compress(bytes(raw), 9)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(
        ">IIBBBBB",
        width,
        height,
        8,  # bit depth
        6,  # color type (RGBA)
        0,  # compression
        0,  # filter
        0,  # interlace
    )

    data = signature + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", compressed) + _chunk(b"IEND", b"")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


# ──────────────────────────── drawing helpers ────────────────────────────


def _blend(base: tuple[int, int, int, int], over: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Source-over alpha blend, integer math, output premultiplied=no."""
    sr, sg, sb, sa = over
    br, bg, bb, ba = base
    sa_f = sa / 255.0
    inv = 1.0 - sa_f
    out_a = sa + int(ba * inv)
    if out_a == 0:
        return 0, 0, 0, 0
    out_r = int(sr * sa_f + br * inv)
    out_g = int(sg * sa_f + bg * inv)
    out_b = int(sb * sa_f + bb * inv)
    return out_r, out_g, out_b, out_a


def render_disc(
    size: int,
    fill: tuple[int, int, int],
    ring: tuple[int, int, int, int] | None = None,
    background: tuple[int, int, int, int] = (0, 0, 0, 0),
    inset: float = 0.18,
) -> bytes:
    """Render a centered disc on a transparent background.

    fill: solid-color RGB of the disc
    ring: optional ring color (rgba) around the disc
    inset: padding from edges, as a fraction of `size`
    """
    cx = (size - 1) / 2.0
    cy = (size - 1) / 2.0
    radius = (size / 2.0) * (1.0 - inset)
    ring_outer = radius + max(1.0, size * 0.04)

    pixels = bytearray(size * size * 4)
    fr, fg, fb = fill
    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            d = (dx * dx + dy * dy) ** 0.5
            base = background

            if ring is not None and radius < d <= ring_outer:
                # Smooth-ish ring with simple edge alpha.
                edge = min(1.0, ring_outer - d)
                rgba = (ring[0], ring[1], ring[2], int(ring[3] * edge))
                base = _blend(base, rgba)

            if d <= radius:
                # Filled disc with 1-pixel edge soften
                soft = min(1.0, radius - d)
                a = int(255 * soft)
                rgba = (fr, fg, fb, a)
                base = _blend(base, rgba)

            r, g, b, a = base
            o = (y * size + x) * 4
            pixels[o] = r
            pixels[o + 1] = g
            pixels[o + 2] = b
            pixels[o + 3] = a
    return bytes(pixels)


# ──────────────────────────── palette ────────────────────────────

# Slate (idle / paused), emerald (listening), amber (thinking), violet (speaking).
PALETTE = {
    "idle": (71, 85, 105),  # slate-600
    "listening": (16, 185, 129),  # emerald-500
    "thinking": (245, 158, 11),  # amber-500
    "speaking": (168, 85, 247),  # violet-500
    "paused": (51, 65, 85),  # slate-700
}


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    icons = repo_root / "apps" / "desktop" / "src-tauri" / "icons"
    icons.mkdir(parents=True, exist_ok=True)

    # ──── App icon (source + Tauri-expected sizes) ────
    # Source 1024x1024 — emerald disc on transparent, slate ring.
    src_size = 1024
    src_pixels = render_disc(
        src_size,
        fill=PALETTE["listening"],
        ring=(148, 163, 184, 90),
        inset=0.16,
    )
    write_png_rgba(icons / "icon.png", src_pixels, src_size, src_size)

    for size_name, dim in (
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
    ):
        pixels = render_disc(
            dim,
            fill=PALETTE["listening"],
            ring=(148, 163, 184, 90),
            inset=0.18,
        )
        write_png_rgba(icons / size_name, pixels, dim, dim)

    # ──── Tray state icons (32x32) ────
    tray_size = 32
    for label, color in PALETTE.items():
        pixels = render_disc(
            tray_size,
            fill=color,
            ring=None,
            inset=0.22,
        )
        write_png_rgba(icons / f"tray-{label}.png", pixels, tray_size, tray_size)

    # Verify each output is a non-empty file
    for f in sorted(icons.glob("*.png")):
        size = f.stat().st_size
        print(f"  {f.name:<24} {size:>6} bytes")


if __name__ == "__main__":
    main()
