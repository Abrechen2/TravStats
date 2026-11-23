import { PNG } from "pngjs";
import { readBarcodes } from "zxing-wasm/reader";
import { scanBoardingPassBarcodes, variantsOf, REGION_MAX_PIXELS } from "..";
import type { Gray } from "../pixels";

/**
 * The barcode scan bounds its work (security review of the boarding-pass reader): zxing never
 * receives bytes no bounded decoder checked, and the region search stops at its time budget
 * before it builds the next variant, not only before decoding it.
 */
jest.mock("zxing-wasm/reader", () => {
  const actual = jest.requireActual("zxing-wasm/reader");
  return { ...actual, readBarcodes: jest.fn(actual.readBarcodes) };
});
const mockedRead = readBarcodes as jest.Mock;

/** A minimal GIF with a logical screen and one frame of the given size. */
function gif(screen: number, frame: number): Buffer {
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "latin1");
  header.writeUInt16LE(screen, 6);
  header.writeUInt16LE(screen, 8);
  const descriptor = Buffer.alloc(10);
  descriptor[0] = 0x2c;
  descriptor.writeUInt16LE(frame, 5);
  descriptor.writeUInt16LE(frame, 7);
  return Buffer.concat([header, descriptor, Buffer.from([2, 1, 0, 0, 0x3b])]);
}

/** A textured photo with dark blocks, so the region finder has something to try. */
function blocky(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const ink = x % 6 < 3 && y % 40 < 30 && x > width / 2;
      png.data[p] = png.data[p + 1] = png.data[p + 2] = ink ? 20 : 240;
      png.data[p + 3] = 255;
    }
  }
  return PNG.sync.write(png, { deflateLevel: 0, filterType: 0 });
}

beforeEach(() => mockedRead.mockClear());

describe("scanBoardingPassBarcodes — bounded input", () => {
  it("refuses bytes of no accepted format without handing them to zxing", async () => {
    const scan = await scanBoardingPassBarcodes(Buffer.from("not an image at all, just text"));
    expect(scan.refused).toBe(true);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("refuses a JPEG that fails the bounded decode instead of giving zxing the raw bytes", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const scan = await scanBoardingPassBarcodes(broken);
    expect(scan.refused).toBe(true);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("refuses a GIF whose frame is over the pixel cap", async () => {
    const scan = await scanBoardingPassBarcodes(gif(100, 65_535));
    expect(scan.refused).toBe(true);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("passes a GIF within the cap on to zxing", async () => {
    const scan = await scanBoardingPassBarcodes(gif(100, 100));
    expect(scan.refused).toBeUndefined();
    expect(mockedRead).toHaveBeenCalledTimes(1);
  });
});

describe("scanBoardingPassBarcodes — the time budget", () => {
  it("tries no region once the budget is spent: checked before the crop and the variants", async () => {
    const scan = await scanBoardingPassBarcodes(blocky(800, 600), { budgetMs: -1 });
    expect(scan.budgetExhausted).toBe(true);
    expect(scan.regionsTried).toBe(0);
    // Only the full-frame pass ran.
    expect(scan.attempts).toBe(1);
  }, 60_000);

  it("builds variants one at a time and brings a large region under the area cap first", () => {
    const side = Math.ceil(Math.sqrt(REGION_MAX_PIXELS)) * 2;
    const big: Gray = { data: new Uint8Array(side * side).fill(200), width: side, height: side };
    const variants = variantsOf(big);
    const first = variants.next();
    expect(first.done).toBe(false);
    const { gray, scale } = first.value as { gray: Gray; scale: number };
    expect(gray.width * gray.height).toBeLessThanOrEqual(REGION_MAX_PIXELS);
    expect(scale).toBeLessThan(1);
  });
});
