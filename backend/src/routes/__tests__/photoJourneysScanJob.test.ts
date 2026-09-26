import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * The photo-journey scan as a background job (silent-failure fixes,
 * 2026-09-26). Forty seconds is the scan's floor (Immich pages, then
 * Nominatim at one request a second) and the web client gave up after ten:
 * it said "scan failed" while the server stored its findings. With
 * `background: true` the route answers 202 and the job carries the answer
 * the synchronous call gives.
 *
 * The scan itself is stubbed — this file is about the handle, not the
 * clustering — and no test reaches the network.
 */

let releaseScan: ((value: unknown) => void) | null = null;
let failScan: ((err: Error) => void) | null = null;

jest.mock("../../services/photoJourneys/scan", () => ({
  ...jest.requireActual("../../services/photoJourneys/scan"),
  scanPhotoJourneys: jest.fn(
    () =>
      new Promise((resolve, reject) => {
        releaseScan = resolve;
        failScan = reject;
      })
  ),
}));

describe("POST /photo-journeys/scan with background: true", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "photo-scan-job" } });
    const user = await prisma.user.create({
      data: { username: "photo-scan-job", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(() => clearJobs());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const job = async (jobId: string) =>
    (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie)).body.data;

  it("answers 202 at once; the job runs, then carries the scan's counts", async () => {
    const res = await request(app)
      .post("/api/v1/photo-journeys/scan")
      .set("Cookie", cookie)
      .send({ background: true });

    expect(res.status).toBe(202);
    const { jobId } = res.body.data;
    expect((await job(jobId)).status).toBe("running");

    releaseScan!({ kind: "scanned", photosSeen: 1200, truncated: false, created: 3, updated: 1 });
    await settleAllJobs();
    expect(await job(jobId)).toMatchObject({
      status: "succeeded",
      result: { scanned: true, photosSeen: 1200, created: 3, updated: 1 },
    });
  });

  it("a scan that throws fails its job instead of vanishing", async () => {
    const res = await request(app)
      .post("/api/v1/photo-journeys/scan")
      .set("Cookie", cookie)
      .send({ background: true });

    failScan!(new Error("Immich answered 502"));
    await settleAllJobs();
    expect(await job(res.body.data.jobId)).toMatchObject({
      status: "failed",
      error: { code: "JOB_FAILED", status: 500 },
    });
  });
});
