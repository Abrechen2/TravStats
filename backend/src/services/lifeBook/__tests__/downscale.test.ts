import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { downscaleToJpeg, exifOrientation } from "../downscale";

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

describe("life book photo downscaling", () => {
  it("shrinks a large JPEG to the longest edge and never enlarges a small one", () => {
    const big = downscaleToJpeg(jpegOf(1800, 1200, [200, 30, 30]), "image/jpeg", 900)!;
    expect(dims(big.data)).toEqual({ w: 900, h: 600 });
    expect(big.data.length).toBeLessThan(jpegOf(1800, 1200, [200, 30, 30]).length * 2);
    const small = downscaleToJpeg(jpegOf(300, 200, [1, 2, 3]), "image/jpeg", 900)!;
    expect(dims(small.data)).toEqual({ w: 300, h: 200 });
  });

  it("turns a phone portrait (EXIF 6) upright instead of embedding it sideways", () => {
    const sideways = withOrientation(jpegOf(400, 200, [10, 200, 10]), 6);
    expect(exifOrientation(sideways)).toBe(6);
    const out = downscaleToJpeg(sideways, "image/jpeg", 900)!;
    expect(dims(out.data)).toEqual({ w: 200, h: 400 });
  });

  it("reads a PNG with the built-in decoder and puts transparency on white", () => {
    const png = new PNG({ width: 4, height: 2 });
    for (let i = 0; i < 8; i++) {
      png.data[i * 4] = 0;
      png.data[i * 4 + 1] = 0;
      png.data[i * 4 + 2] = 0;
      png.data[i * 4 + 3] = i < 4 ? 255 : 0;
    }
    const out = downscaleToJpeg(PNG.sync.write(png), "image/png", 900)!;
    const decoded = jpeg.decode(out.data, { useTArray: true });
    expect(decoded.data[0]).toBeLessThan(40); // opaque black stays black
    expect(decoded.data[4 * 4]).toBeGreaterThan(215); // transparent row is white
  });

  it("returns null for bytes that are no readable image, so the caller can count a skipped photo", () => {
    expect(downscaleToJpeg(Buffer.from("not an image"), "image/jpeg", 900)).toBeNull();
    expect(downscaleToJpeg(Buffer.alloc(0), "image/png", 900)).toBeNull();
    expect(downscaleToJpeg(Buffer.from("GIF89a....."), "image/gif", 900)).toBeNull();
  });
});
