import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { generateToken } from "../../utils/jwt";

/**
 * #358: `POST /place-import/resolve` answers 202 with a job at once — a few
 * hundred Google lookups outlast the browser's request — and the job's result
 * carries a reason for every answer it could not give.
 *
 * No key is configured and the list names no country, so nothing here can
 * reach the network: the CID step says `no_key`, the name search `no_country`.
 */
jest.mock("../../services/apiKeyResolver", () => ({
  ...jest.requireActual("../../services/apiKeyResolver"),
  getApiKey: jest.fn(async () => null),
}));

describe("POST /api/v1/place-import/resolve", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `resolve-route-${Date.now()}`,
        passwordHash: "x",
        isActive: true,
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(() => clearJobs());

  afterAll(async () => {
    await settleAllJobs().catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("starts a job whose result explains every missing answer", async () => {
    const started = await request(app)
      .post("/api/v1/place-import/resolve")
      .set("Cookie", cookie)
      .send({
        listName: "Gespeicherte Orte",
        rows: [{ sourceRowIndex: 0, name: "Invented Café", externalRef: "gmaps:42" }],
      });

    expect(started.status).toBe(202);
    const { jobId } = started.body.data;
    await settleAllJobs();

    const job = await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie);
    expect(job.body.data).toMatchObject({
      kind: "placeImport.resolve",
      status: "succeeded",
      progress: { done: 1, total: 1 },
      result: {
        listCountry: null,
        trip: null,
        tripReason: "no_country",
        googleConfigured: false,
        rows: [
          {
            sourceRowIndex: 0,
            position: null,
            cidReason: "no_key",
            positionReason: "no_country",
            suggestedTreatment: "place",
          },
        ],
      },
    });
  });

  it("refuses an empty list", async () => {
    const res = await request(app)
      .post("/api/v1/place-import/resolve")
      .set("Cookie", cookie)
      .send({ listName: null, rows: [] });
    expect(res.status).toBe(400);
  });
});
