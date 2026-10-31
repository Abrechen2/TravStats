import { createPrivateKey, createPublicKey, type KeyObject } from "crypto";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { decryptApiKey } from "../../utils/encryption";
import { hash, refused } from "./refusal";

export type IdentitySource = "settings";
export interface Identity {
  origin: string;
  key: KeyObject;
  publicKey: string;
  fingerprint: string;
  source: IdentitySource;
}

// Every signed packet re-read and re-parsed the key file once, blocking the event loop per
// request. The key is parsed once per configuration; a new key or origin changes the config.
let cached: { config: string; value: Identity } | null = null;

export function resetIdentityCache(): void {
  cached = null;
}

function parse(origin: string, pem: string | Buffer, source: IdentitySource, config: string) {
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch (error) {
    // A legacy or garbled PEM must read as "federation off": the admin screen that can repair
    // the key calls this, and a raw error there would 500 the only way to fix it.
    logger.warn({ err: error, source }, "Federation key could not be parsed");
    throw refused("federation-off");
  }
  if (key.asymmetricKeyType !== "ed25519") throw refused("federation-off");
  const publicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  const value: Identity = { origin, key, publicKey, fingerprint: hash(publicKey), source };
  cached = { config, value };
  return value;
}

export async function loadIdentity(): Promise<Identity> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { federationEnabled: true, federationOrigin: true, federationPrivateKey: true },
  });
  if (!row?.federationEnabled || !row.federationOrigin || !row.federationPrivateKey)
    throw refused("federation-off");
  const config = `settings|${row.federationOrigin}|${hash(row.federationPrivateKey)}`;
  if (cached?.config === config) return cached.value;
  const pem = decryptApiKey(row.federationPrivateKey);
  if (!pem) throw refused("federation-off");
  return parse(row.federationOrigin, pem, "settings", config);
}
