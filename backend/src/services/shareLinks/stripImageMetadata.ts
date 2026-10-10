/**
 * Image bytes without the metadata a camera writes into them (forgejo#281).
 *
 * A phone's JPEG carries the GPS position, the time to the second, the device
 * and often its serial number in its Exif block — a public share link that
 * served the original would hand all of it to anyone holding the URL, even
 * though the owner chose "photos" and nothing about places. So a photo leaves
 * through a public link only after this: the segments that can carry metadata
 * are dropped, the picture data is copied byte for byte. No re-encode, so no
 * image library and no quality loss.
 *
 * JPEG: every APP1–APP15 segment (Exif, XMP, IPTC/Photoshop, maker notes) and
 *   every comment is dropped. APP0 (JFIF, pixel density) and an APP2 ICC
 *   colour profile stay — neither describes the person or the place. The one
 *   Exif value a viewer needs, the orientation, is written back as a minimal
 *   Exif block holding that single tag, or the photo would show on its side.
 * PNG: text chunks (tEXt, zTXt, iTXt), eXIf and tIME are dropped.
 * Anything else: null — not served. Abstaining beats leaking a format this
 * function does not understand.
 */

const JPEG_SOI = 0xd8;
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP15 = 0xef;
const COM = 0xfe;

export function stripImageMetadata(bytes: Buffer, mimetype: string): Buffer | null {
  const type = mimetype.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return stripJpeg(bytes);
  if (type === "image/png") return stripPng(bytes);
  return null;
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

function stripJpeg(bytes: Buffer): Buffer | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) return null;
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let orientation: number | null = null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // not a marker where one must be
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === JPEG_EOI) break;
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const segment = bytes.subarray(offset, end);
    const payload = bytes.subarray(offset + 4, end);
    if (marker === JPEG_SOS) {
      // Entropy-coded data follows; nothing after it is metadata a viewer reads.
      if (orientation !== null && orientation !== 1) {
        // After a JFIF APP0 when there is one, which wants to be first.
        const at = kept[1]?.[1] === APP0 ? 2 : 1;
        kept.splice(at, 0, orientationSegment(orientation));
      }
      kept.push(bytes.subarray(offset));
      return Buffer.concat(kept);
    }
    if (marker === APP1) {
      orientation = orientation ?? exifOrientation(payload);
    } else if (marker === APP0) {
      if (payload.toString("latin1", 0, 5) === "JFIF\0") kept.push(segment);
    } else if (marker === APP2) {
      if (payload.toString("latin1", 0, 12) === "ICC_PROFILE\0") kept.push(segment);
    } else if ((marker >= APP0 && marker <= APP15) || marker === COM) {
      // dropped: Exif, XMP, IPTC, maker notes, comments
    } else {
      kept.push(segment);
    }
    offset = end;
  }
  return null; // no image data found
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROPPED = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(bytes: Buffer): Buffer | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const kept: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    if (!PNG_DROPPED.has(type)) kept.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") return Buffer.concat(kept);
  }
  return null;
}
