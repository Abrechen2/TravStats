/**
 * The worker's whole program for `downscale.ts`: plain CommonJS evaluated in a
 * worker thread (the same approach as `photos/heicConverter.ts`, so it runs
 * identically under tsx, ts-jest and the compiled `dist/`). Module paths are
 * resolved in the main thread, never against the worker's cwd.
 *
 * It decodes a JPEG (jpeg-js) or PNG (pngjs), honours the EXIF orientation for
 * the three rotations (jpeg-js ignores it), box-filters to the longest edge and
 * re-encodes as JPEG. Mirrored orientations are not handled; cameras do not
 * write them. A PNG's pixel count is read from its header BEFORE any pixel is
 * decoded, so a small file declaring a huge canvas is refused up front.
 */
export function downscaleWorkerSource(): string {
  const jpegPath = require.resolve("jpeg-js");
  const pngPath = require.resolve("pngjs");
  return `
const { parentPort } = require("worker_threads");
const jpeg = require(${JSON.stringify(jpegPath)});
const { PNG } = require(${JSON.stringify(pngPath)});
const QUALITY = 72;

function exifOrientation(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let pos = 2;
  while (pos + 4 < b.length) {
    if (b[pos] !== 0xff) return 1;
    const marker = b[pos + 1];
    const len = b.readUInt16BE(pos + 2);
    if (marker === 0xe1 && b.toString("latin1", pos + 4, pos + 10) === "Exif\\0\\0") {
      const t = pos + 10;
      const le = b.toString("latin1", t, t + 2) === "II";
      const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
      const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      if (t + 8 > b.length) return 1;
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return 1;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) return 1;
        if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    pos += 2 + len;
  }
  return 1;
}

function decode(b, mimetype, maxPixels) {
  const isPng = b.length > 24 && b.readUInt32BE(0) === 0x89504e47;
  const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
  if (isPng) {
    if (b.readUInt32BE(16) * b.readUInt32BE(20) > maxPixels) return null;
    const png = PNG.sync.read(b);
    // Composite onto white: a transparent PNG would otherwise print black.
    const out = new Uint8Array(png.width * png.height * 4);
    for (let i = 0; i < png.width * png.height; i++) {
      const a = png.data[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(png.data[i * 4 + c] * a + 255 * (1 - a));
      out[i * 4 + 3] = 255;
    }
    return { width: png.width, height: png.height, data: out };
  }
  if (!isJpeg) return null;
  const d = jpeg.decode(b, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: maxPixels / 1e6, maxMemoryUsageInMB: 512 });
  return { width: d.width, height: d.height, data: d.data };
}

function downscale(b, mimetype, maxEdge, maxPixels) {
  const src = decode(b, mimetype, maxPixels);
  if (!src || src.width < 1 || src.height < 1) return null;
  const o = exifOrientation(b);
  const swap = o === 6 || o === 8;
  const rw = swap ? src.height : src.width;
  const rh = swap ? src.width : src.height;
  const scale = Math.min(1, maxEdge / Math.max(rw, rh));
  const ow = Math.max(1, Math.round(rw * scale));
  const oh = Math.max(1, Math.round(rh * scale));
  const out = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const y0 = Math.floor((y * rh) / oh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * rh) / oh));
    for (let x = 0; x < ow; x++) {
      const x0 = Math.floor((x * rw) / ow);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * rw) / ow));
      let r = 0, g = 0, bl = 0, n = 0;
      for (let ry = y0; ry < y1; ry++) {
        for (let rx = x0; rx < x1; rx++) {
          let sx = rx, sy = ry;
          if (o === 3) { sx = src.width - 1 - rx; sy = src.height - 1 - ry; }
          else if (o === 6) { sx = ry; sy = src.height - 1 - rx; }
          else if (o === 8) { sx = src.width - 1 - ry; sy = rx; }
          const i = (sy * src.width + sx) * 4;
          r += src.data[i]; g += src.data[i + 1]; bl += src.data[i + 2]; n++;
        }
      }
      const p = (y * ow + x) * 4;
      out[p] = Math.round(r / n); out[p + 1] = Math.round(g / n); out[p + 2] = Math.round(bl / n); out[p + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data: out, width: ow, height: oh }, QUALITY).data);
}

parentPort.on("message", (job) => {
  try {
    const data = downscale(Buffer.from(job.bytes), job.mimetype, job.maxEdge, job.maxPixels);
    parentPort.postMessage({ id: job.id, ok: true, bytes: data ? new Uint8Array(data) : null });
  } catch (error) {
    parentPort.postMessage({ id: job.id, ok: false, message: String((error && error.message) || error) });
  }
});
`;
}
