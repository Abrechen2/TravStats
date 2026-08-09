import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

/**
 * Every API response is no-store by default. UAT on the public beta caught
 * Cloudflare caching GET /api/v1/auth/passkeys — a per-user endpoint — in a
 * shared 4-hour edge cache, because the origin sent no Cache-Control at all.
 * A shared cache on a private response can hand one user's data to another.
 *
 * The rule is default-deny: handlers that genuinely cache opt in with an
 * explicit `private, max-age=…`, which also keeps them out of shared caches.
 */
describe("API responses are uncacheable by default", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "noStoreUser" } });
    const user = await prisma.user.create({
      data: { username: "noStoreUser", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "noStoreUser" } });
  });

  it("sets no-store on an authenticated JSON GET", async () => {
    const res = await request(app).get("/api/v1/auth/passkeys").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("sets no-store on /auth/me", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // Even a public, unauthenticated API GET must not be shared-cacheable — the
  // point is that no CDN rule can ever retain an /api response by default.
  it("sets no-store on a public API GET", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // The opt-in override still works: the logo endpoint keeps its long private
  // cache, so this change costs nothing for the responses that should cache.
  it("lets a handler override with an explicit private cache", async () => {
    const res = await request(app)
      .get("/api/v1/airline-logos/LH?variant=icon")
      .set("Cookie", cookie);
    expect(res.headers["cache-control"]).toContain("max-age=604800");
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["cache-control"]).not.toContain("no-store");
  });
});
