import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * The spreadsheet import as a background job (silent-failure fixes,
 * 2026-09-26). The web client gave up after ten seconds while a large sheet
 * — a currency lookup per priced row, a full backup before a `replace` — was
 * still being written, and told the user the import failed. With
 * `background: true` the route answers 202 and the job carries the outcome
 * the synchronous call would have sent, or the refusal's code.
 */

jest.mock("../../services/backupService", () => ({
  ...jest.requireActual("../../services/backupService"),
  createBackup: jest.fn(async () => {
    throw new Error("disk full");
  }),
}));

describe("POST /xlsx-import with background: true", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "xlsx-job-user" } });
    const user = await prisma.user.create({
      data: {
        username: "xlsx-job-user",
        passwordHash: await hashPassword("password123"),
        isActive: true,
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(() => clearJobs());

  afterAll(async () => {
    await settleAllJobs();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const job = async (jobId: string) =>
    (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie)).body.data;

  it("answers 202 with a job whose result is the preview", async () => {
    const res = await request(app)
      .post("/api/v1/xlsx-import")
      .set("Cookie", cookie)
      .send({ dryRun: true, background: true, sheets: [{ key: "places", rows: [{}] }] });

    expect(res.status).toBe(202);
    await settleAllJobs();
    const done = await job(res.body.data.jobId);
    expect(done.status).toBe("succeeded");
    expect(done.result).toMatchObject({ dryRun: true, mode: "merge" });
    expect(Array.isArray(done.result.sheets)).toBe(true);
  });

  it("a replace whose safety backup fails fails the job with backup_failed, writing nothing", async () => {
    const res = await request(app)
      .post("/api/v1/xlsx-import")
      .set("Cookie", cookie)
      .send({
        dryRun: false,
        mode: "replace",
        background: true,
        sheets: [{ key: "places", rows: [{}] }],
      });

    expect(res.status).toBe(202);
    await settleAllJobs();
    expect(await job(res.body.data.jobId)).toMatchObject({
      status: "failed",
      error: { code: "backup_failed", status: 503 },
    });
  });

  it("without the flag the call stays synchronous, for scripts that rely on it", async () => {
    const res = await request(app)
      .post("/api/v1/xlsx-import")
      .set("Cookie", cookie)
      .send({ dryRun: true, sheets: [{ key: "places", rows: [{}] }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dryRun: true });
  });
});
