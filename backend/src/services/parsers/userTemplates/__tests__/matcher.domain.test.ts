import { prisma } from "../../../../db";
import { findMatchingTemplate } from "../matcher";
import type { TemplateFingerprint } from "../types";

/**
 * forgejo#124, phase 1 — the trap the whole plan opens with.
 *
 * `ParserTemplate` has carried a `domain` column since it was created; the
 * matcher's query never used it, and nothing ever wrote a value other than the
 * `"flight"` default. So the omission cost nothing and was invisible — right
 * up until the workshop learns to derive a lodging template, at which point an
 * unfiltered query hands it to the FLIGHT parser, which reads its patterns as
 * flight numbers and airport codes.
 *
 * The fingerprint below is deliberately one that matches ANY text: if the
 * domain were not part of the query, every case here would find it.
 */
const MATCHES_ANYTHING: TemplateFingerprint = {
  senderDomains: [],
  subjectPatterns: [""],
  bodyMarkers: [],
};

describe("a workshop template is only offered for the domain it was derived for", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `template-domain-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    await prisma.parserTemplate.createMany({
      data: [
        {
          userId,
          domain: "flight",
          name: "A flight template",
          status: "active",
          fingerprint: MATCHES_ANYTHING as unknown as object,
          patterns: { flightNumber: "([A-Z]{2}\\d+)" } as unknown as object,
        },
        {
          userId,
          domain: "lodging",
          name: "A lodging template",
          status: "active",
          fingerprint: MATCHES_ANYTHING as unknown as object,
          patterns: { pnr: "(\\d{6,})" } as unknown as object,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("hands the flight parser its own template", async () => {
    const hit = await findMatchingTemplate(userId, "flight", "x@y.test", "subject", "body");
    expect(hit?.name).toBe("A flight template");
  });

  it("never hands the flight parser a lodging template, however well it matches", async () => {
    // Proof that the filter is the query and not the fingerprint: this
    // template matches any text at all, and the flight lookup above still
    // returned the other one.
    const hit = await findMatchingTemplate(userId, "lodging", "x@y.test", "subject", "body");
    expect(hit?.name).toBe("A lodging template");
  });

  it("offers nothing for a domain the user has no template for", async () => {
    expect(await findMatchingTemplate(userId, "cruise", "x@y.test", "subject", "body")).toBeNull();
    expect(await findMatchingTemplate(userId, "place", "x@y.test", "subject", "body")).toBeNull();
  });

  it("still ignores a template that is not active", async () => {
    await prisma.parserTemplate.updateMany({
      where: { userId, domain: "flight" },
      data: { status: "disabled" },
    });
    try {
      expect(await findMatchingTemplate(userId, "flight", "x@y.test", "s", "b")).toBeNull();
    } finally {
      await prisma.parserTemplate.updateMany({
        where: { userId, domain: "flight" },
        data: { status: "active" },
      });
    }
  });
});
