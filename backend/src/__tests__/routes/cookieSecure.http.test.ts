/**
 * A fresh install reached over plain http must be able to sign in.
 *
 * 2.6.2 shipped `COOKIE_SECURE: ${COOKIE_SECURE:-}` in docker-compose.prod.yml,
 * which hands the container an EMPTY string when the user sets nothing, and
 * `getCookieSecure` read "" as "secure". Setup and login both answered 200 with
 * `Set-Cookie: auth_token=…; Secure`, the browser dropped that cookie on an
 * http://192.168.x.x origin, and every following request said
 * "No token provided" — the admin could never get in. localhost hid it,
 * because browsers treat localhost as a secure context.
 *
 * These tests run the real routes in production mode and read the header the
 * browser reads, then make the next request the browser would make.
 */
const ORIGINAL_STATS_ENDPOINT = process.env.TRAVSTATS_STATS_ENDPOINT;
// No usage-stats ping may leave the test (see setup.usageStats.test.ts).
process.env.TRAVSTATS_STATS_ENDPOINT = "";

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

const ORIGINAL_COOKIE_SECURE = process.env.COOKIE_SECURE;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const PASSWORD = "password123";

function setCookieSecure(value: string | undefined): void {
  if (value === undefined) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = value;
}

function authCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = (raw ?? []).find((c) => c.startsWith("auth_token="));
  if (!cookie) throw new Error(`no auth_token cookie in ${JSON.stringify(raw)}`);
  return cookie;
}

function isSecure(cookie: string): boolean {
  return cookie
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .includes("secure");
}

describe("session cookie over plain http (COOKIE_SECURE from compose)", () => {
  let username = "";

  beforeAll(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.adminSettings.deleteMany();
  });

  beforeEach(() => {
    // The Docker image runs in production; auto-detect only happens there.
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    setCookieSecure(ORIGINAL_COOKIE_SECURE);
  });

  afterAll(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.adminSettings.deleteMany();
    await prisma.$disconnect();
    if (ORIGINAL_STATS_ENDPOINT === undefined) delete process.env.TRAVSTATS_STATS_ENDPOINT;
    else process.env.TRAVSTATS_STATS_ENDPOINT = ORIGINAL_STATS_ENDPOINT;
  });

  it('COOKIE_SECURE="" over http: setup and login set a cookie without Secure, and the session works', async () => {
    setCookieSecure("");
    username = `cookie-secure-${Date.now()}`;

    // Setup wizard — the first thing a new user does.
    const setupAgent = request.agent(app);
    const setup = await setupAgent
      .post("/api/v1/setup/initialize")
      .send({ username, password: PASSWORD })
      .expect(200);
    expect(isSecure(authCookie(setup))).toBe(false);
    // The request right after setup is what failed in 2.6.2.
    await setupAgent.get("/api/v1/auth/me").expect(200);

    // A later sign-in from a fresh browser.
    const loginAgent = request.agent(app);
    const login = await loginAgent
      .post("/api/v1/auth/login")
      .send({ username, password: PASSWORD })
      .expect(200);
    expect(isSecure(authCookie(login))).toBe(false);
    const me = await loginAgent.get("/api/v1/auth/me").expect(200);
    expect(me.body.user?.username ?? me.body.username).toBe(username);
  });

  it('COOKIE_SECURE="  " (whitespace) over http is also auto-detect → no Secure', async () => {
    setCookieSecure("  ");
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username, password: PASSWORD })
      .expect(200);
    expect(isSecure(authCookie(login))).toBe(false);
  });

  it('COOKIE_SECURE="" behind a proxy that says X-Forwarded-Proto: https → Secure', async () => {
    setCookieSecure("");
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send({ username, password: PASSWORD })
      .expect(200);
    expect(isSecure(authCookie(login))).toBe(true);
  });

  it('COOKIE_SECURE="false" is never Secure, even behind https', async () => {
    setCookieSecure("false");
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send({ username, password: PASSWORD })
      .expect(200);
    expect(isSecure(authCookie(login))).toBe(false);
  });

  it('COOKIE_SECURE="true" is always Secure, even over http', async () => {
    setCookieSecure("true");
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username, password: PASSWORD })
      .expect(200);
    expect(isSecure(authCookie(login))).toBe(true);
  });
});
