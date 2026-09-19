import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * A mark has to cut its own value out of the text it is saved with.
 *
 * The annotation view measured `start`/`end` against the text on SCREEN and
 * then stored a freshly filtered copy of the original, so with "show filtered"
 * switched off the offsets described one document and the stored text was
 * another. Nothing failed and nothing was logged: `labelContextOf` read the
 * label of whichever line the shifted offset landed in, and the workshop
 * derived a template anchored on the wrong words — the failure that costs
 * most, because its result is a proposal a human accepts by habit.
 *
 * The frontend is fixed at the source (it stores the text it marked against).
 * This is the guard that would have made the defect visible from the outside,
 * and the reason the two can never silently diverge again.
 */

const BODY = [
  "Sehr geehrter Herr Muster,",
  "",
  "Unterkunft: Hotel Seeblick Garni",
  "Anreise: 10. März 2026",
  "Abreise: 12. März 2026",
].join("\n");

describe("POST /training/:id/annotate — offsets against the stored text", () => {
  let userId: string;
  let token: string;
  let sampleId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `offsets-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    token = generateToken(userId);
    const row = await prisma.trainingData.create({
      data: {
        userId,
        type: "email",
        domain: "lodging",
        originalFile: `/dev/null/offsets-${Date.now()}`,
        annotations: { fullText: BODY } as unknown as object,
        extractedData: [] as unknown as object,
        status: "pending",
      },
    });
    sampleId = row.id;
  });

  afterAll(async () => {
    await prisma.parserTemplate.deleteMany({ where: { userId } });
    await prisma.trainingData.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const markFor = (text: string, value: string, label: string) => {
    const start = text.indexOf(value);
    return { start, end: start + value.length, text: value, label };
  };

  const annotate = (fullText: string, textSelections: unknown[]) =>
    request(app)
      .post(`/api/v1/training/${sampleId}/annotate`)
      .set("Cookie", [`auth_token=${token}`])
      .send({
        annotations: { type: "email", fullText, textSelections },
        extractedData: [{}],
        domain: "lodging",
      });

  it("accepts marks that cut their own value out of the text", async () => {
    const response = await annotate(BODY, [
      markFor(BODY, "Hotel Seeblick Garni", "hotelName"),
      markFor(BODY, "10. März 2026", "checkIn"),
      markFor(BODY, "12. März 2026", "checkOut"),
    ]);
    expect(response.status).toBe(200);

    const row = await prisma.trainingData.findUnique({ where: { id: sampleId } });
    const stored = row?.annotations as { fullText: string; textSelections: unknown[] };
    for (const selection of stored.textSelections) {
      const mark = selection as { start: number; end: number; text: string };
      expect(stored.fullText.slice(mark.start, mark.end)).toBe(mark.text);
    }
  });

  it("refuses a mark measured against a DIFFERENT version of the text", async () => {
    // Exactly what shipped: offsets taken from the unfiltered mail, text
    // saved with the greeting removed. Every offset is nine characters late.
    const filtered = BODY.replace("Sehr geehrter Herr Muster,\n", "");
    const response = await annotate(filtered, [
      markFor(BODY, "Hotel Seeblick Garni", "hotelName"),
      markFor(BODY, "10. März 2026", "checkIn"),
    ]);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("ANNOTATION_TEXT_MISMATCH");
  });

  it("refuses a mark whose value was trimmed without moving its offsets", async () => {
    // The second half of the same defect: the view trimmed the selected text
    // and kept the raw offsets, so a selection that caught the newline in
    // front of a value stored a value its own offsets did not point at.
    const start = BODY.indexOf("\nUnterkunft:");
    const response = await annotate(BODY, [
      { start, end: start + "\nUnterkunft:".length, text: "Unterkunft:", label: "hotelName" },
    ]);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("ANNOTATION_TEXT_MISMATCH");
  });

  it("leaves a boarding pass alone — it carries no text offsets to check", async () => {
    const response = await request(app)
      .post(`/api/v1/training/${sampleId}/annotate`)
      .set("Cookie", [`auth_token=${token}`])
      .send({
        annotations: { type: "boarding_pass", boundingBoxes: [{ x: 1, y: 2 }] },
        extractedData: [{}],
        domain: "flight",
      });
    expect(response.status).toBe(200);
  });
});
