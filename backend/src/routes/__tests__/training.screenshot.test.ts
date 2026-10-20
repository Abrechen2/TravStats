const mockRecognizeText = jest.fn();
jest.mock("../../services/parsers/vision/tesseractParser", () => ({
  getTesseractParser: () => ({ recognizeText: mockRecognizeText }),
}));

import fs from "fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getTrainingUploadDir } from "../training";

/**
 * forgejo#309: the workshop learns from a SCREENSHOT. The upload runs the
 * OCR step `/parse-image` runs and stores what it read as the sample's
 * `fullText`, so the marking works as it does on a mail. An OCR that reads
 * nothing answers its own code and keeps NOTHING — no row, no file — because
 * an empty sample could only derive a template that reads nothing.
 *
 * Tesseract is mocked (as the image-parse tests' unit siblings do): this is
 * about what the route does with the answer, not about OCR quality.
 */

/** A real 1x1 PNG — valid to the magic-number sniffer. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const OCR_TEXT = [
  "Ihre Reiseverbindung mit der Probebahn",
  "Hinfahrt am 14.11.2027",
  "Augsburg Hbf  08:12  →  München Hbf  08:48  RE 89",
].join("\n");

describe("POST /api/v1/training/upload with a screenshot", () => {
  let cookie: string;
  let userId: string;

  /** Files multer wrote for an upload of `name` (it keeps the base name as a suffix). */
  const filesNamed = (name: string): string[] =>
    fs.readdirSync(getTrainingUploadDir()).filter((f) => f.endsWith(`-${name}`));
  const upload = (name: string, bytes: Buffer = PNG_1x1) =>
    request(app)
      .post("/api/v1/training/upload")
      .set("Cookie", cookie)
      .field("type", "screenshot")
      .attach("file", bytes, name);

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `training-screenshot-${Date.now()}`,
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(() => {
    mockRecognizeText.mockReset();
  });

  afterAll(async () => {
    const rows = await prisma.trainingData.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(row.originalFile, { force: true });
    await prisma.trainingData.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("stores the OCR text as the sample's fullText, classified like a mail", async () => {
    mockRecognizeText.mockResolvedValueOnce({ text: OCR_TEXT, confidence: 88 });

    const res = await upload("connection.png");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: "screenshot", status: "pending" });
    expect(typeof res.body.domain).toBe("string");
    const row = await prisma.trainingData.findUnique({ where: { id: res.body.id } });
    expect(row?.annotations).toEqual({ fullText: OCR_TEXT });
    // OCR got the bytes it validated, as bare base64.
    expect(mockRecognizeText).toHaveBeenCalledWith(PNG_1x1.toString("base64"));
    // The stored sample opens in the text annotation like a mail.
    const read = await request(app).get(`/api/v1/training/${res.body.id}`).set("Cookie", cookie);
    expect(read.body.annotations.fullText).toBe(OCR_TEXT);
  });

  it("answers TRAINING_IMAGE_NO_TEXT for an image with almost no text, and keeps nothing", async () => {
    mockRecognizeText.mockResolvedValueOnce({ text: "  ~ ", confidence: 12 });
    const rowsBefore = await prisma.trainingData.count({ where: { userId } });

    const res = await upload("jest-blank-309.png");

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TRAINING_IMAGE_NO_TEXT");
    expect(await prisma.trainingData.count({ where: { userId } })).toBe(rowsBefore);
    expect(filesNamed("jest-blank-309.png")).toEqual([]);
  });

  it("answers TRAINING_IMAGE_UNREADABLE when the OCR cannot decode the file", async () => {
    mockRecognizeText.mockRejectedValueOnce(new Error("Error attempting to read image."));

    const res = await upload("broken.png");

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TRAINING_IMAGE_UNREADABLE");
  });

  it("refuses bytes that are no image before any OCR runs", async () => {
    const res = await upload("fake.png", Buffer.from("this is not a picture at all"));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRAINING_IMAGE_UNREADABLE");
    expect(mockRecognizeText).not.toHaveBeenCalled();
  });

  it("refuses a screenshot in a format the workshop does not take", async () => {
    const res = await upload("scan.gif");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRAINING_IMAGE_UNREADABLE");
    expect(mockRecognizeText).not.toHaveBeenCalled();
  });
});
