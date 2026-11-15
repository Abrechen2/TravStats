import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import {
  LOGIN_LOCK_MAX_MS,
  LOGIN_LOCK_THRESHOLD,
  lockDurationMs,
  throttleKey,
} from "../../services/auth/loginThrottle";

/**
 * forgejo#415 N3: per-account login backoff, independent of the per-IP limiter.
 * Every request here comes from one address, so the only thing that can tell
 * the two accounts apart is the per-account counter.
 */
const VICTIM = "throttle-victim-415";
const BYSTANDER = "throttle-bystander-415";
const PASSWORD = "password123";

const login = (username: string, password: string) =>
  request(app).post("/api/v1/auth/login").send({ username, password });

describe("per-account login backoff", () => {
  beforeAll(async () => {
    for (const username of [VICTIM, BYSTANDER]) {
      await prisma.user.deleteMany({ where: { username } });
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword(PASSWORD) },
      });
    }
  });

  beforeEach(async () => {
    await prisma.loginThrottle.deleteMany({});
  });

  afterAll(async () => {
    await prisma.loginThrottle.deleteMany({});
    await prisma.user.deleteMany({ where: { username: { in: [VICTIM, BYSTANDER] } } });
  });

  it("locks one account after repeated failures while another account still logs in", async () => {
    for (let i = 0; i < LOGIN_LOCK_THRESHOLD; i++) {
      const res = await login(VICTIM, "wrong-password");
      expect(res.status).toBe(401);
    }

    // Even the right password is refused inside the window, and says for how long.
    const locked = await login(VICTIM, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("RATE_LIMITED");
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.headers["set-cookie"]).toBeUndefined();

    const other = await login(BYSTANDER, PASSWORD);
    expect(other.status).toBe(200);
  });

  it("lets the account in again once the window has passed, and a success resets the streak", async () => {
    for (let i = 0; i < LOGIN_LOCK_THRESHOLD; i++) await login(VICTIM, "wrong-password");
    await prisma.loginThrottle.update({
      where: { usernameKey: throttleKey(VICTIM) },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const ok = await login(VICTIM, PASSWORD);
    expect(ok.status).toBe(200);
    expect(
      await prisma.loginThrottle.findUnique({ where: { usernameKey: throttleKey(VICTIM) } })
    ).toBeNull();
  });

  it("does not lock on fewer failures than the threshold, and a success clears them", async () => {
    for (let i = 0; i < LOGIN_LOCK_THRESHOLD - 1; i++) await login(VICTIM, "wrong-password");
    expect((await login(VICTIM, PASSWORD)).status).toBe(200);
    // The streak restarted: another threshold-1 failures still do not lock.
    for (let i = 0; i < LOGIN_LOCK_THRESHOLD - 1; i++) await login(VICTIM, "wrong-password");
    expect((await login(VICTIM, PASSWORD)).status).toBe(200);
  });

  it("counts a case variant of the name against the same account, and unknown names too", async () => {
    for (let i = 0; i < LOGIN_LOCK_THRESHOLD; i++) await login(VICTIM.toUpperCase(), "wrong");
    expect((await login(VICTIM, PASSWORD)).status).toBe(429);

    for (let i = 0; i < LOGIN_LOCK_THRESHOLD; i++) await login("no-such-user-415", "wrong");
    // Same answer as for a real locked account: the lock does not reveal existence.
    expect((await login("no-such-user-415", "wrong")).status).toBe(429);
  });

  it("bounds the lock window so an attacker cannot lock a user out for good", () => {
    expect(lockDurationMs(LOGIN_LOCK_THRESHOLD - 1)).toBe(0);
    expect(lockDurationMs(LOGIN_LOCK_THRESHOLD)).toBeGreaterThan(0);
    expect(lockDurationMs(LOGIN_LOCK_THRESHOLD + 1)).toBeGreaterThan(
      lockDurationMs(LOGIN_LOCK_THRESHOLD)
    );
    expect(lockDurationMs(10_000)).toBe(LOGIN_LOCK_MAX_MS);
  });
});
