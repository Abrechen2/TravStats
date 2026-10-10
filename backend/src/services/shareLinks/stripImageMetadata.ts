/**
 * Image bytes without the metadata a camera writes into them (forgejo#281).
 *
 * A phone's JPEG carries the GPS position, the time to the second, the device
 * and often its serial number — in its Exif block, and on many phones ALSO in
 * what follows the image: a motion photo's MP4, a depth map, an "Ultra HDR"
 * gain map or an MPF secondary image appended after the end marker, each with
 * an Exif block of its own. A public share link that served the original would
 * hand all of it to anyone holding the URL, though the owner chose "photos"
 * and nothing about places.
 *
 * So both formats are rebuilt from an ALLOW-list: every segment or chunk is
 * read, and only the ones a viewer needs to draw the picture are copied. No
 * re-encode, so no image library and no quality loss. Anything this function
 * does not understand — a format the magic bytes do not name, a claimed type
 * that disagrees with them, a stream that does not parse to its end marker —
 * is null: not served. Abstaining beats a partial passthrough.
 *
 * JPEG keeps: SOI; the frame headers SOF0–SOF15 (not the reserved JPG code
 *   C8); the tables DHT, DAC, DQT; DRI and DNL; every SOS with its
 *   entropy-coded data (restart markers inside it included); APP0 only as
 *   JFIF (pixel density); APP2 only as ICC_PROFILE (colour); the FIRST EOI.
 *   Everything else — APP1 (Exif, XMP), APP3–APP15 (MPF, IPTC, maker data),
 *   COM, anything between progressive scans, anything after EOI — is dropped.
 *   The one Exif value a viewer needs, the orientation, is written back as a
 *   minimal Exif block holding that single tag, or the photo would show on
 *   its side.
 * PNG keeps the chunks needed to decode and colour the image (see
 *   `PNG_ALLOWED`) and stops at IEND.
 */

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;

/** Markers copied as they are (besides SOS, APP0, APP2, which have their own rule). */
const JPEG_ALLOWED = new Set<number>([
  // Frame headers: baseline, extended, progressive, lossless; Huffman and
  // arithmetic, sequential and differential. 0xC4 is DHT, 0xC8 the reserved
  // JPG code (dropped), 0xCC is DAC — a table.
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
  0xc4, // DHT — Huffman tables
  0xcc, // DAC — arithmetic conditioning
  0xdb, // DQT — quantisation tables
  0xdd, // DRI — restart interval
  0xdc, // DNL — number of lines
]);

type ImageFormat = "jpeg" | "png";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function formatOfBytes(bytes: Buffer): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === SOI && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  return null;
}

function formatOfMimetype(mimetype: string): ImageFormat | null {
  const type = mimetype.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "jpeg";
  if (type === "image/png") return "png";
  return null;
}

export function stripImageMetadata(bytes: Buffer, mimetype: string): Buffer | null {
  // The bytes decide what the file is; the stored type only has to agree.
  const format = formatOfBytes(bytes);
  if (format === null || format !== formatOfMimetype(mimetype)) return null;
  return format === "jpeg" ? stripJpeg(bytes) : stripPng(bytes);
}

/** The Exif orientation (1–8) in an APP1 payload, or null. */
function exifOrientation(payload: Buffer): number | null {
  if (payload.length < 14 || payload.toString("latin1", 0, 6) !== "Exif\0\0") return null;
  const tiff = payload.subarray(6);
  const order = tiff.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : null;
      }
    }
  } catch {
    return null; // a truncated block has no orientation worth trusting
  }
  return null;
}

/** An APP1 segment holding only the orientation tag (big-endian TIFF). */
function orientationSegment(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 right after the header
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(0x0112, 10); // Orientation
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // count
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22); // no next IFD
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.from([0xff, APP1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/**
 * Where the entropy-coded data that starts at `from` ends: the offset of the
 * next real marker — 0xFF followed by neither 0x00 (a stuffed byte) nor
 * RST0–RST7 (part of the scan) nor another 0xFF (fill). Null: no marker
 * before the end of the file, a truncated stream.
 */
function endOfEntropyData(bytes: Buffer, from: number): number | null {
  let i = from;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const next = bytes[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i += 2;
    } else if (next === 0xff) {
      i += 1; // fill byte before a marker
    } else {
      return i;
    }
  }
  return null;
}

function stripJpeg(bytes: Buffer): Buffer | null {
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let orientation: number | null = null;
  let seenScan = false;
  let offset = 2;
  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // not a marker where one must be
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === EOI) {
      if (!seenScan) return null;
      kept.push(bytes.subarray(offset, offset + 2));
      if (orientation !== null && orientation !== 1) {
        // After a JFIF APP0 when there is one, which wants to be first.
        const at = kept[1]?.[1] === APP0 ? 2 : 1;
        kept.splice(at, 0, orientationSegment(orientation));
      }
      // Everything after the first EOI — a motion photo, a gain map, a
      // secondary image with its own Exif — stays behind.
      return Buffer.concat(kept);
    }
    if (marker === SOI || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      return null; // a second image start, or a stray standalone marker
    }
    if (offset + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const segment = bytes.subarray(offset, end);
    const payload = bytes.subarray(offset + 4, end);

    if (marker === SOS) {
      const dataEnd = endOfEntropyData(bytes, end);
      if (dataEnd === null) return null;
      kept.push(bytes.subarray(offset, dataEnd));
      seenScan = true;
      offset = dataEnd;
      continue;
    }
    if (marker === APP1) {
      // Read for the orientation only — and only before the first scan.
      if (!seenScan) orientation = orientation ?? exifOrientation(payload);
    } else if (marker === APP0) {
      if (payload.toString("latin1", 0, 5) === "JFIF\0") kept.push(segment);
    } else if (marker === APP2) {
      if (payload.toString("latin1", 0, 12) === "ICC_PROFILE\0") kept.push(segment);
    } else if (JPEG_ALLOWED.has(marker)) {
      kept.push(segment);
    }
    // Anything else — APP3–APP15, COM, DHP, EXP, JPGn, unknown — is dropped.
    offset = end;
  }
  return null; // no EOI: truncated
}

/**
 * PNG chunks that survive, each for a reason a viewer needs:
 * IHDR, IDAT, IEND — the image itself; PLTE — the palette an indexed image is
 * drawn with; tRNS — its transparency; gAMA, cHRM, sRGB, iCCP, sBIT — how its
 * colours are meant (iCCP's name field is at most 79 bytes and names a colour
 * profile); pHYs — the pixel aspect; bKGD — the background colour. Text
 * chunks, eXIf, tIME, APNG frames, C2PA/caBX and every private or unknown
 * chunk are dropped.
 */
const PNG_ALLOWED = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "pHYs",
  "bKGD",
]);

function stripPng(bytes: Buffer): Buffer | null {
  const kept: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  let first = true;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (first && type !== "IHDR") return null;
    first = false;
    if (PNG_ALLOWED.has(type)) kept.push(bytes.subarray(offset, end));
    // Nothing after IEND is read, let alone copied.
    if (type === "IEND") return Buffer.concat(kept);
    offset = end;
  }
  return null; // no IEND: truncated
}
