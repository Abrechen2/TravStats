/**
 * forgejo#416: the Services-page federation switch is the same one-switch as
 * `PUT /admin/federation` — switching it on makes the key.
 */
import express from "express";
import request from "supertest";
import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import { ensureAdminSettingsRow } from "../../../services/adminSettingsRow";
import { resetIdentityCache } from "../../../services/federation/identity";
import externalServices from "../externalServices";

const app = express();
app.use(express.json());
app.use("/api/v1/admin/external-services", externalServices);
app.use(errorHandler);
const ORIGIN = "https://me.services-switch.test";
let rowId: number;

const put = (body: unknown) =>
  request(app).put("/api/v1/admin/external-services/federation").send(body);
const row = () =>
  prisma.adminSettings.findUniqueOrThrow({
    where: { id: rowId },
    select: { federationEnabled: true, federationPrivateKey: true },
  });
async function reset() {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
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

it("switching federation on from the services page generates a key", async () => {
  await prisma.adminSettings.update({ where: { id: rowId }, data: { federationOrigin: ORIGIN } });
  const res = await put({ enabled: true });
  expect(res.status).toBe(200);
  const after = await row();
  expect(after.federationEnabled).toBe(true);
  expect(after.federationPrivateKey).not.toBeNull();
});

it("switching it on again keeps the existing key", async () => {
  await prisma.adminSettings.update({ where: { id: rowId }, data: { federationOrigin: ORIGIN } });
  await put({ enabled: true });
  const first = (await row()).federationPrivateKey;
  await put({ enabled: false });
  await put({ enabled: true });
  expect((await row()).federationPrivateKey).toBe(first);
});
