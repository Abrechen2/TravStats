import fs from "fs";
import path from "path";

import { convertHeicToJpeg, HeicDecodeError, shutdownHeicConverter } from "../heicConverter";

/**
 * forgejo#192: an iPhone photo is HEVC-coded HEIC, which browsers cannot draw
 * and the prebuilt sharp cannot decode. The converter must turn a real one into
 * a JPEG, and must REFUSE bytes it cannot decode rather than produce nothing.
 */
const HEIC = fs.readFileSync(
  path.join(__dirname, "../../../__tests__/fixtures/photos/synthetic-exif.heic")
);

afterAll(() => shutdownHeicConverter());

describe("convertHeicToJpeg", () => {
  it("decodes a real HEVC-coded HEIC into a JPEG", async () => {
    const jpeg = await convertHeicToJpeg(HEIC);

    // SOI marker — a JPEG, not the HEIC handed back.
    expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(jpeg.length).toBeGreaterThan(100);
  });

  it("refuses a truncated HEIC with a decode error", async () => {
    await expect(convertHeicToJpeg(HEIC.subarray(0, 400))).rejects.toBeInstanceOf(HeicDecodeError);
  });

  it("refuses bytes that are not HEIF at all", async () => {
    await expect(convertHeicToJpeg(Buffer.from("definitely not a photo"))).rejects.toBeInstanceOf(
      HeicDecodeError
    );
  });

  it("keeps working after a refusal — one bad file does not wedge the queue", async () => {
    const [bad, good] = await Promise.allSettled([
      convertHeicToJpeg(Buffer.alloc(32)),
      convertHeicToJpeg(HEIC),
    ]);

    expect(bad.status).toBe("rejected");
    expect(good.status).toBe("fulfilled");
  });
});
