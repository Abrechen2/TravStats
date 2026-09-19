import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import type { LodgingTemplate } from "../../services/lodging/templates/types";

/**
 * The template workshop, from a BROWSER upload — beta audit 2026-09-19,
 * NOT FIXED 5.
 *
 * The API path was green the whole time the browser path could not derive a
 * single lodging template, and the difference was one line of text: a sample
 * posted to the API carried its `From:` header inside the body, while an
 * uploaded `.eml` did not. `extractEmailFromFile` hands back the BODY, header
 * block removed, so `readAnnotations` regexing `^From:` and `^Subject:` out of
 * the stored text found neither — and a lodging template with no sender domain
 * and no subject has nothing to anchor on, which is `noDistinguishingMarker`,
 * every time.
 *
 * So these go through `POST /training/upload` with real bytes, read the text
 * back the way the annotation view does, and annotate it — because that round
 * trip is where the evidence was being lost.
 */

const BODY = [
  "Hotel Seeblick Garni",
  "Reservierungsbestätigung",
  "",
  "Unterkunft: Hotel Seeblick Garni",
  "Anreise: 10. März 2026",
  "Abreise: 12. März 2026",
  "Buchungsnummer: 260310445566",
  "",
  "Hotel Seeblick Garni, Seestraße 4, hotel-seeblick.test",
].join("\n");

const HEADERS = ["From: reservierung@hotel-seeblick.test", "Subject: Ihre Buchungsbestätigung"];

const EML = [...HEADERS, "", BODY].join("\n");
const TXT_WITH_FROM = [...HEADERS, "", BODY].join("\n");

const MARKS = [
  { value: "Hotel Seeblick Garni", label: "hotelName" },
  { value: "10. März 2026", label: "checkIn" },
  { value: "12. März 2026", label: "checkOut" },
];

/**
 * The one thing `filterEmailText` does that matters here: every address is
 * removed before the annotation view saves the text back.
 *
 * Copied deliberately and kept to this one rule — the point is not to mirror
 * a frontend module in a backend test, it is that the text the browser stores
 * is NOT the text the upload extracted. Without this the `.txt` case below
 * would pass on the old code, because the raw upload still carried its
 * `From:` line and the deriver's in-text read would find it.
 */
const asAnnotationViewSaves = (text: string): string =>
  text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "");

describe("a lodging sample uploaded as a file", () => {
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `headers-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.parserTemplate.deleteMany({ where: { userId } });
    await prisma.trainingData.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** Upload, read the text back, mark the three lodging fields, save. */
  async function uploadAndAnnotate(
    content: string,
    filename: string
  ): Promise<{ id: string; derivation: { status: string; reason?: string; templateId?: string } }> {
    const upload = await request(app)
      .post("/api/v1/training/upload")
      .set("Cookie", [`auth_token=${token}`])
      .field("type", "email")
      .attach("file", Buffer.from(content, "utf-8"), filename);
    expect(upload.status).toBe(200);
    const id = upload.body.id as string;

    const sample = await request(app)
      .get(`/api/v1/training/${id}`)
      .set("Cookie", [`auth_token=${token}`]);
    expect(sample.status).toBe(200);
    const fullText = asAnnotationViewSaves(
      (sample.body.annotations as { fullText: string }).fullText
    );

    const textSelections = MARKS.map(({ value, label }) => {
      // The name beside its label, not the one in the letterhead: the mail
      // prints it twice, and what a user marks is the labelled one.
      const start =
        label === "hotelName"
          ? fullText.indexOf(`Unterkunft: ${value}`) + "Unterkunft: ".length
          : fullText.indexOf(value);
      if (start < 0) throw new Error(`the stored sample does not contain ${value}`);
      return { start, end: start + value.length, text: value, label };
    });

    const saved = await request(app)
      .post(`/api/v1/training/${id}/annotate`)
      .set("Cookie", [`auth_token=${token}`])
      .send({
        annotations: { type: "email", fullText, textSelections },
        extractedData: [Object.fromEntries(MARKS.map((m) => [m.label, m.value]))],
        domain: "lodging",
      });
    expect(saved.status).toBe(200);
    return { id, derivation: saved.body.derivation };
  }

  it("keeps the sender and the subject the .eml headers carried", async () => {
    const upload = await request(app)
      .post("/api/v1/training/upload")
      .set("Cookie", [`auth_token=${token}`])
      .field("type", "email")
      .attach("file", Buffer.from(EML, "utf-8"), "buchung.eml");
    expect(upload.status).toBe(200);

    const row = await prisma.trainingData.findUnique({ where: { id: upload.body.id as string } });
    expect(row?.senderAddress).toBe("reservierung@hotel-seeblick.test");
    expect(row?.subject).toBe("Ihre Buchungsbestätigung");
    // And the text really has lost them, which is why the columns exist.
    expect((row?.annotations as { fullText: string }).fullText).not.toContain("From:");
  });

  it("derives a template from an .eml, anchored on the sender's domain", async () => {
    const { derivation } = await uploadAndAnnotate(EML, "seeblick.eml");
    expect(derivation.status).toBe("derived");

    const template = await prisma.parserTemplate.findUnique({
      where: { id: derivation.templateId! },
    });
    const spec = template?.patterns as unknown as LodgingTemplate;
    expect(spec.match.anchors).toContain("hotel-seeblick.test");
  });

  it("still reads the headers out of a .txt that carries them", async () => {
    const { derivation } = await uploadAndAnnotate(TXT_WITH_FROM, "seeblick.txt");
    expect(derivation.status).toBe("derived");

    const template = await prisma.parserTemplate.findUnique({
      where: { id: derivation.templateId! },
    });
    const spec = template?.patterns as unknown as LodgingTemplate;
    expect(spec.match.anchors).toContain("hotel-seeblick.test");
  });

  it("abstains — honestly — when the same body arrives with no sender at all", async () => {
    // Nothing names the sender: no From line, and the subject is empty. An
    // anchor built from this document would be built out of the booking, and
    // would claim the next hotel mail that arrives (plan §7). The refusal is
    // the right answer here; what was wrong was giving it for a mail that DID
    // name its sender.
    const { derivation } = await uploadAndAnnotate(BODY, "koerper.txt");
    expect(derivation).toEqual(
      expect.objectContaining({ status: "abstained", reason: "noDistinguishingMarker" })
    );
  });
});
