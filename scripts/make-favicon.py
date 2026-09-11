# Generate favicon.ico (16+32 in one file) dan apple-touch-icon (180x180)
# dari icon-192.png. Pure-stdlib PNG parser/writer, tanpa library eksternal.
# Dipanggil sekali; hasilnya di-commit supaya dev & produksi bebas 404.
import struct
import zlib


def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    pos = 8
    w = h = None
    idat = b''
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if tag == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', chunk[:10])
            assert depth == 8 and ctype == 6, 'harus RGBA 8-bit'
        elif tag == b'IDAT':
            idat += chunk
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = w * 4
    rows = []
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        ft = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        if ft == 1:  # sub
            for x in range(4, stride):
                line[x] = (line[x] + line[x - 4]) & 0xFF
        elif ft == 2:  # up
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif ft == 3:  # average
            for x in range(stride):
                a = line[x - 4] if x >= 4 else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif ft == 4:  # paeth
            for x in range(stride):
                a = line[x - 4] if x >= 4 else 0
                b = prev[x]
                c = prev[x - 4] if x >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        rows.append(bytes(line))
        prev = line
    return w, h, rows


def box_resize(rows, w, h, tw, th):
    """Box-downsample RGBA rows ke tw x th (nearest untuk membesar)."""
    out = []
    for y in range(th):
        sy0, sy1 = y * h // th, max(y * h // th + 1, (y + 1) * h // th)
        line = bytearray()
        for x in range(tw):
            sx0, sx1 = x * w // tw, max(x * w // tw + 1, (x + 1) * w // tw)
            r = g = b = a = n = 0
            for sy in range(sy0, min(sy1, h)):
                row = rows[sy]
                for sx in range(sx0, min(sx1, w)):
                    o = sx * 4
                    r += row[o]; g += row[o + 1]; b += row[o + 2]; a += row[o + 3]; n += 1
            line += bytes((r // n, g // n, b // n, a // n))
        out.append(bytes(line))
    return out


def png_chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def encode_png(rows, size):
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    raw = b''.join(b'\x00' + r for r in rows)
    return b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', zlib.compress(raw, 9)) + png_chunk(b'IEND', b'')


def bmp_entry(size, pixels):
    """ICO entry: BMP tanpa file header, top-down, alpha + mask."""
    iw = ih = size
    and_stride = ((iw + 31) // 32) * 4
    header = struct.pack('<IiiHHIIiiII', 40, iw, ih * 2, 1, 32, 0, len(pixels) + and_stride * ih, 0, 0, 0, 0)
    bgr = bytearray()
    mask_row = b'\x00' * and_stride
    for y in range(ih - 1, -1, -1):
        row = pixels[y]
        for x in range(iw):
            o = x * 4
            bgr += bytes((row[o + 2], row[o + 1], row[o], row[o + 3]))
    return header + bytes(bgr) + mask_row * ih


if __name__ == '__main__':
    w, h, rows = read_png('public/icons/icon-192.png')
    small16 = box_resize(rows, w, h, 16, 16)
    small32 = box_resize(rows, w, h, 32, 32)
    touch = box_resize(rows, w, h, 180, 180)

    with open('public/apple-touch-icon.png', 'wb') as f:
        f.write(encode_png(touch, 180))

    # ICO: 1 image dir + entries
    e16, e32 = bmp_entry(16, small16), bmp_entry(32, small32)
    off = 6 + 2 * 16
    d16 = struct.pack('<BBBBHHII', 16, 16, 0, 0, 1, 32, len(e16), off)
    d32 = struct.pack('<BBBBHHII', 32, 32, 0, 0, 1, 32, len(e32), off + len(e16))
    with open('public/favicon.ico', 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, 2) + d16 + d32 + e16 + e32)

    print('wrote public/favicon.ico (16+32) & public/apple-touch-icon.png (180)')
