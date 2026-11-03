import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getAdminFxSettings } from "../../services/parserSettings";

type FieldRow = { key: string; value: unknown; options?: string[] };

/**
 * The ECB source choice (GitHub #391): stored in admin_settings, written and
 * validated through the external-services façade, read back by the FX chain.
 */
describe("FX source choice via external services", () => {
  let adminId: string;
  let cookie: string;
  let rowId: number;

  const put = (fields: Record<string, unknown>) =>
    request(app).put("/api/v1/admin/external-services/fx").set("Cookie", cookie).send({ fields });
  const fieldsOf = (body: { admin?: { fields: FieldRow[] }; fields?: FieldRow[] }) =>
    Object.fromEntries((body.admin?.fields ?? body.fields ?? []).map((f) => [f.key, f]));

  beforeAll(async () => {
    adminId = (
      await prisma.user.create({
        data: {
          username: `fxsrc-admin-${Date.now()}`,
          passwordHash: await hashPassword("pw-123456"),
          isAdmin: true,
          isActive: true,
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(adminId)}`;
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = row ? row.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  const resetChoice = () =>
    prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        fxPrimarySource: "frankfurter",
        fxPrimaryCustomUrl: null,
        fxFallbackSource: "none",
        fxFallbackCustomUrl: null,
      },
    });

  beforeEach(async () => {
    await resetChoice();
  });

  afterAll(async () => {
    await resetChoice();
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it("defaults to Frankfurter with no fallback for anyone who never touches it", async () => {
    const s = await getAdminFxSettings();
    expect(s.primaryUrl).toBe("https://api.frankfurter.dev/v1");
    expect(s.fallbackUrl).toBeNull();
  });

  it("round-trips a primary and a fallback choice and the chain reads them", async () => {
    const res = await put({
      primarySource: "allratestoday",
      fallbackSource: "custom",
      fallbackUrl: "https://fx.example.org/v1/",
    });
    expect(res.status).toBe(200);
    const f = fieldsOf(res.body);
    expect(f.primarySource.value).toBe("allratestoday");
    expect(f.primarySource.options).toEqual(["frankfurter", "allratestoday", "custom"]);
    expect(f.fallbackSource.options).toEqual(["none", "frankfurter", "allratestoday", "custom"]);
    expect(f.fallbackUrl.value).toBe("https://fx.example.org/v1");
    const s = await getAdminFxSettings();
    expect(s.primaryUrl).toBe("https://allratestoday.com/api/compat/frankfurter");
    expect(s.fallbackUrl).toBe("https://fx.example.org/v1");
  });

  it.each([
    ["a non-http scheme", { primaryUrl: "ftp://fx.example.org" }],
    ["credentials in the URL", { primaryUrl: "https://u:p@fx.example.org" }],
    ["a query string", { fallbackUrl: "https://fx.example.org/v1?key=1" }],
    ["an unknown source id", { primarySource: "yahoo" }],
    ["'none' as the PRIMARY source", { primarySource: "none" }],
  ])("refuses %s with a 400", async (_name, fields) => {
    const res = await put(fields);
    expect(res.status).toBe(400);
  });

  it("refuses 'custom' without an address instead of silently using the default", async () => {
    const res = await put({ primarySource: "custom" });
    expect(res.status).toBe(400);
    expect(res.body.field ?? res.body.error?.field ?? JSON.stringify(res.body)).toContain(
      "primaryUrl"
    );
    expect((await getAdminFxSettings()).primaryUrl).toBe("https://api.frankfurter.dev/v1");
  });

  it("accepts 'custom' once the address is sent in the same save", async () => {
    const res = await put({ primarySource: "custom", primaryUrl: "http://192.168.1.9:8080" });
    expect(res.status).toBe(200);
    expect((await getAdminFxSettings()).primaryUrl).toBe("http://192.168.1.9:8080");
  });
});
