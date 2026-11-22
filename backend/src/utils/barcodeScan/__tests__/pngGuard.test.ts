import { crc32, deflateSync } from "zlib";
import { PNG } from "pngjs";
import { scanBoardingPassBarcodes } from "..";
import { decodeToGray, ImageRefusedError } from "../pixels";
import { inspectPng } from "../pngGuard";

/**
 * Crafted decompression bombs (security review, 2026-11-22). The first IHDR
 * looked harmless to the earlier check, which read the dimensions at fixed
 * offsets and then let pngjs inflate whatever followed.
 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function ihdr(width: number, height: number, interlace = 0): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 0; // grayscale
  data[12] = interlace;
  return chunk("IHDR", data);
}

/** A grayscale PNG: `rows` of `width` zero pixels, each with filter byte 0. */
function png(header: Buffer[], width: number, rows: number): Buffer {
  const raw = Buffer.alloc(rows * (width + 1));
  return Buffer.concat([
    SIGNATURE,
    ...header,
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CAP = 40_000_000;

describe("PNG decompression bombs are refused before decoding", () => {
  it("decodes an honest small PNG", () => {
    const honest = png([ihdr(10, 10)], 10, 10);
    expect(inspectPng(honest, CAP)).toEqual({ ok: true, width: 10, height: 10 });
    expect(decodeToGray(honest)).toMatchObject({ width: 10, height: 10 });
  });

  it("refuses a second IHDR that announces a huge image", () => {
    const bomb = png([ihdr(10, 10), ihdr(30_000, 30_000)], 10, 10);
    expect(() => decodeToGray(bomb)).toThrow(ImageRefusedError);
  });

  it("refuses a header that lies about the pixel data (10x10 announced, 4 MB inflated)", () => {
    const bomb = png([ihdr(10, 10)], 2000, 2000);
    expect(inspectPng(bomb, CAP)).toMatchObject({ ok: false });
    expect(() => decodeToGray(bomb)).toThrow(ImageRefusedError);
  });

  it("refuses an interlaced PNG", () => {
    expect(() => decodeToGray(png([ihdr(10, 10, 1)], 10, 10))).toThrow(ImageRefusedError);
  });

  it("refuses a header over the pixel cap", () => {
    expect(() => decodeToGray(png([ihdr(100_000, 100_000)], 10, 10))).toThrow(ImageRefusedError);
  });

  it("reports a refused image as such and never hands it to zxing", async () => {
    const scan = await scanBoardingPassBarcodes(png([ihdr(10, 10), ihdr(30_000, 30_000)], 10, 10));
    expect(scan).toMatchObject({ refused: true, codes: [], attempts: 0 });
  });

  it("still decodes a pngjs-written image", () => {
    const written = PNG.sync.write(new PNG({ width: 4, height: 3 }));
    expect(decodeToGray(written)).toMatchObject({ width: 4, height: 3 });
  });
});
