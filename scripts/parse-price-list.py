# Parser "Price List Sabana Sharing Mitra.pdf" -> price-list.json (format import_price_list).
# Jalankan: .freebuff/pdfenv/Scripts/python.exe scripts/parse-price-list.py
import json
import re
from pathlib import Path

import pdfplumber

# PDF ada di folder induk repo sabana-kasir
PDF = Path(__file__).resolve().parents[2] / "Price List Sabana Sharing Mitra.pdf"

UNIT_WORDS = r"(Pack|Pouch|Pcs|Karung|Kg|Liter|Gram|Botol|Dus|Gelas)"
SATUAN_RE = re.compile(rf"\s1\s+{UNIT_WORDS}\b")

items = []
problems = []

with pdfplumber.open(str(PDF)) as pdf:
    lines = []
    for page in pdf.pages:
        text = page.extract_text() or ""
        for raw in text.splitlines():
            raw = raw.strip()
            if not raw or raw.startswith("SABANA PRICE LIST") or raw.startswith("NO KODE"):
                continue
            lines.append(raw)

for ln in lines:
    m = re.match(r"^(\d{1,3})\s+(\d{4,8})\s+(.+)$", ln)
    if not m:
        if re.match(r"^\d{1,3}\s", ln):
            problems.append(f"format aneh: {ln!r}")
        continue
    no, code, rest = m.group(1), m.group(2), m.group(3)

    # harga di ujung: "Rp 48,000" (boleh kosong)
    pm = re.search(r"\bRp\s*([\d.,]*)\s*$", rest)
    if not pm:
        problems.append(f"tanpa harga: {ln!r}")
        continue
    digits = re.sub(r"\D", "", pm.group(1) or "")
    pack_price = int(digits) if digits else 0
    body = rest[: pm.start()].strip()

    # pisahkan NAMA | SATUAN("1 Pack") | ISI
    sm = SATUAN_RE.search(" " + body + " ")
    if not sm:
        problems.append(f"satuan tak terbaca: {ln!r}")
        continue
    name = body[: sm.start() - 1 + 1 - 1].strip() if sm.start() > 0 else body.strip()
    name = body[: sm.start()].strip()
    tail = body[sm.start() :].strip()
    tu = tail.split(None, 2)  # "1 Pack <ISI...>"
    satuan = f"{tu[0]} {tu[1]}" if len(tu) >= 2 else tail
    isi = tail[len(satuan) :].strip()

    # ISI -> pack_content + small_unit
    im = re.match(r"^([\d.,]+)\s*([A-Za-z/ ]*)", isi or "")
    if im:
        content_txt = im.group(1).replace(",", ".")
        try:
            pack_content = float(content_txt)
        except ValueError:
            pack_content = 1.0
        small = (im.group(2) or "").strip().lower() or None
    else:
        pack_content, small = 1.0, None
    if small:
        # "pcs/" (dari "30 Pcs/ 60 Pcs") -> "pcs"; ambil kata pertama bersih
        small = re.split(r"[^a-z]+", small)[0] if re.match(r"[a-z]", small) else small.split()[0]

    items.append({
        "code": code,
        "name": name.title(),
        "buy_unit": tu[1].lower() if len(tu) >= 2 else "pack",
        "pack_content": pack_content,
        "pack_price": pack_price,
        "small_unit": small or "",
    })

# dedupe per nama (price list memuat item sama dengan kode berbeda)
seen = {}
deduped, dropped = [], []
for it in items:
    key = it["name"].lower()
    if key in seen:
        dropped.append(f"{it['code']} {it['name']} (duplikat dgn {seen[key]})")
        continue
    seen[key] = it["code"]
    deduped.append(it)

zero = [it for it in deduped if it["pack_price"] == 0]

with open(Path(__file__).resolve().parents[1] / "price-list.json", "w", encoding="utf-8") as f:
    json.dump(deduped, f, ensure_ascii=False, indent=1)

print(f"baris PDF terbaca : {len(items)}")
print(f"unik (diimpor)    : {len(deduped)}")
print(f"duplikat dilewati : {len(dropped)}")
for d in dropped:
    print(f"  - {d}")
print(f"harga kosong      : {len(zero)}")
for it in zero:
    print(f"  - {it['code']} {it['name']}")
if problems:
    print(f"masalah parse     : {len(problems)}")
    for p in problems:
        print(f"  ! {p}")
print("\nContoh 5 item pertama:")
for it in deduped[:5]:
    print(" ", it)
