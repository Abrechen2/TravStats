import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import { app } from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { isReservedUsername, RESERVED_USERNAMES } from "../../schemas/auth";

/**
 * Data-integrity audit 2026-09-19, finding 1 — the other half.
 *
 * `seedDemoAccount.ts` now refuses to reset an account named `demo` that is
 * not flagged `isDemo`, so nobody loses their rows to a boot. That leaves the
 * collision itself: an instance with a real user called `demo` simply has no
 * demo account until an administrator renames them. Reserving the name closes
 * that, and it has to be closed on BOTH doors — the register form and the
 * admin create-user endpoint, which is the path an admin-scope PAT uses.
 *
 * The response carries `code`, not just prose. `RegisterPage.tsx` renders the
 * backend's `details[0].message` verbatim, so a Zod refinement here would have
 * printed an English sentence into a German page — the failure forgejo#88
 * finding 3 removed from the login form. A code is what a client branches on.
 */
const ADMIN = "reserved-name-admin";
const PASSWORD = "password123";

let adminToken = "";

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: ADMIN } });
  const admin = await prisma.user.create({
    data: { username: ADMIN, passwordHash: await hashPassword(PASSWORD), isAdmin: true },
  });
  adminToken = generateToken(admin.id);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: ADMIN } });
});

describe("the reserved-username list", () => {
  it("names `demo`, case-insensitively and ignoring surrounding space", () => {
    expect(RESERVED_USERNAMES).toContain("demo");
    for (const spelling of ["demo", "Demo", "DEMO", " demo "]) {
      expect(isReservedUsername(spelling)).toBe(true);
    }
    // Postgres treats these as distinct rows, and so does the check: they are
    // different names, not spellings of a reserved one.
    for (const other of ["demos", "demo1", "mydemo"]) {
      expect(isReservedUsername(other)).toBe(false);
    }
  });
});

describe("POST /auth/register", () => {
  it("refuses a reserved username with a code the form can translate", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "DEMO", password: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("USERNAME_RESERVED");
    expect(await prisma.user.count({ where: { username: "DEMO" } })).toBe(0);
  });
});

describe("POST /admin/users", () => {
  it("refuses a reserved username there too", async () => {
    const res = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", [`auth_token=${adminToken}`])
      .send({ username: "Demo", password: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("USERNAME_RESERVED");
    expect(await prisma.user.count({ where: { username: "Demo" } })).toBe(0);
  });
});
