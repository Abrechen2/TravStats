import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { deriveTemplateFromAnnotation } from "../../services/parsers/userTemplates/deriver";
import { findMatchingTemplate } from "../../services/parsers/userTemplates/matcher";
import { parseLodgingBookingText } from "../../services/lodging/lodgingBookingParser";

/**
 * forgejo#124 phase 6 — the workshop learns the other three domains.
 *
 * What this proves, in the order the plan asks for it:
 *
 *  - a lodging sample derives a LODGING template, with the domain written;
 *  - it is `pending` until a preview has run it, and the preview runs it
 *    against its own sample and a held-out one;
 *  - once active, the LODGING parser uses it and the FLIGHT parser cannot
 *    see it — phase 1's guarantee, now that there is finally a template of
 *    another domain to test it with;
 *  - cruise abstains with a reason instead of writing a template no reader
 *    in this tree could run.
 */

const hotelMail = (name: string, checkIn: string, checkOut: string, ref: string): string =>
  [
    "From: reservations@pension-abend.test",
    "Subject: Reservierungsbestätigung Pension Abend",
    "",
    "Pension Abend",
    "",
    `Unterkunft: ${name}`,
    `Anreise: ${checkIn}`,
    `Abreise: ${checkOut}`,
    `Buchungsnummer: ${ref}`,
  ].join("\n");

const SOURCE = hotelMail("Pension Abend Bremen", "4. April 2026", "6. April 2026", "99001122");
const HELD_OUT = hotelMail("Pension Abend Kiel", "19. Juni 2026", "21. Juni 2026", "99005566");

const selectionsFor = (text: string, name: string, checkIn: string, checkOut: string) =>
  [
    { value: name, label: "hotelName" },
    { value: checkIn, label: "checkIn" },
    { value: checkOut, label: "checkOut" },
  ].map(({ value, label }) => {
    const start = text.indexOf(value);
    return { start, end: start + value.length, text: value, label };
  });

async function makeSample(
  userId: string,
  domain: string,
  fullText: string,
  selections: ReturnType<typeof selectionsFor>
): Promise<string> {
  const row = await prisma.trainingData.create({
    data: {
      userId,
      type: "email",
      domain,
      originalFile: `/dev/null/${domain}-${Date.now()}`,
      annotations: { fullText, textSelections: selections } as unknown as object,
      extractedData: [] as unknown as object,
      status: "pending",
    },
  });
  return row.id;
}

describe("the template workshop, for every domain", () => {
  let userId: string;
  let token: string;
  let demoUserId: string;
  let demoToken: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `workshop-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    token = generateToken(userId);
    // `isSharedDemoUser` is the flag AND the published username — see
    // `utils/sharedDemo.ts` for why the flag alone is the wrong question.
    const existingDemo = await prisma.user.findUnique({ where: { username: "demo" } });
    const demo =
      existingDemo ??
      (await prisma.user.create({
        data: { username: "demo", passwordHash: "x", isDemo: true },
      }));
    demoUserId = demo.id;
    demoToken = generateToken(demoUserId);
  });

  afterAll(async () => {
    await prisma.parserTemplate.deleteMany({ where: { userId: { in: [userId, demoUserId] } } });
    await prisma.trainingData.deleteMany({ where: { userId: { in: [userId, demoUserId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("derives a LODGING template from a lodging sample, and leaves it pending", async () => {
    const sourceId = await makeSample(
      userId,
      "lodging",
      SOURCE,
      selectionsFor(SOURCE, "Pension Abend Bremen", "4. April 2026", "6. April 2026")
    );
    const outcome = await deriveTemplateFromAnnotation(sourceId, userId);
    expect(outcome.status).toBe("derived");
    if (outcome.status !== "derived") return;

    const row = await prisma.parserTemplate.findUnique({ where: { id: outcome.templateId } });
    expect(row?.domain).toBe("lodging");
    // The whole point of the phase: before it, this column held its default
    // on every row that had ever been written.
    expect(row?.status).toBe("pending");
  });

  it("refuses activation until the preview has run, then allows it", async () => {
    const template = await prisma.parserTemplate.findFirst({
      where: { userId, domain: "lodging" },
    });
    expect(template).not.toBeNull();
    const id = template!.id;

    const refused = await request(app)
      .patch(`/api/v1/parser-templates/${id}`)
      .set("Cookie", [`auth_token=${token}`])
      .send({ status: "active" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("PREVIEW_REQUIRED");

    // A held-out sample of the same domain, which the template never saw.
    await makeSample(
      userId,
      "lodging",
      HELD_OUT,
      selectionsFor(HELD_OUT, "Pension Abend Kiel", "19. Juni 2026", "21. Juni 2026")
    );

    const preview = await request(app)
      .post(`/api/v1/parser-templates/${id}/preview`)
      .set("Cookie", [`auth_token=${token}`]);
    expect(preview.status).toBe(200);
    expect(preview.body.canActivate).toBe(true);
    expect(preview.body.own.result.matched).toBe(true);
    expect(preview.body.own.result.fields.map((f: { name: string }) => f.name)).toEqual(
      expect.arrayContaining(["hotelName", "checkIn", "checkOut"])
    );
    // The held-out mail is from the same sender, so the template reads it —
    // which is the evidence that it describes a sender and not one booking.
    expect(preview.body.heldOut?.result.matched).toBe(true);
    expect(preview.body.heldOutReason).toBeNull();

    const allowed = await request(app)
      .patch(`/api/v1/parser-templates/${id}`)
      .set("Cookie", [`auth_token=${token}`])
      .send({ status: "active" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.status).toBe("active");
  });

  it("is used by the lodging parser, and is invisible to the flight parser", async () => {
    const parsed = await parseLodgingBookingText(HELD_OUT, undefined, userId);
    expect(parsed.parserUsed).toBe("template");
    expect(parsed.bookings[0]?.hotelName).toBe("Pension Abend Kiel");

    // Phase 1's guarantee, finally testable with a real other-domain
    // template: the flight lookup filters on the DOMAIN, not on how well the
    // fingerprint happens to match.
    const forFlight = await findMatchingTemplate(
      userId,
      "flight",
      "reservations@pension-abend.test",
      "Reservierungsbestätigung Pension Abend",
      SOURCE
    );
    expect(forFlight).toBeNull();
  });

  it("does not offer a flight template to the lodging parser either", async () => {
    await prisma.parserTemplate.create({
      data: {
        userId,
        domain: "flight",
        name: "A flight template",
        status: "active",
        fingerprint: {
          senderDomains: [],
          subjectPatterns: [""],
          bodyMarkers: [],
        } as unknown as object,
        // Deliberately not a lodging spec at all. If the lodging loader ever
        // stopped filtering by domain, this row would reach
        // `applyLodgingTemplate` and the shape check would be the only thing
        // between it and a proposal built from flight patterns.
        patterns: { flightNumber: "([A-Z]{2}\\d+)" } as unknown as object,
      },
    });

    const parsed = await parseLodgingBookingText(SOURCE, undefined, userId);
    expect(parsed.bookings[0]?.parserTemplate).not.toContain("flight");
    expect(parsed.bookings[0]?.hotelName).toBe("Pension Abend Bremen");
  });

  it("abstains for cruise, and says why, instead of writing a template", async () => {
    const cruiseText = [
      "From: service@reederei.test",
      "Subject: Ihre Kreuzfahrt",
      "",
      "Schiff: Mein Schiff 4",
      "Reisebeginn: 19. November 2026",
    ].join("\n");
    const sampleId = await makeSample(userId, "cruise", cruiseText, [
      {
        start: cruiseText.indexOf("Mein Schiff 4"),
        end: 0,
        text: "Mein Schiff 4",
        label: "shipName",
      },
    ] as ReturnType<typeof selectionsFor>);

    const outcome = await deriveTemplateFromAnnotation(sampleId, userId);
    expect(outcome).toEqual({
      status: "abstained",
      domain: "cruise",
      reason: "cruiseNeedsRepeatingBlocks",
    });
    expect(await prisma.parserTemplate.count({ where: { userId, domain: "cruise" } })).toBe(0);
  });

  it("refuses the shared demo account a template write, and still lets it read", async () => {
    const template = await prisma.parserTemplate.create({
      data: {
        userId: demoUserId,
        domain: "flight",
        name: "Demo template",
        status: "pending",
        fingerprint: {} as unknown as object,
        patterns: {} as unknown as object,
      },
    });

    const read = await request(app)
      .get("/api/v1/parser-templates")
      .set("Cookie", [`auth_token=${demoToken}`]);
    expect(read.status).toBe(200);

    const write = await request(app)
      .patch(`/api/v1/parser-templates/${template.id}`)
      .set("Cookie", [`auth_token=${demoToken}`])
      .send({ status: "disabled" });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");

    await prisma.parserTemplate.delete({ where: { id: template.id } });
  });
});
