import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { setLoggingRuntimeFlags } from "../../../utils/logging/runtimeFlags";
import { toLoggable } from "../../../utils/logging/toLoggable";

/**
 * Audit 2026-09-26, finding 1 (HIGH): with "log database queries" switched on,
 * POST /admin/users answered 500 and created nobody. The user-count lock
 * passes a BigInt key to `$executeRaw`, and the query log cloned arguments
 * with JSON.stringify — which throws on a BigInt, from inside the query.
 * Logging must never break the request it logs.
 */
describe("the database query log never breaks the query it logs", () => {
  const username = "queryLogBigIntNew";
  let adminId: string;
  let adminCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["queryLogAdmin", username] } } });
    const admin = await prisma.user.create({
      data: {
        username: "queryLogAdmin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    adminId = admin.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  afterEach(() => {
    setLoggingRuntimeFlags({
      httpRequests: false,
      databaseQueries: false,
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["queryLogAdmin", username] } } });
  });

  it("creates the user when query logging is on (the admin sees 201, not 500)", async () => {
    setLoggingRuntimeFlags({ httpRequests: false, databaseQueries: true });

    const res = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", adminCookie)
      .send({ username, password: "Password123!", isAdmin: false });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(username);
    expect(await prisma.user.count({ where: { username } })).toBe(1);
    expect(adminId).toBeDefined();
  });

  it("serialises what JSON.stringify cannot, instead of throwing", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const decimalLike = { toJSON: () => "12.50" };

    expect(
      toLoggable({
        big: BigInt("9007199254740993"),
        when: new Date("2026-09-26T10:00:00Z"),
        bytes: Buffer.from("abc"),
        price: decimalLike,
        cyclic,
        passwordHash: "secret",
      })
    ).toEqual({
      big: "9007199254740993",
      when: "2026-09-26T10:00:00.000Z",
      bytes: "[Buffer 3 bytes]",
      price: "12.50",
      cyclic: { name: "loop", self: "[Circular]" },
      passwordHash: "[REDACTED]",
    });
  });
});
