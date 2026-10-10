import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { derivePackageTemplate } from "../../services/parsers/userTemplates/packageDeriver";
import {
  PACKAGE_HELD_OUT,
  PACKAGE_SELECTIONS,
  PACKAGE_SOURCE,
  PACKAGE_SUBJECT,
} from "../../services/parsers/userTemplates/__tests__/packageSamples";

/**
 * forgejo#124 — a package template from the workshop is used by the package
 * parse, after the repository's, and by auto-detection — for the user who
 * made it and nobody else. The template is derived for real; the documents
 * are invented.
 */
describe("a workshop package template in the parse routes", () => {
  let userId: string;
  let otherId: string;
  const cookieOf = (id: string): string => `auth_token=${generateToken(id)}`;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["pkgwork", "pkgother"] } } });
    userId = (await prisma.user.create({ data: { username: "pkgwork", passwordHash: "x" } })).id;
    otherId = (await prisma.user.create({ data: { username: "pkgother", passwordHash: "x" } })).id;
    const derived = derivePackageTemplate({
      trainingDataId: "td-package-route",
      subject: PACKAGE_SUBJECT,
      fullText: PACKAGE_SOURCE,
      selections: PACKAGE_SELECTIONS,
    });
    if (!derived.ok) throw new Error(`derivation refused: ${derived.refusal}`);
    await prisma.parserTemplate.create({
      data: {
        userId,
        domain: "package",
        name: "Sonnenfern",
        status: "active",
        fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
        patterns: derived.template as unknown as object,
      },
    });
  });

  afterAll(async () => {
    await prisma.parserTemplate.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  const parse = (id: string, domain: string) =>
    request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookieOf(id))
      .send({ emailContent: PACKAGE_HELD_OUT, subject: PACKAGE_SUBJECT, domain });

  it("reads the operator's next booking with the user's template", async () => {
    const res = await parse(userId, "package");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      domain: "package",
      parserUsed: "template",
      template: { id: "package:user-td-package-route" },
      package: { bookingReference: "SF-219930" },
    });
    expect(res.body.package.flights).toHaveLength(3);
  });

  it("is recognised by auto-detection for its owner only", async () => {
    const own = await parse(userId, "auto");
    expect(own.body).toMatchObject({ domain: "package", domainSource: "detected" });
    const other = await parse(otherId, "auto");
    expect(other.body.domain).not.toBe("package");
  });

  it("is never used for another account", async () => {
    const res = await parse(otherId, "package");
    expect(res.body).toMatchObject({ package: null, fallbackCode: "noTemplate" });
  });
});
