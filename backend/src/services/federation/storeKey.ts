import { generateKeyPairSync } from "crypto";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { encryptApiKey } from "../../utils/encryption";
import { ensureAdminSettingsRow } from "../adminSettingsRow";
import { holdAllConnections } from "../sharing/federation/connections/hooks";
import { resetIdentityCache } from "./identity";

/** A key for this server, encrypted at rest. Peers pinned the old key, so connections are held first. */
export async function storeNewKey(userId: string | undefined, replacing: boolean): Promise<void> {
  const id = await ensureAdminSettingsRow();
  const pem = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  // Peers pinned the old key: they refuse this server until their admins pin the new one, and
  // their re-pin sends their side of every connection to reconfirm. Mirror that here, or this
  // side keeps showing active connections and plan members the peers have already ended. Held
  // before the key is written, so a failure in between fails closed and a retry holds again.
  if (replacing) await holdAllConnections();
  // A first key is written only while none exists, so two switch-ons racing keep one key.
  const written = await prisma.adminSettings.updateMany({
    where: replacing ? { id } : { id, federationPrivateKey: null },
    data: { federationPrivateKey: encryptApiKey(pem) },
  });
  resetIdentityCache();
  if (written.count === 0) return;
  logger.info({ operation: "federation_key_generated", userId }, "Federation key generated");
}
