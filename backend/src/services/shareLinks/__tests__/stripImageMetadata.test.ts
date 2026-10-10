import { describe, expect, it } from "@jest/globals";

import { jpegWithExif } from "../../../routes/__tests__/shareLinkFixtures";
import { stripImageMetadata } from "../stripImageMetadata";

/**
 * A photo leaves through a public link without what the camera wrote into it
 * (forgejo#281, design §2 T9): GPS, time, device, comments — in the header,
 * between progressive scans, or appended after the image (motion photos, gain
 * maps, MPF secondary images). Every fixture is constructed; no real photo.
 *
 * The round trips decode with jpeg-js and pngjs (devDependencies, test-only
 * use) — the stripper itself needs neither.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jpeg = require("jpeg-js") as {
  encode: (img: { data: Buffer; width: number; height: number }, q: number) => { data: Buffer };
  decode: (b: Buffer, o?: { useTArray?: boolean }) => { data: Uint8Array; width: number };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PNG } = require("pngjs") as {
  PNG: {
    sync: {
      write: (img: { width: number; height: number; data: Buffer }) => Buffer;
      read: (b: Buffer) => { data: Buffer; width: number };
    };
  };
};

const latin1 = (b: Buffer | null) => (b ? b.toString("latin1") : "");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const segment = (marker: number, payload: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};
const gpsExif = (secret: string) =>
  segment(
    0xe1,
    Buffer.concat([
      Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\0", "latin1"),
      Buffer.from(secret, "latin1"),
    ])
  );

/** A real 8×8 JPEG, decodable, with a gradient so a wrong copy cannot pass. */
function realJpeg(): Buffer {
  const data = Buffer.alloc(8 * 8 * 4);
  for (let i = 0; i < 64; i++) data.set([i * 4, 255 - i * 4, (i * 7) % 256, 255], i * 4);
  return jpeg.encode({ data, width: 8, height: 8 }, 90).data;
}

/** Inserts `extra` right after SOI. */
const afterSoi = (image: Buffer, ...extra: Buffer[]) =>
  Buffer.concat([image.subarray(0, 2), ...extra, image.subarray(2)]);

describe("stripImageMetadata — JPEG", () => {
  it("drops Exif, IPTC and comments and keeps JFIF first and the picture data", () => {
    const input = jpegWithExif();
    const text = latin1(stripImageMetadata(input, "image/jpeg"));
    for (const secret of ["GPS-SECRET", "IPTC-SECRET", "CAMERA-SERIAL-SECRET", "Photoshop"]) {
      expect(latin1(input)).toContain(secret);
      expect(text).not.toContain(secret);
    }
    expect(text.startsWith("\xff\xd8\xff\xe0")).toBe(true);
    expect(text.endsWith("\x12\x34\x56\x78\xff\xd9")).toBe(true);
  });

  it("keeps the orientation as a minimal Exif block holding nothing else", () => {
    const out = stripImageMetadata(jpegWithExif(), "image/jpeg")!;
    expect(count(latin1(out), "Exif")).toBe(1);
    const at = out.indexOf(Buffer.from("Exif\0\0", "latin1"));
    expect(out.readUInt16BE(at - 2)).toBe(2 + 6 + 8 + 2 + 12 + 4);
    const tiff = out.subarray(at + 6);
    expect(tiff.readUInt16BE(10)).toBe(0x0112);
    expect(tiff.readUInt16BE(18)).toBe(6);
  });

  it("adds no Exif block when the photo is upright", () => {
    const upright = Buffer.from(jpegWithExif());
    const exifAt = upright.indexOf(Buffer.from("Exif\0\0", "latin1"));
    upright.writeUInt16BE(1, exifAt + 6 + 18);
    expect(latin1(stripImageMetadata(upright, "image/jpeg"))).not.toContain("Exif");
  });

  it("drops an appended secondary JPEG with its own GPS Exif, and an MP4 trailer", () => {
    const primary = realJpeg();
    const secondary = afterSoi(realJpeg(), gpsExif("GPS-SECONDARY-52.52N"));
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypmp42MOTION-PHOTO-GPS", "latin1"),
    ]);
    for (const trailer of [secondary, mp4, Buffer.concat([secondary, mp4])]) {
      const input = Buffer.concat([afterSoi(primary, gpsExif("GPS-PRIMARY-48.13N")), trailer]);
      const out = stripImageMetadata(input, "image/jpeg")!;
      const text = latin1(out);
      for (const secret of ["GPS-PRIMARY", "GPS-SECONDARY", "MOTION-PHOTO", "ftyp"]) {
        expect(text).not.toContain(secret);
      }
      expect(count(text, "Exif")).toBe(0);
      expect(count(text, "\xff\xd8")).toBe(1);
      expect(out.equals(stripImageMetadata(primary, "image/jpeg")!)).toBe(true);
    }
  });

  it("round-trips a real JPEG: the stripped file decodes to the same pixels", () => {
    const original = realJpeg();
    const dirty = Buffer.concat([
      afterSoi(original, gpsExif("GPS-SECRET"), segment(0xfe, Buffer.from("COMMENT-SECRET"))),
      Buffer.from("TRAILER-SECRET"),
    ]);
    const out = stripImageMetadata(dirty, "image/jpeg")!;
    expect(latin1(out)).not.toMatch(/SECRET/);
    expect(Buffer.from(jpeg.decode(out, { useTArray: true }).data)).toEqual(
      Buffer.from(jpeg.decode(original, { useTArray: true }).data)
    );
  });

  it("filters between progressive scans and keeps restart markers and stuffed bytes in the scan data", () => {
    const scan1 = Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd1, 0x44]);
    const scan2 = Buffer.from([0x55, 0xff, 0xd2, 0x66, 0xff, 0x00]);
    const sos = segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
    const input = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xdb, Buffer.alloc(65, 1)),
      segment(0xc2, Buffer.from([8, 0, 8, 0, 8, 1, 1, 0x11, 0])), // SOF2, progressive
      segment(0xdd, Buffer.from([0, 4])), // DRI
      segment(0xc4, Buffer.alloc(20, 2)), // DHT
      sos,
      scan1,
      gpsExif("GPS-BETWEEN-SCANS"),
      segment(0xfe, Buffer.from("COMMENT-BETWEEN-SCANS")),
      segment(0xeb, Buffer.from("JUMBF-C2PA-SECRET")),
      segment(0xc4, Buffer.alloc(20, 3)),
      sos,
      scan2,
      Buffer.from([0xff, 0xd9]),
    ]);
    const out = stripImageMetadata(input, "image/jpeg")!;
    const text = latin1(out);
    expect(text).not.toMatch(/BETWEEN-SCANS|JUMBF/);
    expect(count(text, "Exif")).toBe(0);
    // Both scans byte for byte, restart markers and stuffing included.
    expect(out.includes(Buffer.concat([sos, scan1]))).toBe(true);
    expect(out.includes(Buffer.concat([sos, scan2]))).toBe(true);
    expect(text.endsWith("\xff\xd9")).toBe(true);
  });

  it("abstains on a truncated or malformed stream", () => {
    const full = realJpeg();
    for (const cut of [10, 100, full.length - 2, full.length - 1]) {
      expect(stripImageMetadata(full.subarray(0, cut), "image/jpeg")).toBeNull();
    }
    // An EOI before any scan, a second SOI, a segment length past the end.
    expect(stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg")).toBeNull();
    expect(
      stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xd8, 0xff, 0xd9]), "image/jpeg")
    ).toBeNull();
    expect(
      stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 1, 2]), "image/jpeg")
    ).toBeNull();
  });
});

describe("stripImageMetadata — PNG", () => {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data, Buffer.alloc(4)]); // the stripper does not check CRCs
  };
  function realPng(): Buffer {
    const data = Buffer.alloc(4 * 4 * 4);
    for (let i = 0; i < 16; i++) data.set([i * 16, 255 - i * 16, 128, 255], i * 4);
    return PNG.sync.write({ width: 4, height: 4, data });
  }
  /** Inserts chunks before IEND (the last 12 bytes) and appends `trailer`. */
  const dirty = (png: Buffer, chunks: Buffer[], trailer = Buffer.alloc(0)) =>
    Buffer.concat([
      png.subarray(0, png.length - 12),
      ...chunks,
      png.subarray(png.length - 12),
      trailer,
    ]);

  it("keeps only the allow-listed chunks and nothing after IEND, and still decodes", () => {
    const original = realPng();
    const input = dirty(
      original,
      [
        chunk("tEXt", Buffer.from("Author\0PNG-SECRET-AUTHOR", "latin1")),
        chunk("eXIf", Buffer.from("PNG-SECRET-EXIF", "latin1")),
        chunk("iTXt", Buffer.from("XML\0\0\0\0\0PNG-SECRET-XMP", "latin1")),
        chunk("caBX", Buffer.from("PNG-SECRET-C2PA", "latin1")),
        chunk("prVt", Buffer.from("PNG-SECRET-VENDOR", "latin1")),
        chunk("tIME", Buffer.from("PNG-SECRET-TIME", "latin1")),
      ],
      Buffer.from("PNG-SECRET-TRAILER", "latin1")
    );
    const out = stripImageMetadata(input, "image/png")!;
    expect(latin1(out)).not.toContain("PNG-SECRET");
    expect(out.equals(original)).toBe(true); // pngjs writes only allow-listed chunks
    expect(PNG.sync.read(out).data).toEqual(PNG.sync.read(original).data);
  });

  it("abstains on a truncated PNG or one that does not start with IHDR", () => {
    const png = realPng();
    expect(stripImageMetadata(png.subarray(0, png.length - 5), "image/png")).toBeNull();
    const noHeader = Buffer.concat([
      png.subarray(0, 8),
      chunk("tEXt", Buffer.from("x")),
      png.subarray(8),
    ]);
    expect(stripImageMetadata(noHeader, "image/png")).toBeNull();
  });
});

describe("stripImageMetadata — the bytes decide the format", () => {
  it("refuses a type the magic bytes contradict, and any other format", () => {
    const png = PNG.sync.write({ width: 1, height: 1, data: Buffer.alloc(4) });
    expect(stripImageMetadata(jpegWithExif(), "image/png")).toBeNull();
    expect(stripImageMetadata(png, "image/jpeg")).toBeNull();
    expect(stripImageMetadata(jpegWithExif(), "image/webp")).toBeNull();
    expect(stripImageMetadata(jpegWithExif(), "image/heic")).toBeNull();
    expect(stripImageMetadata(Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/jpeg")).toBeNull();
    expect(stripImageMetadata(Buffer.from("not an image"), "image/jpeg")).toBeNull();
  });
});
