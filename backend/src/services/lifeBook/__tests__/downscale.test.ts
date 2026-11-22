import jpeg from "jpeg-js";
import zlib from "zlib";
import { PNG } from "pngjs";

import fs from "fs";
import os from "os";
import path from "path";

import { downscaleToJpeg, setDownscaleTimeoutForTests, shutdownDownscalePool } from "../downscale";
import { PhotoLoader } from "../images";

function jpegOf(width: number, height: number, rgb: [number, number, number]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 90).data);
}

/** Inserts an EXIF APP1 segment carrying one orientation tag right after SOI. */
function withOrientation(file: Buffer, orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const seg = Buffer.alloc(4);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([file.subarray(0, 2), seg, body, file.subarray(2)]);
}

const dims = (b: Buffer) => {
  const d = jpeg.decode(b, { useTArray: true });
  return { w: d.width, h: d.height };
};

afterAll(() => shutdownDownscalePool());

describe("life book photo downscaling", () => {
  it("shrinks a large JPEG to the longest edge and never enlarges a small one", async () => {
    const big = await downscaleToJpeg(jpegOf(1800, 1200, [200, 30, 30]), "image/jpeg", 900)!;
    expect(dims(big.data)).toEqual({ w: 900, h: 600 });
    expect(big.data.length).toBeLessThan(jpegOf(1800, 1200, [200, 30, 30]).length * 2);
    const small = await downscaleToJpeg(jpegOf(300, 200, [1, 2, 3]), "image/jpeg", 900)!;
    expect(dims(small.data)).toEqual({ w: 300, h: 200 });
  });

  it("turns a phone portrait (EXIF 6) upright instead of embedding it sideways", async () => {
    const sideways = withOrientation(jpegOf(400, 200, [10, 200, 10]), 6);
    const out = await downscaleToJpeg(sideways, "image/jpeg", 900)!;
    expect(dims(out.data)).toEqual({ w: 200, h: 400 });
  });

  it("reads a PNG with the built-in decoder and puts transparency on white", async () => {
    const png = new PNG({ width: 4, height: 2 });
    for (let i = 0; i < 8; i++) {
      png.data[i * 4] = 0;
      png.data[i * 4 + 1] = 0;
      png.data[i * 4 + 2] = 0;
      png.data[i * 4 + 3] = i < 4 ? 255 : 0;
    }
    const out = await downscaleToJpeg(PNG.sync.write(png), "image/png", 900)!;
    const decoded = jpeg.decode(out.data, { useTArray: true });
    expect(decoded.data[0]).toBeLessThan(40); // opaque black stays black
    expect(decoded.data[4 * 4]).toBeGreaterThan(215); // transparent row is white
  });

  it("returns null for bytes that are no readable image, so the caller can count a skipped photo", async () => {
    expect(await downscaleToJpeg(Buffer.from("not an image"), "image/jpeg", 900)).toBeNull();
    expect(await downscaleToJpeg(Buffer.alloc(0), "image/png", 900)).toBeNull();
    expect(await downscaleToJpeg(Buffer.from("GIF89a....."), "image/gif", 900)).toBeNull();
  });

  it("refuses a PNG whose data inflates far past what its header promises instead of allocating it", async () => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, "latin1");
      return Buffer.concat([head, body, Buffer.alloc(4)]); // CRC is not checked by the reader
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(10, 0);
    ihdr.writeUInt32BE(10, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const bomb = zlib.deflateSync(Buffer.alloc(64 * 1024 * 1024)); // header says 10x10 RGBA = 410 bytes
    const png = Buffer.concat([
      sig,
      chunk("IHDR", ihdr),
      chunk("IDAT", bomb),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(await downscaleToJpeg(png, "image/png", 900)).toBeNull();
  });

  it("keeps a PNG's tRNS transparency (grey with a transparent sample) as white", async () => {
    // 8-bit grey PNG, 2x1: sample 0 (black, declared transparent by tRNS) and 255 (white)
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, "latin1");
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), body])));
      return Buffer.concat([head, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    const trns = Buffer.alloc(2);
    trns.writeUInt16BE(0, 0);
    const idat = zlib.deflateSync(Buffer.from([0, 0, 255]));
    const png = Buffer.concat([
      sig,
      chunk("IHDR", ihdr),
      chunk("tRNS", trns),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const out = await downscaleToJpeg(png, "image/png", 900);
    expect(out).not.toBeNull();
    const px = jpeg.decode(out!.data, { useTArray: true }).data;
    expect(px[0]).toBeGreaterThan(215); // the transparent "black" sample is white, not black
  });

  describe("deadline", () => {
    afterEach(() => setDownscaleTimeoutForTests(null));

    it("times out a slow image, counts the photo as skipped, and the pool keeps working", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-img-"));
      fs.writeFileSync(path.join(dir, "big.jpg"), jpegOf(3000, 2000, [5, 6, 7]));
      try {
        setDownscaleTimeoutForTests(1);
        const loader = new PhotoLoader("u");
        expect(await loader.fromDisk(dir, "big.jpg", "image/jpeg")).toBeNull();
        expect(loader.skipped).toBe(1);
        setDownscaleTimeoutForTests(null);
        expect(await loader.fromDisk(dir, "big.jpg", "image/jpeg")).toMatch(
          /^data:image\/jpeg;base64,/
        );
        expect(loader.skipped).toBe(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("refuses a PNG that declares a huge canvas before decoding a pixel", async () => {
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdrBody = Buffer.alloc(13);
      ihdrBody.writeUInt32BE(20000, 0);
      ihdrBody.writeUInt32BE(20000, 4);
      ihdrBody[8] = 8;
      ihdrBody[9] = 6;
      const head = Buffer.alloc(8);
      head.writeUInt32BE(13, 0);
      head.write("IHDR", 4, "latin1");
      const png = Buffer.concat([sig, head, ihdrBody, Buffer.alloc(4)]);
      expect(await downscaleToJpeg(png, "image/png", 900)).toBeNull();
    });
  });
});
