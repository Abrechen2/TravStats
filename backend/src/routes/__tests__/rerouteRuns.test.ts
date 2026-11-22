import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { resetProviderBudget } from "../../services/tour/routing/providerBudget";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * forgejo#436 over HTTP: who may start, read and cancel a bulk re-route, and
 * what the caller is told when routing is not configured or a run is going.
 */
describe("bulk re-route endpoints", () => {
  let adminCookie: string;
  let userCookie: string;
  let strangerCookie: string;
  let userId: string;
  let routeId: string;
  const ids: string[] = [];
  let settingsId: number;

  const configure = (routingProvider: string | null, routingCustomUrl: string | null) =>
    prisma.adminSettings.update({
      where: { id: settingsId },
      data: { routingProvider, routingCustomUrl },
    });

  beforeAll(async () => {
    const make = async (username: string, isAdmin = false) => {
      const u = await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123"), isAdmin },
      });
      ids.push(u.id);
      return u;
    };
    await prisma.user.deleteMany({ where: { username: { startsWith: "rrun-" } } });
    const admin = await make("rrun-admin", true);
    const user = await make("rrun-user");
    const stranger = await make("rrun-stranger");
    userId = user.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    routeId = (
      await prisma.tripRoute.create({
        data: { userId, name: "Nord", mode: "road", kind: "roadtrip" },
      })
    ).id;
    const settings =
      (await prisma.adminSettings.findFirst()) ?? (await prisma.adminSettings.create({ data: {} }));
    settingsId = settings.id;
  });
  beforeEach(async () => {
    resetProviderBudget();
    clearJobs();
    await configure(null, null);
  });
  afterEach(async () => {
    await settleAllJobs();
    await prisma.rerouteRun.deleteMany({ where: { userId: { in: ids } } });
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await configure(null, null);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  const startAdmin = (who = adminCookie, body: object = {}) =>
    request(app)
      .post("/api/v1/admin/instance-settings/routing/reroute")
      .set("Cookie", who)
      .send(body);
  const startUser = () =>
    request(app).post(`/api/v1/tours/${routeId}/reroute-all`).set("Cookie", userCookie).send({});

  it("refuses a non-admin", async () => {
    const res = await startAdmin(userCookie);
    expect(res.status).toBe(403);
  });

  it("answers 409 notConfigured when no provider is usable, instead of a run that fails every leg", async () => {
    const res = await startAdmin();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("notConfigured");
    expect(await prisma.rerouteRun.count({ where: { userId: { in: ids } } })).toBe(0);
  });

  it("starts a run, reports it as the latest, and refuses a second while it is active", async () => {
    await configure("custom", "http://osrm.invalid");
    // The run is created `running` and walked by a job; hold it paused so the
    // second start meets an ACTIVE run deterministically.
    const first = await startAdmin(adminCookie, { mode: "all" });
    expect(first.status).toBe(202);
    expect(first.body.run).toMatchObject({ scope: "instance", mode: "all" });
    await settleAllJobs();
    await prisma.rerouteRun.update({
      where: { id: first.body.run.id },
      data: { status: "paused" },
    });

    const second = await startAdmin();
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "alreadyActive", run: { id: first.body.run.id } });

    const latest = await request(app)
      .get("/api/v1/admin/instance-settings/routing/reroute")
      .set("Cookie", adminCookie);
    expect(latest.body.run.id).toBe(first.body.run.id);

    const cancelled = await request(app)
      .post(`/api/v1/admin/instance-settings/routing/reroute/${first.body.run.id}/cancel`)
      .set("Cookie", adminCookie);
    expect(cancelled.body.run.status).toBe("cancelled");
  });

  it("two starts arriving together create one run, not two workers on the same quota", async () => {
    await configure("custom", "http://osrm.invalid");
    const [a, b] = await Promise.all([startAdmin(), startAdmin()]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await settleAllJobs();
    expect(
      await prisma.rerouteRun.count({ where: { scope: "instance", userId: { in: ids } } })
    ).toBe(1);
  });

  it("a user starts a run for their own roadtrip; a stranger can neither start, read nor cancel it", async () => {
    await configure("custom", "http://osrm.invalid");
    const started = await startUser();
    expect(started.status).toBe(202);
    expect(started.body.run).toMatchObject({ scope: "roadtrip", routeId, mode: "all" });
    const runId = started.body.run.id as string;
    await settleAllJobs();

    const latest = await request(app)
      .get(`/api/v1/tours/${routeId}/reroute-all`)
      .set("Cookie", userCookie);
    expect(latest.body.run.id).toBe(runId);
    const foreign = await request(app)
      .post(`/api/v1/tours/${routeId}/reroute-all`)
      .set("Cookie", strangerCookie)
      .send({});
    expect(foreign.status).toBe(404);
    const read = (who: string) =>
      request(app).get(`/api/v1/routing-runs/${runId}`).set("Cookie", who);
    expect((await read(strangerCookie)).status).toBe(404);
    expect((await read(userCookie)).body.run.id).toBe(runId);
    const cancel = await request(app)
      .post(`/api/v1/routing-runs/${runId}/cancel`)
      .set("Cookie", strangerCookie)
      .send({});
    expect(cancel.status).toBe(404);
  });
});
