import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveOperatorMark } from "../../services/operatorLogos/operatorMarkService";

/**
 * forgejo#323: the operator-mark endpoints. The resolver is mocked — its
 * failure paths are driven in `operatorMark.test.ts` — so what is pinned here
 * is the HTTP contract: a credit the card can show, bytes that are inert and
 * `private` (never `public`: CLAUDE.md's /api no-store rule), a 404 the client
 * turns into a monogram, and a 400 for an unknown domain.
 */
jest.mock("../../services/operatorLogos/operatorMarkService", () => ({
  ...jest.requireActual("../../services/operatorLogos/operatorMarkService"),
  resolveOperatorMark: jest.fn(),
}));
const resolve = resolveOperatorMark as jest.MockedFunction<typeof resolveOperatorMark>;

const USERNAME = "operators-route-test";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const CREDIT = {
  qid: "Q833903",
  file: "Stena line logo.svg",
  licence: "Public domain",
  licenceUrl: null,
  artist: "Stena Line",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Stena_line_logo.svg",
  colour: null,
};

describe("/api/v1/operators", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  beforeEach(() => resolve.mockReset());

  it("requires a session", async () => {
    const res = await request(app).get("/api/v1/operators/mark?domain=ferry&name=Stena%20Line");
    expect(res.status).toBe(401);
  });

  it("answers the credit of a Commons logo, privately cached", async () => {
    resolve.mockResolvedValue({
      image: { body: PNG, contentType: "image/png" },
      source: "wikidata",
      credit: CREDIT,
    });
    const res = await request(app)
      .get("/api/v1/operators/mark?domain=ferry&name=Stena%20Line")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { available: true, source: "wikidata", credit: CREDIT },
    });
    expect(res.headers["cache-control"]).toMatch(/^private/);
    expect(resolve).toHaveBeenCalledWith("ferry", "Stena Line");
  });

  it("says plainly when there is no logo", async () => {
    resolve.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/v1/operators/mark?domain=bus&name=Busreisen%20M%C3%BCller")
      .set("Cookie", cookie);
    expect(res.body.data).toEqual({ available: false, source: null, credit: null });
  });

  it("serves the bytes inert and private, and 404s without a stand-in image", async () => {
    resolve.mockResolvedValueOnce({
      image: { body: PNG, contentType: "image/png" },
      source: "wikidata",
      credit: CREDIT,
    });
    const ok = await request(app)
      .get("/api/v1/operators/logo?domain=ferry&name=Stena%20Line")
      .set("Cookie", cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/png");
    expect(ok.headers["cache-control"]).toBe("private, max-age=604800");
    expect(ok.headers["content-security-policy"]).toContain("sandbox");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");

    resolve.mockResolvedValueOnce(null);
    const missing = await request(app)
      .get("/api/v1/operators/logo?domain=ferry&name=Nobody")
      .set("Cookie", cookie);
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toMatch(/json/);
    expect(missing.headers["cache-control"]).toMatch(/^private/);
  });

  it("refuses an unknown domain", async () => {
    const res = await request(app)
      .get("/api/v1/operators/logo?domain=spaceship&name=X")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
  });
});
