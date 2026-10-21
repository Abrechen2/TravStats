/**
 * forgejo#309 — the template repository as an admin instance setting: it wins
 * over the env var, it is checked by the one endpoint rule, saving it re-syncs
 * at once, a failing new repository keeps the last good set and says so, and
 * "test" answers a stable code. Nothing here reaches the network: the fetcher
 * and the sync are stubbed.
 */
jest.mock("../../services/parsers/templates/fetchJson", () => ({
  ...jest.requireActual("../../services/parsers/templates/fetchJson"),
  fetchJson: jest.fn(),
}));

import request from "supertest";
import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { templateRegistry } from "../../services/parsers/templates/registry";
import { FetchJsonError, fetchJson } from "../../services/parsers/templates/fetchJson";
import { DEFAULT_TEMPLATE_REPO_BASE_URL } from "../../services/parsers/templates/v2/source";

const mockFetch = fetchJson as jest.Mock;
const MIRROR = "https://mirror.example.org/travstats-templates/main";

describe("/api/v1/admin/template-repo", () => {
  const userIds: string[] = [];
  let admin: string;
  let plain: string;
  let syncNow: jest.SpyInstance;

  const create = async (isAdmin: boolean): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        username: `tplrepo-${isAdmin}-${Date.now()}-${userIds.length}`,
        passwordHash: "x",
        isAdmin,
      },
    });
    userIds.push(user.id);
    return `auth_token=${generateToken(user.id)}`;
  };

  beforeAll(async () => {
    admin = await create(true);
    plain = await create(false);
  });

  beforeEach(() => {
    mockFetch.mockReset();
    syncNow = jest.spyOn(templateRegistry, "syncNow").mockResolvedValue(0);
  });

  afterEach(() => syncNow.mockRestore());

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: { templateRepoBaseUrl: null } });
    templateRegistry.useRepository(null);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("is an admin setting: a signed-in user is refused", async () => {
    const res = await request(app).get("/api/v1/admin/template-repo").set("Cookie", plain);
    expect(res.status).toBe(403);
  });

  it("refuses plain http to a public host and credentials in the URL, with codes", async () => {
    const http = await request(app)
      .put("/api/v1/admin/template-repo")
      .set("Cookie", admin)
      .send({ url: "http://templates.example.org/raw" });
    expect(http.status).toBe(400);
    expect(http.body.code).toBe("TEMPLATE_REPO_URL_HTTPS_REQUIRED");
    const creds = await request(app)
      .put("/api/v1/admin/template-repo")
      .set("Cookie", admin)
      .send({ url: "https://user:secret@mirror.example.org/raw" });
    expect(creds.body.code).toBe("TEMPLATE_REPO_URL_INVALID");
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("stores the URL, points the registry at it and re-syncs at once", async () => {
    const res = await request(app)
      .put("/api/v1/admin/template-repo")
      .set("Cookie", admin)
      .send({ url: `${MIRROR}/` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ url: MIRROR, effectiveUrl: MIRROR, origin: "admin" });
    expect(res.body.sync).toEqual(
      expect.objectContaining({ index: expect.any(String), active: expect.any(Number) })
    );
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(templateRegistry.getRepository()).toEqual({ url: MIRROR, origin: "admin" });
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    expect(row?.templateRepoBaseUrl).toBe(MIRROR);

    const read = await request(app).get("/api/v1/admin/template-repo").set("Cookie", admin);
    expect(read.body).toMatchObject({ url: MIRROR, origin: "admin" });
  });

  it("clears back to the env var or the official repository", async () => {
    const res = await request(app)
      .put("/api/v1/admin/template-repo")
      .set("Cookie", admin)
      .send({ url: null });
    expect(res.status).toBe(200);
    expect(res.body.url).toBeNull();
    expect(res.body.origin).not.toBe("admin");
    expect(res.body.defaultUrl).toBe(DEFAULT_TEMPLATE_REPO_BASE_URL);
  });

  it.each([
    ["ok", { version: 2, templates: [{}, {}] }, { result: "ok", templates: 2 }],
    ["notAnIndex", { airlines: [] }, { result: "notAnIndex", templates: null }],
  ])("tests a repository's index: %s", async (_label, index, expected) => {
    mockFetch.mockResolvedValue(index);
    const res = await request(app)
      .post("/api/v1/admin/template-repo/test")
      .set("Cookie", admin)
      .send({ url: MIRROR });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(`${MIRROR}/index.json`);
  });

  it("tests a repository whose index is over the size cap as tooLarge, not unreachable", async () => {
    mockFetch.mockRejectedValue(new FetchJsonError("too_large", "Response exceeds 2097152 bytes"));
    const res = await request(app)
      .post("/api/v1/admin/template-repo/test")
      .set("Cookie", admin)
      .send({ url: MIRROR });
    expect(res.body).toEqual({ result: "tooLarge", templates: null });
  });

  it("tests an unreachable repository and a refused URL without fetching the latter", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const down = await request(app)
      .post("/api/v1/admin/template-repo/test")
      .set("Cookie", admin)
      .send({ url: MIRROR });
    expect(down.body).toEqual({ result: "unreachable", templates: null });

    mockFetch.mockClear();
    const refused = await request(app)
      .post("/api/v1/admin/template-repo/test")
      .set("Cookie", admin)
      .send({ url: "http://templates.example.org/raw" });
    expect(refused.body).toEqual({ result: "httpsRequired", templates: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
