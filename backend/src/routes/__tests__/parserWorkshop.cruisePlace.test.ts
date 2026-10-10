import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { deriveTemplateFromAnnotation } from "../../services/parsers/userTemplates/deriver";
import { findMatchingTemplate } from "../../services/parsers/userTemplates/matcher";
import { loadActiveLodgingTemplates } from "../../services/parsers/userTemplates/lodgingTemplates";
import { loadActiveWorkshopTemplates } from "../../services/parsers/userTemplates/v2UserTemplates";
import { parseCruiseBookingText } from "../../services/cruiseBookingParser";
import type { AnnotationSelection } from "../../services/parsers/userTemplates/annotations";
import {
  CRUISE_FOREIGN,
  CRUISE_HELD_OUT,
  CRUISE_SELECTIONS,
  CRUISE_SOURCE,
  CRUISE_SUBJECT,
  PLACE_FOREIGN,
  PLACE_HELD_OUT,
  PLACE_SELECTIONS,
  PLACE_SOURCE,
  PLACE_SUBJECT,
} from "../../services/parsers/userTemplates/__tests__/workshopSamples";

/**
 * forgejo#124 — the workshop for cruise and place, end to end:
 * annotate → derive → preview (own sample + held-out) → activate → the
 * domain's parser reads with the user's template, after the bundled ones —
 * and a cruise or place template is never offered to another domain's
 * document. Real matchers and consumers throughout; the samples are invented.
 */

async function makeSample(
  userId: string,
  domain: string,
  subject: string,
  fullText: string,
  selections: AnnotationSelection[]
): Promise<string> {
  const row = await prisma.trainingData.create({
    data: {
      userId,
      type: "email",
      domain,
      subject,
      originalFile: `/dev/null/${domain}-${Date.now()}-${Math.random()}`,
      annotations: { fullText, textSelections: selections } as unknown as object,
      extractedData: [] as unknown as object,
      status: "pending",
    },
  });
  return row.id;
}

describe("the template workshop for cruise and place", () => {
  let userId: string;
  let token: string;
  let otherUserId: string;
  let otherToken: string;
  let cruiseTemplateId: string;
  let placeTemplateId: string;

  const auth = (t: string): [string] => [`auth_token=${t}`];

  beforeAll(async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { username: `workshop-cp-${stamp}`, passwordHash: "x" },
    });
    const other = await prisma.user.create({
      data: { username: `workshop-cp-other-${stamp}`, passwordHash: "x" },
    });
    userId = user.id;
    otherUserId = other.id;
    token = generateToken(userId);
    otherToken = generateToken(otherUserId);
  });

  afterAll(async () => {
    const ids = [userId, otherUserId];
    await prisma.parserTemplate.deleteMany({ where: { userId: { in: ids } } });
    await prisma.trainingData.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  async function deriveAndActivate(
    domain: "cruise" | "place",
    source: { subject: string; text: string; selections: AnnotationSelection[] },
    heldOut: { subject: string; text: string }
  ): Promise<{ id: string; preview: request.Response }> {
    const sampleId = await makeSample(
      userId,
      domain,
      source.subject,
      source.text,
      source.selections
    );
    const outcome = await deriveTemplateFromAnnotation(sampleId, userId);
    expect(outcome).toMatchObject({ status: "derived", domain });
    if (outcome.status !== "derived") throw new Error("not derived");

    const row = await prisma.parserTemplate.findUnique({ where: { id: outcome.templateId } });
    expect(row).toMatchObject({ domain, status: "pending" });

    // Not before the preview.
    const refused = await request(app)
      .patch(`/api/v1/parser-templates/${outcome.templateId}`)
      .set("Cookie", auth(token))
      .send({ status: "active" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("PREVIEW_REQUIRED");

    await makeSample(userId, domain, heldOut.subject, heldOut.text, []);
    const preview = await request(app)
      .post(`/api/v1/parser-templates/${outcome.templateId}/preview`)
      .set("Cookie", auth(token));
    expect(preview.status).toBe(200);
    expect(preview.body.canActivate).toBe(true);
    expect(preview.body.own.result.matched).toBe(true);
    expect(preview.body.heldOut?.result.matched).toBe(true);

    const allowed = await request(app)
      .patch(`/api/v1/parser-templates/${outcome.templateId}`)
      .set("Cookie", auth(token))
      .send({ status: "active" });
    expect(allowed.status).toBe(200);
    return { id: outcome.templateId, preview };
  }

  it("derives, previews and activates a cruise template", async () => {
    const { id, preview } = await deriveAndActivate(
      "cruise",
      { subject: CRUISE_SUBJECT, text: CRUISE_SOURCE, selections: CRUISE_SELECTIONS },
      { subject: CRUISE_SUBJECT, text: CRUISE_HELD_OUT }
    );
    cruiseTemplateId = id;
    const fields = preview.body.own.result.fields as Array<{ name: string; value: string }>;
    expect(fields.find((f) => f.name === "shipName")?.value).toBe("MS Probestern");
    // The stop list is shown, sea day included — the part that was not readable before.
    expect(fields.find((f) => f.name === "stops")?.value).toBe(
      "2027-06-02 Kiel · 2027-06-03 — · 2027-06-04 Oslo · 2027-06-05 Kiel"
    );
  });

  it("is read by the cruise parser, after the bundled templates, for its owner only", async () => {
    const parsed = await parseCruiseBookingText(
      `${CRUISE_SUBJECT}\n\n${CRUISE_HELD_OUT}`,
      {
        url: "http://127.0.0.1:9",
      },
      userId
    );
    expect(parsed.parserUsed).toBe("template");
    expect(parsed.cruises[0]).toMatchObject({
      shipName: "MS Morgenwind",
      parserTemplate: `user-${(await prisma.parserTemplate.findUnique({ where: { id: cruiseTemplateId } }))?.sourceId}`,
    });
    expect(parsed.cruises[0].stops).toHaveLength(5);

    // Another account's parse never sees it.
    expect(await loadActiveWorkshopTemplates(otherUserId, "cruise")).toEqual([]);
  });

  it("derives, previews and activates a place template", async () => {
    const { id, preview } = await deriveAndActivate(
      "place",
      { subject: PLACE_SUBJECT, text: PLACE_SOURCE, selections: PLACE_SELECTIONS },
      { subject: "", text: PLACE_HELD_OUT }
    );
    placeTemplateId = id;
    const fields = preview.body.heldOut.result.fields as Array<{ name: string; value: string }>;
    expect(fields).toEqual(
      expect.arrayContaining([
        { name: "name", value: "Museum am Probeufer" },
        { name: "visitedAt", value: "2027-11-02" },
      ])
    );
  });

  it("reads a place document into one import candidate, and writes nothing", async () => {
    const placesBefore = await prisma.place.count({ where: { userId } });
    const res = await request(app)
      .post("/api/v1/place-import/document")
      .set("Cookie", auth(token))
      .send({ text: PLACE_HELD_OUT });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      candidates: [
        {
          sourceRowIndex: 0,
          name: "Museum am Probeufer",
          address: "Uferweg 12, 10999 Musterstadt",
          category: "Museum",
          visitedAt: "2027-11-02",
        },
      ],
      templateId: `place:user-${(await prisma.parserTemplate.findUnique({ where: { id: placeTemplateId } }))?.sourceId}`,
    });
    expect(await prisma.place.count({ where: { userId } })).toBe(placesBefore);
  });

  it("says why a document was not read — not recognised, or no template at all", async () => {
    const foreign = await request(app)
      .post("/api/v1/place-import/document")
      .set("Cookie", auth(token))
      .send({ text: PLACE_FOREIGN });
    expect(foreign.body.data).toEqual({
      candidates: [],
      templateId: null,
      fallbackCode: "notRecognised",
    });

    const none = await request(app)
      .post("/api/v1/place-import/document")
      .set("Cookie", auth(otherToken))
      .send({ text: PLACE_HELD_OUT });
    expect(none.body.data.fallbackCode).toBe("noTemplate");

    const empty = await request(app)
      .post("/api/v1/place-import/document")
      .set("Cookie", auth(token))
      .send({ text: "   " });
    expect(empty.status).toBe(400);
  });

  it("never offers a cruise or place template to another domain's document", async () => {
    // The cruise document goes to the place reader: the cruise template is not
    // among the place templates, so nothing reads it.
    const cruiseAsPlace = await request(app)
      .post("/api/v1/place-import/document")
      .set("Cookie", auth(token))
      .send({ text: CRUISE_HELD_OUT, subject: CRUISE_SUBJECT });
    expect(cruiseAsPlace.body.data.candidates).toEqual([]);

    // The place ticket goes to the cruise parser: no voyage from the place template.
    const placeAsCruise = await parseCruiseBookingText(
      `${PLACE_SUBJECT}\n\n${PLACE_SOURCE}`,
      {
        url: "http://127.0.0.1:9",
      },
      userId
    );
    expect(placeAsCruise.parserUsed).not.toBe("template");
    expect(placeAsCruise.cruises).toEqual([]);

    // The flight matcher and the lodging loader filter on the domain column.
    expect(
      await findMatchingTemplate(userId, "flight", "", CRUISE_SUBJECT, CRUISE_SOURCE)
    ).toBeNull();
    expect(await loadActiveLodgingTemplates(userId)).toEqual([]);

    // Each v2 loader answers with its own domain only, whatever the rows hold.
    const cruise = await loadActiveWorkshopTemplates(userId, "cruise");
    const place = await loadActiveWorkshopTemplates(userId, "place");
    expect(cruise.map((t) => t.domain)).toEqual(["cruise"]);
    expect(place.map((t) => t.domain)).toEqual(["place"]);
  });

  it("ignores a row whose column says cruise but whose envelope is a place", async () => {
    const placeRow = await prisma.parserTemplate.findUnique({ where: { id: placeTemplateId } });
    await prisma.parserTemplate.create({
      data: {
        userId,
        domain: "cruise",
        name: "mislabelled",
        status: "active",
        fingerprint: {} as unknown as object,
        patterns: placeRow!.patterns as unknown as object,
      },
    });
    expect((await loadActiveWorkshopTemplates(userId, "cruise")).map((t) => t.domain)).toEqual([
      "cruise",
    ]);
    const parsed = await parseCruiseBookingText(
      `Ihre Reisebestätigung – Südwind Kreuzfahrten\n\n${CRUISE_FOREIGN}`,
      {
        url: "http://127.0.0.1:9",
      },
      userId
    );
    expect(parsed.parserUsed).not.toBe("template");
  });
});
