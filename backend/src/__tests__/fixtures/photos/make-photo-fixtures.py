"""Regenerates the synthetic photo fixtures in this directory (forgejo#192).

Nothing here is a photograph: each image is a computed gradient with a white
square. The EXIF is made up too — a capture time, and the position of the
Eiffel Tower, a public landmark. No camera, no person, no private place.

    python3 -m venv /tmp/fixture-venv
    /tmp/fixture-venv/bin/pip install pillow pillow-heif piexif
    /tmp/fixture-venv/bin/python make-photo-fixtures.py

pillow-heif 1.8.0 bundles libheif 1.23.4 with the x265 encoder, so
`synthetic-exif.heic` is a real HEVC-coded HEIC — the codec an iPhone writes,
and the one prebuilt sharp/libvips cannot decode. Generated 2026-10-04.
"""
import os

import piexif
import pillow_heif
from PIL import Image, ImageDraw

pillow_heif.register_heif_opener()
HERE = os.path.dirname(os.path.abspath(__file__))
LAT, LON = 48.858222, 2.2945


def picture(w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (int(255 * x / (w - 1)), int(255 * y / (h - 1)), 128)
    ImageDraw.Draw(img).rectangle([w // 4, h // 4, w // 2, h // 2], fill=(255, 255, 255))
    return img


def dms(v):
    v = abs(v)
    deg = int(v)
    m = int((v - deg) * 60)
    s = round(((v - deg) * 60 - m) * 60 * 100)
    return ((deg, 1), (m, 1), (s, 100))


def exif(with_offset):
    tags = {piexif.ExifIFD.DateTimeOriginal: b"2024:05:17 14:23:45"}
    if with_offset:
        tags[piexif.ExifIFD.OffsetTimeOriginal] = b"+02:00"
    return piexif.dump(
        {
            "0th": {piexif.ImageIFD.Make: b"TravStats", piexif.ImageIFD.Model: b"synthetic-fixture"},
            "Exif": tags,
            "GPS": {
                piexif.GPSIFD.GPSLatitudeRef: b"N",
                piexif.GPSIFD.GPSLatitude: dms(LAT),
                piexif.GPSIFD.GPSLongitudeRef: b"E",
                piexif.GPSIFD.GPSLongitude: dms(LON),
            },
        }
    )


# 64x48 HEIC, capture time WITH its offset: 14:23:45+02:00 = 12:23:45Z.
picture(64, 48).save(os.path.join(HERE, "synthetic-exif.heic"), format="HEIF", quality=60, exif=exif(True))
# 64x48 JPEG, capture time WITHOUT an offset: placed by the zone of its GPS position.
picture(64, 48).save(os.path.join(HERE, "synthetic-exif-no-offset.jpg"), format="JPEG", quality=80, exif=exif(False))
