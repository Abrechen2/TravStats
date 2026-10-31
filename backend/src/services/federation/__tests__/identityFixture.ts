/**
 * Test helper: give this process a server identity the way an admin does, through
 * `admin_settings` (the FEDERATION_* variables are no longer read). Not a suite.
 */
import fs from "fs";
import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { ensureAdminSettingsRow } from "../../adminSettingsRow";
import { resetIdentityCache } from "../identity";

export async function setFederationIdentity(
  origin: string,
  keyFile: string
): Promise<() => Promise<void>> {
  const id = await ensureAdminSettingsRow();
  const before = await prisma.adminSettings.findUniqueOrThrow({
    where: { id },
    select: { federationEnabled: true, federationOrigin: true, federationPrivateKey: true },
  });
  await prisma.adminSettings.update({
    where: { id },
    data: {
      federationEnabled: true,
      federationOrigin: origin,
      federationPrivateKey: encryptApiKey(fs.readFileSync(keyFile, "utf8")),
    },
  });
  resetIdentityCache();
  return async () => {
    await prisma.adminSettings.update({ where: { id }, data: before });
    resetIdentityCache();
  };
}

/** Switch federation off in the settings; the returned function switches it back on. */
export async function pauseFederation(): Promise<() => Promise<void>> {
  const id = await ensureAdminSettingsRow();
  await prisma.adminSettings.update({ where: { id }, data: { federationEnabled: false } });
  resetIdentityCache();
  return async () => {
    await prisma.adminSettings.update({ where: { id }, data: { federationEnabled: true } });
    resetIdentityCache();
  };
}
