import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** supertest buffers an image/* body into `res.body` and leaves `res.text` empty. */
const svgText = (res: request.Response): string => res.text ?? Buffer.from(res.body).toString("utf8");

/**
 * forgejo#91 — country flags for the Companion, served from the vendored
 * `flag-icons` package. The contract these pin: SVG with a day-long private
 * cache and a strong ETag, 304 on a matching tag, a cacheable 404 for a code
 * with no flag, 400 before the filesystem is touched for anything that is not
 * two letters, and a batch that lists its misses instead of failing.
 */
describe("GET /api/v1/country-flags", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "countryflagtest" } });
    const user = await prisma.user.create({
      data: { username: "countryflagtest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe("/:iso", () => {
    it("401 without auth", async () => {
      const res = await request(app).get("/api/v1/country-flags/DE");
      expect(res.status).toBe(401);
    });

    it("200 with SVG, a private day-long cache and a strong ETag for DE", async () => {
      const res = await request(app).get("/api/v1/country-flags/DE").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/svg+xml");
      expect(res.headers["cache-control"]).toBe("private, max-age=86400");
      expect(res.headers["etag"]).toMatch(/^"[0-9a-f]{40}"$/);
      expect(svgText(res)).toContain("<svg");
      expect(svgText(res)).toContain('viewBox="0 0 640 480"'); // the 4x3 file
    });

    it("is case-insensitive and serves the 1x1 file for variant=square", async () => {
      const res = await request(app)
        .get("/api/v1/country-flags/de?variant=square")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(svgText(res)).toContain('viewBox="0 0 512 512"');
    });

    it("304 on a matching If-None-Match", async () => {
      const first = await request(app).get("/api/v1/country-flags/DE").set("Cookie", authCookie);
      const res = await request(app)
        .get("/api/v1/country-flags/DE")
        .set("Cookie", authCookie)
        .set("If-None-Match", first.headers["etag"]);
      expect(res.status).toBe(304);
      expect(res.headers["etag"]).toBe(first.headers["etag"]);
      expect(res.text ?? "").toBe("");
    });

    it("200 again when the tag does not match", async () => {
      const res = await request(app)
        .get("/api/v1/country-flags/DE")
        .set("Cookie", authCookie)
        .set("If-None-Match", '"stale"');
      expect(res.status).toBe(200);
    });

    it("404 unknown_country for a well-formed code with no flag, and the 404 is cacheable", async () => {
      const res = await request(app).get("/api/v1/country-flags/ZZ").set("Cookie", authCookie);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "unknown_country" });
      expect(res.headers["cache-control"]).toBe("private, max-age=86400");
    });

    it("400 for anything that is not two ASCII letters (no path traversal)", async () => {
      for (const bad of ["..%2Fde", "%2E%2E%2F%2E%2E%2Fpackage", "d", "deu", "d1", "%C3%A9e"]) {
        const res = await request(app).get(`/api/v1/country-flags/${bad}`).set("Cookie", authCookie);
        expect([bad, res.status]).toEqual([bad, 400]);
      }
    });

    it("400 for an unknown variant", async () => {
      const res = await request(app)
        .get("/api/v1/country-flags/DE?variant=round")
        .set("Cookie", authCookie);
      expect(res.status).toBe(400);
    });
  });

  describe("batch", () => {
    it("401 without auth", async () => {
      const res = await request(app).get("/api/v1/country-flags?codes=DE");
      expect(res.status).toBe(401);
    });

    it("returns known flags inline and lists the unknown code under missing", async () => {
      const res = await request(app)
        .get("/api/v1/country-flags?codes=de,ZZ&variant=flat")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.headers["cache-control"]).toBe("private, max-age=86400");
      expect(res.headers["etag"]).toMatch(/^"[0-9a-f]{40}"$/);
      expect(Object.keys(res.body.flags)).toEqual(["DE"]);
      expect(res.body.flags.DE).toContain("<svg");
      expect(res.body.missing).toEqual(["ZZ"]);
    });

    it("304 on a matching If-None-Match", async () => {
      const first = await request(app).get("/api/v1/country-flags?codes=DE,FR").set("Cookie", authCookie);
      const res = await request(app)
        .get("/api/v1/country-flags?codes=DE,FR")
        .set("Cookie", authCookie)
        .set("If-None-Match", first.headers["etag"]);
      expect(res.status).toBe(304);
    });

    it("400 when codes is missing, empty, malformed or over 250 entries", async () => {
      const tooMany = Array.from({ length: 251 }, () => "DE").join(",");
      for (const query of ["", "?codes=", "?codes=DE,../fr", "?codes=DEU", `?codes=${tooMany}`]) {
        const res = await request(app).get(`/api/v1/country-flags${query}`).set("Cookie", authCookie);
        expect([query.slice(0, 20), res.status]).toEqual([query.slice(0, 20), 400]);
      }
    });

    it("accepts exactly 250 codes, deduplicated", async () => {
      const codes = Array.from({ length: 250 }, () => "DE").join(",");
      const res = await request(app).get(`/api/v1/country-flags?codes=${codes}`).set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.flags)).toEqual(["DE"]);
    });
  });
});
