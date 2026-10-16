import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { ensureAdminSettingsRow } from "../../adminSettingsRow";
import { loadIdentity, resetIdentityCache } from "../identity";

const ENV = ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"];
const pem = () =>
  generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
let rowId: number;

beforeAll(async () => {
  rowId = await ensureAdminSettingsRow();
});
beforeEach(() => {
  for (const key of ENV) delete process.env[key];
  resetIdentityCache();
});
afterAll(async () => {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  await prisma.$disconnect();
});

it("refuses with federation-off while nothing is configured", async () => {
  await prisma.adminSettings.update({ where: { id: rowId }, data: { federationEnabled: false } });
  await expect(loadIdentity()).rejects.toMatchObject({ kind: "federation-off" });
});

it("uses the key an admin generated, stored encrypted in admin_settings", async () => {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: {
      federationEnabled: true,
      federationOrigin: "https://settings.identity.test",
      federationPrivateKey: encryptApiKey(pem()),
    },
  });
  const identity = await loadIdentity();
  expect(identity).toMatchObject({ origin: "https://settings.identity.test", source: "settings" });
  expect(identity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});

it("refuses with federation-off, not a raw error, when the stored key is not an Ed25519 PEM", async () => {
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: {
      federationEnabled: true,
      federationOrigin: "https://settings.identity.test",
      federationPrivateKey: encryptApiKey("not a pem"),
    },
  });
  await expect(loadIdentity()).rejects.toMatchObject({ kind: "federation-off" });
});

it("lets the env override win, so existing installs keep their key", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-"));
  fs.writeFileSync(path.join(dir, "k.pem"), pem());
  process.env.FEDERATION_ENABLED = "1";
  process.env.FEDERATION_PUBLIC_ORIGIN = "https://env.identity.test";
  process.env.FEDERATION_KEY_FILE = path.join(dir, "k.pem");
  expect(await loadIdentity()).toMatchObject({
    origin: "https://env.identity.test",
    source: "env",
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
