# Generate PWA icons for Sabana Kasir without any external library.
# Pure-stdlib PNG writer: struct + zlib only. Design: golden drumstick
# on Ferrari-red square (maskable-safe, artwork within the 80% zone).
import math
import struct
import zlib

RED = (225, 27, 34)        # #E11B22
RED_DARK = (183, 16, 24)   # rim
MEAT = (242, 169, 59)      # #F2A93B
MEAT_DARK = (216, 138, 31)
MEAT_LIGHT = (250, 199, 109)
BONE = (255, 243, 224)     # #FFF3E0


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack('>I', len(data))
        + tag
        + data
        + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def in_ellipse(u: float, v: float, cx: float, cy: float, rx: float, ry: float) -> float:
    """Return < 1 inside the ellipse; the value doubles as a soft edge metric."""
    return ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2


def in_disc(u: float, v: float, cx: float, cy: float, r: float) -> float:
    return math.hypot(u - cx, v - cy) / r


def pixel(u: float, v: float) -> tuple[int, int, int, int]:
    """Design space 512x512 -> RGBA."""
    # Drumstick artwork, vertical, centered (safe zone for maskable icons).
    meat = in_ellipse(u, v, 256, 218, 112, 128)
    meat_rim = in_ellipse(u, v, 256, 218, 126, 142)
    shaft = 234 <= u <= 278 and 292 <= v <= 376
    knob1 = in_disc(u, v, 229, 382, 36)
    knob2 = in_disc(u, v, 283, 382, 36)
    bone = shaft or knob1 < 1 or knob2 < 1

    if meat <= 1.0:
        # simple top-left lighting: lighter where up-left of center
        hi = in_ellipse(u, v, 218, 172, 62, 74)
        if hi <= 1.0:
            return (*MEAT_LIGHT, 255)
        return (*MEAT, 255)
    if meat_rim <= 1.06:
        return (*MEAT_DARK, 255)
    if bone:
        return (*BONE, 255)
    # background: red square with a darker inner ring near the edge
    edge = min(u, v, 512 - u, 512 - v)
    if edge <= 10:
        return (*RED_DARK, 255)
    return (*RED, 255)


def render(size: int) -> bytes:
    """Render at 2x and box-downsample for cheap anti-aliasing."""
    ss = size * 2
    rows: list[list[tuple[int, int, int, int]]] = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0
            for dy in (0.25, 0.75):
                for dx in (0.25, 0.75):
                    u = (x + dx) * 512 / ss
                    v = (y + dy) * 512 / ss
                    pr, pg, pb, pa = pixel(u, v)
                    r += pr
                    g += pg
                    b += pb
                    a += pa
            row.append((r // 4, g // 4, b // 4, a // 4))
        rows.append(row)

    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0 per scanline
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + png_chunk(b'IHDR', ihdr)
        + png_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + png_chunk(b'IEND', b'')
    )


TARGETS = {
    'public/icons/icon-192.png': 192,
    'public/icons/icon-512.png': 512,
    'public/icons/icon-maskable-512.png': 512,
    'public/favicon.png': 64,
}

if __name__ == '__main__':
    import os

    for path, size in TARGETS.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(render(size))
        print(f'wrote {path} ({size}x{size})')
