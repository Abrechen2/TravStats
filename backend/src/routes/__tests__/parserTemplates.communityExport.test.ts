import { randomUUID } from "crypto";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { generateToken } from "../../utils/jwt";
import { deriveFerryTemplate } from "../../services/parsers/userTemplates/rideDeriver";
import {
  FERRY_SELECTIONS,
  FERRY_SOURCE,
  FERRY_SUBJECT,
} from "../../services/parsers/userTemplates/__tests__/rideSamples";

/**
 * forgejo#309: GET /parser-templates/:id/community-export hands an ACTIVE v2
 * workshop template back as a repository file with GitHub's new-file page —
 * and refuses, with a code, what cannot be shared. Nothing leaves the server.
 */
describe("GET /api/v1/parser-templates/:id/community-export", () => {
  const userIds: string[] = [];
  let owner: string;
  let ownerId: string;
  let stranger: string;

  const create = async (username: string) => {
    const user = await prisma.user.create({ data: { username, passwordHash: "not-a-login" } });
    userIds.push(user.id);
    return user.id;
  };

  const template = async (data: Partial<Prisma.ParserTemplateUncheckedCreateInput>) =>
    (
      await prisma.parserTemplate.create({
        data: {
          userId: ownerId,
          domain: "ferry",
          name: "Inselfähren",
          status: "active",
          fingerprint: {},
          patterns: {},
          ...data,
        },
      })
    ).id;

  let ferryId: string;
  let pendingId: string;
  let lodgingId: string;
  let orphanSampleId: string;
  let orphanId: string;

  beforeAll(async () => {
    ownerId = await create(`share-owner-${randomUUID()}`);
    owner = `auth_token=${generateToken(ownerId)}`;
    stranger = `auth_token=${generateToken(await create(`share-other-${randomUUID()}`))}`;
    const sample = await prisma.trainingData.create({
      data: {
        userId: ownerId,
        domain: "ferry",
        type: "email",
        subject: FERRY_SUBJECT,
        originalFile: "synthetic-ferry.txt",
        annotations: { fullText: FERRY_SOURCE, textSelections: FERRY_SELECTIONS },
        extractedData: {},
      } as unknown as Prisma.TrainingDataUncheckedCreateInput,
    });
    const derived = deriveFerryTemplate({
      trainingDataId: sample.id,
      subject: FERRY_SUBJECT,
      fullText: FERRY_SOURCE,
      selections: FERRY_SELECTIONS,
    });
    if (!derived.ok) throw new Error(derived.refusal);
    const patterns = derived.template as unknown as Prisma.InputJsonValue;
    ferryId = await template({ patterns, sourceId: sample.id });
    pendingId = await template({ patterns, status: "pending" });
    lodgingId = await template({ domain: "lodging" });

    // A template whose subject anchor carries a marked booking reference: the
    // scan only knows it is personal while the marked sample still exists.
    const orphanSample = await prisma.trainingData.create({
      data: {
        userId: ownerId,
        domain: "ferry",
        type: "email",
        subject: FERRY_SUBJECT,
        originalFile: "synthetic-ferry.txt",
        annotations: {
          fullText: FERRY_SOURCE,
          textSelections: [...FERRY_SELECTIONS, { label: "bookingReference", text: "ab12cd" }],
        },
        extractedData: {},
      } as unknown as Prisma.TrainingDataUncheckedCreateInput,
    });
    orphanSampleId = orphanSample.id;
    const withRef = {
      ...derived.template,
      match: {
        ...derived.template.match,
        anchors: [...derived.template.match.anchors, "Ihre Buchung ab12cd"],
      },
    } as unknown as Prisma.InputJsonValue;
    orphanId = await template({ patterns: withRef, sourceId: orphanSample.id });
  });

  afterAll(async () => {
    await prisma.parserTemplate.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.trainingData.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const get = (id: string, cookie: string) =>
    request(app).get(`/api/v1/parser-templates/${id}/community-export`).set("Cookie", cookie);

  it("hands back the repository file and the GitHub page to propose it on", async () => {
    const res = await get(ferryId, owner);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      domain: "ferry",
      filename: "buchungsbestatigung-inselfahren-probesee.json",
      githubUrl:
        "https://github.com/Abrechen2/travstats-templates/new/main/ferry?filename=buchungsbestatigung-inselfahren-probesee.json",
      removed: [],
      template: {
        id: "ferry:buchungsbestatigung-inselfahren-probesee",
        domain: "ferry",
        testCases: [],
      },
    });
    expect(JSON.stringify(res.body.template)).not.toContain("IPS884213");
  });

  it("refuses a template whose preview has not made it active", async () => {
    const res = await get(pendingId, owner);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEMPLATE_EXPORT_NOT_ACTIVE");
  });

  it("refuses a kind the repository does not take", async () => {
    const res = await get(lodgingId, owner);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TEMPLATE_EXPORT_UNSUPPORTED");
  });

  it("refuses a template whose marked sample was deleted, instead of exporting unscanned values", async () => {
    const before = await get(orphanId, owner);
    expect(before.status).toBe(200);
    expect(JSON.stringify(before.body.template)).not.toContain("ab12cd");

    await prisma.trainingData.delete({ where: { id: orphanSampleId } });
    const after = await get(orphanId, owner);
    expect(JSON.stringify(after.body.template ?? {})).not.toContain("ab12cd");
    expect(after.status).toBe(422);
    expect(after.body.code).toBe("TEMPLATE_EXPORT_SOURCE_MISSING");
  });

  it("answers someone else's template as not found", async () => {
    expect((await get(ferryId, stranger)).status).toBe(404);
  });
});
