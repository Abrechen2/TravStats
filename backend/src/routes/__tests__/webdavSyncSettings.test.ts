import { describe, it, expect, jest, beforeEach, afterAll } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";

/**
 * `/settings/webdav-sync` (forgejo#321): the password goes in and never comes
 * back out, a target this account may not reach is refused when saved, and a
 * clicked run that fails ends as a failed job with its reason — not as a 200.
 */

type Fn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const share = {
  createDirectory: jest.fn() as Fn,
  putFileContents: jest.fn() as Fn,
  customRequest: jest.fn() as Fn,
  deleteFile: jest.fn() as Fn,
};
jest.mock("webdav", () => ({ createClient: () => share }));

import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import { errorHandler } from "../../middleware/errorHandler";
import type { AuthRequest } from "../../middleware/auth";
import webdavSyncRouter from "../settings/webdavSync";
import { settleAllJobs, clearJobs, getJob } from "../../services/jobs/jobRegistry";

const userIds: string[] = [];

function appFor(userId: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: AuthRequest, _res: Response, next: NextFunction) => {
    req.userId = userId;
    next();
  });
  app.use("/settings/webdav-sync", webdavSyncRouter);
  app.use(errorHandler);
  return app;
}

async function makeUser(isAdmin = false): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `webdav-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: "x",
      isAdmin,
      isActive: true,
    },
  });
  userIds.push(user.id);
  return user.id;
}

const target = {
  url: "https://cloud.example.com/remote.php/dav/files/me/",
  username: "me",
  password: "s3cret-password",
};

beforeEach(() => {
  jest.clearAllMocks();
  clearJobs();
  share.createDirectory.mockResolvedValue(undefined);
  share.putFileContents.mockResolvedValue(true);
  // An empty folder: retention reads a PROPFIND answer naming only itself.
  share.customRequest.mockImplementation(
    async () =>
      new globalThis.Response(
        '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/TravStats/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>',
        { status: 207 }
      )
  );
  share.deleteFile.mockResolvedValue(undefined);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("/settings/webdav-sync", () => {
  it("answers defaults before anything is set", async () => {
    const res = await request(appFor(await makeUser())).get("/settings/webdav-sync");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: false,
      hasPassword: false,
      schedule: "daily",
      lastStatus: null,
      allowPrivateTargets: false,
    });
  });

  it("stores the password encrypted and never sends it back", async () => {
    const userId = await makeUser();
    const app = appFor(userId);
    const put = await request(app)
      .put("/settings/webdav-sync")
      .send({ ...target, enabled: true, schedule: "weekly", keepVersions: 3 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      enabled: true,
      url: "https://cloud.example.com/remote.php/dav/files/me",
      hasPassword: true,
      schedule: "weekly",
      keepVersions: 3,
    });
    expect(JSON.stringify(put.body)).not.toContain(target.password);
    const get = await request(app).get("/settings/webdav-sync");
    expect(JSON.stringify(get.body)).not.toContain(target.password);

    const row = await prisma.userWebdavSync.findUniqueOrThrow({ where: { userId } });
    expect(row.passwordEncrypted).not.toContain(target.password);
    expect(decryptApiKey(row.passwordEncrypted)).toBe(target.password);
  });

  it("keeps the stored password when a save leaves it out, and removes it on null", async () => {
    const userId = await makeUser();
    const app = appFor(userId);
    await request(app).put("/settings/webdav-sync").send(target);
    const kept = await request(app).put("/settings/webdav-sync").send({ username: "other" });
    expect(kept.body.hasPassword).toBe(true);
    const removed = await request(app).put("/settings/webdav-sync").send({ password: null });
    expect(removed.body.hasPassword).toBe(false);
  });

  it("refuses a LAN share for an ordinary account, and stores nothing", async () => {
    const userId = await makeUser();
    const res = await request(appFor(userId))
      .put("/settings/webdav-sync")
      .send({ ...target, url: "http://192.168.178.202/dav" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("blockedTarget");
    expect(await prisma.userWebdavSync.count({ where: { userId } })).toBe(0);
  });

  it("asks for https on a public share", async () => {
    const res = await request(appFor(await makeUser()))
      .put("/settings/webdav-sync")
      .send({ ...target, url: "http://cloud.example.com/dav" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("httpsRequired");
  });

  it("accepts a LAN share from an admin and says so", async () => {
    const res = await request(appFor(await makeUser(true)))
      .put("/settings/webdav-sync")
      .send({ ...target, url: "http://192.168.178.202/dav" });
    expect(res.status).toBe(200);
    expect(res.body.allowPrivateTargets).toBe(true);
  });

  it("refuses switching on without somewhere to go", async () => {
    const res = await request(appFor(await makeUser()))
      .put("/settings/webdav-sync")
      .send({ enabled: true, url: target.url });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  it.each([
    [{ schedule: "hourly" }],
    [{ keepVersions: 0 }],
    [{ remotePath: "/a/../etc" }],
    [{ remotePath: "relative" }],
    [{ isAdmin: true }],
  ])("refuses invalid input %j", async (body) => {
    const res = await request(appFor(await makeUser()))
      .put("/settings/webdav-sync")
      .send(body);
    expect(res.status).toBe(400);
  });

  it("runs as a job and shows the result on the page", async () => {
    const userId = await makeUser();
    const app = appFor(userId);
    await request(app)
      .put("/settings/webdav-sync")
      .send({ ...target, enabled: true });
    const run = await request(app).post("/settings/webdav-sync/run");
    expect(run.status).toBe(202);
    await settleAllJobs();
    expect(getJob(run.body.jobId, userId)).toMatchObject({ status: "succeeded" });
    const status = await request(app).get("/settings/webdav-sync");
    expect(status.body).toMatchObject({ lastStatus: "ok", lastErrorCode: null, running: false });
    expect(status.body.lastFileName).toMatch(/^travstats-export-/);
  });

  it("fails the job with the share's reason when the password is refused", async () => {
    const userId = await makeUser();
    const app = appFor(userId);
    await request(app)
      .put("/settings/webdav-sync")
      .send({ ...target, enabled: true });
    share.createDirectory.mockRejectedValue(Object.assign(new Error("401"), { status: 401 }));
    const run = await request(app).post("/settings/webdav-sync/run");
    await settleAllJobs();
    expect(getJob(run.body.jobId, userId)).toMatchObject({
      status: "failed",
      error: { code: "auth" },
    });
    const status = await request(app).get("/settings/webdav-sync");
    expect(status.body).toMatchObject({ lastStatus: "failed", lastErrorCode: "auth" });
  });

  it("will not start a run for a switched-off sync", async () => {
    const res = await request(appFor(await makeUser())).post("/settings/webdav-sync/run");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");
  });
});
