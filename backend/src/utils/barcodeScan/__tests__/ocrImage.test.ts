import { crc32, deflateSync } from "zlib";
import { boundedOcrImage } from "../ocrImage";
import { ImageRefusedError } from "../pixels";
import { getTesseractParser } from "../../../services/parsers/vision/tesseractParser";

/**
 * Tesseract decodes what it is given with a decoder that has no size limit,
 * so the PNG bomb the barcode scan refuses used to reach it through OCR
 * (coordinator review, 2026-11-22). The worker is mocked: the assertion is
 * that it never sees the bytes.
 */
const recognize = jest.fn().mockResolvedValue({ data: { text: "", confidence: 0 } });
jest.mock("tesseract.js", () => ({
  createWorker: jest.fn(async () => ({
    recognize,
    setParameters: jest.fn(),
    terminate: jest.fn(),
  })),
}));

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}
function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  return chunk("IHDR", data);
}
/** Announces 10x10, inflates to 2000x2000: the lying-header bomb. */
const BOMB = Buffer.concat([
  SIGNATURE,
  ihdr(10, 10),
  chunk("IDAT", deflateSync(Buffer.alloc(2000 * 2001))),
  chunk("IEND", Buffer.alloc(0)),
]);
const HONEST = Buffer.concat([
  SIGNATURE,
  ihdr(10, 10),
  chunk("IDAT", deflateSync(Buffer.alloc(10 * 11))),
  chunk("IEND", Buffer.alloc(0)),
]);

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

beforeEach(() => recognize.mockClear());

describe("OCR never decodes an unbounded image", () => {
  it("refuses a PNG bomb before Tesseract sees it (document reader)", async () => {
    await expect(getTesseractParser().recognizeText(BOMB.toString("base64"))).rejects.toThrow(
      ImageRefusedError
    );
    expect(recognize).not.toHaveBeenCalled();
  });

  it("refuses a PNG bomb before Tesseract sees it (boarding-pass reader)", async () => {
    await expect(getTesseractParser().readImage(BOMB.toString("base64"))).rejects.toThrow(
      ImageRefusedError
    );
    expect(recognize).not.toHaveBeenCalled();
  });

  it("hands Tesseract a re-encoded grayscale PNG, not the upload", async () => {
    await getTesseractParser().recognizeText(HONEST.toString("base64"));
    const given = recognize.mock.calls[0][0] as Buffer;
    expect(given.subarray(0, 8).equals(SIGNATURE)).toBe(true);
    expect(given[25]).toBe(0); // IHDR colour type: grayscale
  });

  it("checks every GIF frame against the cap", () => {
    expect(boundedOcrImage(gif(100, 100)).subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(() => boundedOcrImage(gif(100, 65535))).toThrow(ImageRefusedError);
  });

  it("refuses a format it cannot bound", () => {
    expect(() => boundedOcrImage(Buffer.from("BM not a bitmap we read"))).toThrow(
      ImageRefusedError
    );
  });
});
