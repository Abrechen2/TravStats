import { describe, it, expect, jest, afterAll } from "@jest/globals";

const runSweep = jest.fn<(o: unknown) => Promise<unknown>>();
jest.mock("../../../jobs/dawarichCountryDaySweepScheduler", () => ({
  runDawarichCountryDaySweep: (o: unknown) => runSweep(o),
}));

import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { getJob, settleAllJobs } from "../../../services/jobs/jobRegistry";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";

/**
 * forgejo#397: "sweep now" used to hold the request for the whole sweep —
 * minutes — so the web client's timeout would have called a sweep that went on
 * and finished a failure. It starts a job instead, and a second click meets 409.
 */
describe("POST /api/v1/admin/dawarich/country-days/sweep", () => {
  const ids: string[] = [];
  afterAll(async () => {
    await settleAllJobs();
    for (const id of ids) await prisma.user.delete({ where: { id } }).catch(() => {});
  });
  const admin = async () => {
    const user = await prisma.user.create({
      data: {
        username: `sweep-job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: await hashPassword("pw"),
        isAdmin: true,
        isActive: true,
      },
    });
    ids.push(user.id);
    return { id: user.id, cookie: `auth_token=${generateToken(user.id)}` };
  };

  it("answers 202 with a job whose result is the sweep's, and refuses a second while running", async () => {
    const a = await admin();
    let finish!: (v: unknown) => void;
    runSweep.mockImplementationOnce(() => new Promise((r) => (finish = r)));

    const res = await request(app)
      .post("/api/v1/admin/dawarich/country-days/sweep")
      .set("Cookie", a.cookie)
      .send({});
    expect(res.status).toBe(202);

    const second = await request(app)
      .post("/api/v1/admin/dawarich/country-days/sweep")
      .set("Cookie", a.cookie)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("SWEEP_RUNNING");

    finish({ users: 1, failed: 0, degraded: 0, daysWritten: 4 });
    await settleAllJobs();
    const job = getJob(res.body.jobId, a.id);
    expect(job?.status).toBe("succeeded");
    expect(job?.result).toMatchObject({ users: 1, daysWritten: 4 });
  });

  it("reports a throwing sweep as a failed job, not as success", async () => {
    const a = await admin();
    runSweep.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app)
      .post("/api/v1/admin/dawarich/country-days/sweep")
      .set("Cookie", a.cookie)
      .send({});
    expect(res.status).toBe(202);
    await settleAllJobs();
    expect(getJob(res.body.jobId, a.id)?.status).toBe("failed");
  });
});
