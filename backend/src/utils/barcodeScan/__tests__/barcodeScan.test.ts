import { PNG } from "pngjs";
import { readBarcodes } from "zxing-wasm/reader";
import { writeBarcode } from "zxing-wasm/writer";
import { scanBoardingPassBarcodes } from "..";
import { decodeToGray, type Gray } from "../pixels";

/**
 * Synthetic photos of paper boarding passes, built from real-looking BCBP
 * strings with invented passengers — the owner's own photo (two United passes
 * on one image, 2026-11-22) holds personal data and stays out of the repo.
 *
 * What the photo had, and what each case reproduces: small PDF417 symbols on
 * a big frame, turned 90° on the stub, the second one faint.
 */
const pass = (route: string, flight: string, seat: string): string =>
  `M1DOE/JANEMS          EQ7XK2P ${route}UA ${flight} 008Y${seat}0006 15C>3180 K6008BUA 5016` +
  "8820310012901623589826560 UA LH 992002391797244     *30601    09         ";
const UA633 = pass("MCOORD", "0633", "024F");
const UA952 = pass("ORDMUC", "0952", "035A");

async function symbol(text: string, scale: number): Promise<Gray> {
  const out = await writeBarcode(text, { format: "PDF417", scale });
  const png = PNG.sync.read(Buffer.from(await out.image!.arrayBuffer()));
  const data = new Uint8Array(png.width * png.height);
  for (let i = 0; i < data.length; i++) data[i] = png.data[i * 4];
  return { data, width: png.width, height: png.height };
}

/** Turn 90° clockwise, as a barcode printed along the stub of a paper pass. */
function rotate90(g: Gray): Gray {
  const data = new Uint8Array(g.data.length);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++)
      data[x * g.height + (g.height - 1 - y)] = g.data[y * g.width + x];
  }
  return { data, width: g.height, height: g.width };
}

/** Ink no darker than `ink` on paper `paper` — a faded thermal print. */
const fade = (g: Gray, ink: number, paper: number): Gray => ({
  ...g,
  data: g.data.map((v) => Math.round(ink + ((paper - ink) * v) / 255)),
});

/** Camera softness: a box blur of radius `r`. */
function blur(g: Gray, r: number): Gray {
  const out = new Uint8Array(g.data.length);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < g.height && xx < g.width) {
            sum += g.data[yy * g.width + xx];
            n++;
          }
        }
      }
      out[y * g.width + x] = Math.round(sum / n);
    }
  }
  return { ...g, data: out };
}

/** Ink fading from `inkStart` to `inkEnd` down the symbol — the washed-out half. */
function gradientFade(g: Gray, inkStart: number, inkEnd: number, paper: number): Gray {
  const data = new Uint8Array(g.data.length);
  for (let y = 0; y < g.height; y++) {
    const ink = inkStart + ((inkEnd - inkStart) * y) / g.height;
    for (let x = 0; x < g.width; x++) {
      data[y * g.width + x] = Math.round(ink + ((paper - ink) * g.data[y * g.width + x]) / 255);
    }
  }
  return { ...g, data };
}

/** The two-pass photo: soft, turned symbols on the right stubs, the second faded. */
async function twoPassPhoto(): Promise<Buffer> {
  const first = rotate90(blur(fade(await symbol(UA633, 2), 90, 240), 1));
  const second = rotate90(blur(gradientFade(await symbol(UA952, 2), 110, 200, 240), 1));
  const width = 2300;
  const height = 2000;
  return photo(width, height, [
    { g: first, x: width - first.width - 80, y: 100 },
    { g: second, x: width - second.width - 80, y: height / 2 + 100 },
  ]);
}

interface Placed {
  readonly g: Gray;
  readonly x: number;
  readonly y: number;
}

/** A light-grey photo background with deterministic grain and some "text" bars. */
function photo(width: number, height: number, symbols: Placed[]): Buffer {
  const png = new PNG({ width, height });
  let seed = 7;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < width * height; i++) {
    const v = 236 + Math.round(rnd() * 14);
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  // Printed text lines on the left of each pass: dark dashes with gaps.
  for (let line = 0; line < 14; line++) {
    const y0 = 80 + line * (height / 15);
    for (let x = 60; x < width * 0.6; x += 26) {
      for (let y = y0; y < y0 + 18; y++) {
        for (let dx = 0; dx < 16; dx++) {
          const p = (Math.floor(y) * width + x + dx) * 4;
          png.data[p] = png.data[p + 1] = png.data[p + 2] = 60;
        }
      }
    }
  }
  for (const { g, x, y } of symbols) {
    for (let sy = 0; sy < g.height; sy++) {
      for (let sx = 0; sx < g.width; sx++) {
        const p = ((y + sy) * width + x + sx) * 4;
        png.data[p] =
          png.data[p + 1] =
          png.data[p + 2] =
            Math.min(png.data[p], g.data[sy * g.width + sx]);
      }
    }
  }
  // Uncompressed: the bytes never leave this test, and deflate is what made it slow.
  return PNG.sync.write(png, { deflateLevel: 0, filterType: 0 });
}

describe("scanBoardingPassBarcodes — paper passes on a photo", () => {
  it("finds BOTH turned PDF417 symbols of two passes on one image, in reading order", async () => {
    const scan = await scanBoardingPassBarcodes(await twoPassPhoto());

    expect(scan.codes.map((c) => c.text.slice(30, 44))).toEqual([
      "MCOORDUA 0633 ",
      "ORDMUCUA 0952 ",
    ]);
    expect(scan.codes.every((c) => c.format === "PDF417")).toBe(true);
    // Reading order and position: the boxes are where the symbols were drawn.
    expect(scan.codes[0].box!.y).toBeLessThan(scan.codes[1].box!.y);
    expect(scan.codes[1].box!.x).toBeGreaterThan(2000);
  }, 120_000);

  it("is needed: the plain full-frame decode misses the faded second pass", async () => {
    // Positive control for the case above — the decode this replaced read
    // the whole frame once, and on this photo that yields one pass, not two.
    const whole = await readBarcodes(new Blob([new Uint8Array(await twoPassPhoto())]), {
      formats: ["PDF417"],
      tryHarder: true,
    });
    expect(whole.length).toBeLessThan(2);
  }, 120_000);

  it("still reads a plain Wallet-style image in one pass", async () => {
    const image = photo(900, 900, [{ g: await symbol(UA633, 3), x: 120, y: 300 }]);
    const scan = await scanBoardingPassBarcodes(image);
    expect(scan.codes[0]?.text).toBe(UA633);
  }, 60_000);

  it("reports an empty scan, not an error, for an image without a barcode", async () => {
    const scan = await scanBoardingPassBarcodes(photo(600, 400, []));
    expect(scan.codes).toEqual([]);
    expect(scan.error).toBeUndefined();
    expect(scan.imageDecoded).toBe(true);
  }, 60_000);

  it("refuses to decode a PNG whose header announces too many pixels", () => {
    // 1x1 PNG with the IHDR rewritten to 100 000 x 100 000 — a decompression bomb's shape.
    const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));
    png.writeUInt32BE(100_000, 16);
    png.writeUInt32BE(100_000, 20);
    expect(decodeToGray(png)).toBeNull();
  });
});
