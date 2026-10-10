import { describe, expect, it } from "@jest/globals";

import { jpegWithExif } from "../../../routes/__tests__/shareLinkFixtures";
import { stripImageMetadata } from "../stripImageMetadata";

/**
 * A photo leaves through a public link without what the camera wrote into it
 * (forgejo#281, design §2 T9): GPS, time, device, comments.
 */
describe("stripImageMetadata", () => {
  const latin1 = (b: Buffer | null) => (b ? b.toString("latin1") : "");

  it("drops Exif, IPTC and comments from a JPEG and keeps the picture data", () => {
    const input = jpegWithExif();
    const out = stripImageMetadata(input, "image/jpeg");
    expect(out).not.toBeNull();
    const text = latin1(out);
    for (const secret of ["GPS-SECRET", "IPTC-SECRET", "CAMERA-SERIAL-SECRET", "Photoshop"]) {
      expect(latin1(input)).toContain(secret);
      expect(text).not.toContain(secret);
    }
    // JFIF stays first, the scan and its data are copied byte for byte.
    expect(text.startsWith("\xff\xd8\xff\xe0")).toBe(true);
    expect(text.endsWith("\x12\x34\x56\x78\xff\xd9")).toBe(true);
  });

  it("keeps the orientation as a minimal Exif block holding nothing else", () => {
    const out = stripImageMetadata(jpegWithExif(), "image/jpeg")!;
    const at = out.indexOf(Buffer.from("Exif\0\0", "latin1"));
    expect(at).toBeGreaterThan(0);
    const length = out.readUInt16BE(at - 2);
    // 2 length bytes + "Exif\0\0" + 8-byte TIFF header + 1-entry IFD + next pointer.
    expect(length).toBe(2 + 6 + 8 + 2 + 12 + 4);
    const tiff = out.subarray(at + 6);
    expect(tiff.readUInt16BE(10)).toBe(0x0112);
    expect(tiff.readUInt16BE(18)).toBe(6);
  });

  it("adds no Exif block when the photo has no orientation to keep", () => {
    const input = jpegWithExif();
    // Orientation 1 is upright: nothing to carry over.
    const upright = Buffer.from(input);
    const exifAt = upright.indexOf(Buffer.from("Exif\0\0", "latin1"));
    upright.writeUInt16BE(1, exifAt + 6 + 18);
    expect(latin1(stripImageMetadata(upright, "image/jpeg"))).not.toContain("Exif");
  });

  it("drops a PNG's text, eXIf and time chunks", () => {
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "latin1");
      return Buffer.concat([head, data, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", Buffer.alloc(13)),
      chunk("tEXt", Buffer.from("Author\0PNG-SECRET-AUTHOR", "latin1")),
      chunk("eXIf", Buffer.from("PNG-SECRET-EXIF", "latin1")),
      chunk("iTXt", Buffer.from("XML\0\0\0\0\0PNG-SECRET-XMP", "latin1")),
      chunk("IDAT", Buffer.from([1, 2, 3])),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const out = latin1(stripImageMetadata(png, "image/png"));
    expect(out).toContain("IHDR");
    expect(out).toContain("IDAT");
    expect(out).toContain("IEND");
    expect(out).not.toContain("PNG-SECRET");
  });

  it("abstains on a type it cannot clean, and on a broken file", () => {
    expect(stripImageMetadata(jpegWithExif(), "image/webp")).toBeNull();
    expect(stripImageMetadata(jpegWithExif(), "image/heic")).toBeNull();
    expect(stripImageMetadata(Buffer.from("not an image"), "image/jpeg")).toBeNull();
    expect(stripImageMetadata(jpegWithExif().subarray(0, 30), "image/jpeg")).toBeNull();
    expect(stripImageMetadata(Buffer.from("not a png at all"), "image/png")).toBeNull();
  });
});
