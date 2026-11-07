/**
 * Federation is one switch (forgejo#416, Package E): switching it on without a key makes one, and
 * with no address typed the instance's public URL is used.
 */
import express from "express";
import request from "supertest";
import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import { ensureAdminSettingsRow } from "../../../services/adminSettingsRow";
import { resetIdentityCache } from "../../../services/federation/identity";
import federation from "../federation";

const app = express();
app.use(express.json());
app.use("/api/v1/admin/federation", federation);
app.use(errorHandler);
const ORIGIN = "https://me.switch-on.test";
let rowId: number;

const put = (body: unknown) => request(app).put("/api/v1/admin/federation").send(body);
async function reset(data: Record<string, unknown> = {}) {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: {
      federationEnabled: false,
      federationOrigin: null,
      federationPrivateKey: null,
      publicUrl: null,
      ...data,
    },
  });
  resetIdentityCache();
}

beforeAll(async () => {
  rowId = await ensureAdminSettingsRow();
});
beforeEach(async () => {
  delete process.env.FEDERATION_ENABLED;
  await reset();
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

it("switching on without a key generates one", async () => {
  const res = await put({ enabled: true, origin: ORIGIN });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ enabled: true, origin: ORIGIN, hasKey: true });
  expect(res.body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});

it("an existing key is kept", async () => {
  const first = await put({ enabled: true, origin: ORIGIN });
  await put({ enabled: false, origin: ORIGIN });
  const again = await put({ enabled: true, origin: ORIGIN });
  expect(again.body.fingerprint).toBe(first.body.fingerprint);
});

it("switching off does not create a key", async () => {
  const res = await put({ enabled: false, origin: ORIGIN });
  expect(res.body.hasKey).toBe(false);
});

it("an empty address falls back to the instance's public URL", async () => {
  await reset({ publicUrl: "https://public.switch-on.test/some/path/" });
  const res = await put({ enabled: true, origin: "" });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ origin: "https://public.switch-on.test", hasKey: true });
});

it("with no address anywhere, switching on is refused and nothing is written", async () => {
  const res = await put({ enabled: true, origin: "" });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("FEDERATION_ORIGIN_MISSING");
  const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
  expect(row.federationEnabled).toBe(false);
  expect(row.federationPrivateKey).toBeNull();
});
