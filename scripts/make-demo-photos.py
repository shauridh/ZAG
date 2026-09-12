#!/usr/bin/env python3
"""Regenerate foto menu demo (public/demo/*.svg) — stdlib saja.

Dipakai mode demo supaya kartu foto langsung terlihat tanpa upload manual.
Gaya mengikuti DESIGN.md: kertas hangat + emoji, tanpa dekorasi lain.
Nama file dipasangkan ke seed demo di src/lib/db-demo.ts (DEMO_PHOTOS).
Jalankan: python scripts/make-demo-photos.py
"""
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "demo")

# (nama file, emoji) — pasangan dipakai seed demo di src/lib/db-demo.ts
PHOTOS = [
    ("ayam-dada", "🍗"),
    ("ayam-paha-atas", "🍗"),
    ("ayam-paha-bawah", "🍗"),
    ("ayam-sayap", "🍗"),
    ("ayam-ekor", "🐓"),
    ("nasi-putih", "🍚"),
    ("chicken-katsu", "🍛"),
    ("chicken-roll", "🌯"),
    ("kulit-crispy", "🍗"),
    ("kentang-goreng", "🍟"),
    ("sambal-geprek", "🌶️"),
    ("saos-mentai", "🥫"),
    ("teh-botol", "🥤"),
]

SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F6E7D8"/>
      <stop offset="1" stop-color="#EFD9C4"/>
    </linearGradient>
  </defs>
  <rect width="480" height="480" fill="url(#g)"/>
  <text x="240" y="252" font-size="430" text-anchor="middle" dominant-baseline="central">{emoji}</text>
</svg>
"""


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, emoji in PHOTOS:
        path = os.path.join(OUT_DIR, f"{name}.svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write(SVG.format(emoji=emoji))
        print(f"OK {path}")


if __name__ == "__main__":
    main()
