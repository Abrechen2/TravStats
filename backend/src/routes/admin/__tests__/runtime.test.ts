import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { slowQueries } from "../../../services/runtime/slowLog";
import {
  __resetPingCacheForTests,
  startRuntimeMonitor,
  stopRuntimeMonitor,
} from "../../../services/runtime/runtimeStats";

/**
 * Perf audit 2026-11, item 4: the 24.11 incident read "load 15, unknown why".
 * The admin runtime report names the cause; /health says only two words.
 */
describe("GET /api/v1/admin/runtime and the /health checks", () => {
  const ids: string[] = [];
  let adminCookie = "";
  let userCookie = "";

  const makeUser = async (isAdmin: boolean) => {
    const user = await prisma.user.create({
      data: {
        username: `runtime-test-${isAdmin ? "admin" : "user"}-${Date.now()}-${Math.random()}`,
        passwordHash: await hashPassword("pw-123456"),
        isAdmin,
        isActive: true,
      },
    });
    ids.push(user.id);
    return `auth_token=${generateToken(user.id)}`;
  };

  beforeAll(async () => {
    startRuntimeMonitor();
    adminCookie = await makeUser(true);
    userCookie = await makeUser(false);
  });

  afterAll(async () => {
    stopRuntimeMonitor();
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("refuses a non-admin", async () => {
    const res = await request(app).get("/api/v1/admin/runtime").set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("reports memory, the pool, the ping, the slots and pg_stat_statements' state", async () => {
    const res = await request(app).get("/api/v1/admin/runtime").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.memory.heapLimitMb).toBeGreaterThan(0);
    expect(res.body.memory.rssMb).toBeGreaterThan(0);
    expect(res.body.database.ping.ok).toBe(true);
    expect(res.body.database.pool).toMatchObject({
      max: expect.any(Number),
      total: expect.any(Number),
    });
    expect(["available", "notInstalled", "notLoaded"]).toContain(
      res.body.database.statements.status
    );
    expect(res.body.jobs.heavySlot).toEqual({ running: null, waiting: [] });
    expect(res.body.jobs.importWriteSlot).toEqual({ held: 0, waiting: 0 });
  });

  it("records a query over 500 ms in the slow-query list", async () => {
    await prisma.$queryRawUnsafe("SELECT pg_sleep(0.6)::text");
    expect(
      slowQueries.recent().some((e) => e.key === "$queryRawUnsafe" && e.durationMs >= 500)
    ).toBe(true);
  });

  it("answers /health with the database and loop checks as words, no figures", async () => {
    __resetPingCacheForTests();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe("ok");
    expect(["ok", "pending"]).toContain(res.body.checks.eventLoop);
    expect(JSON.stringify(res.body)).not.toMatch(/latency|heap|rss|pool/i);
  });
});
