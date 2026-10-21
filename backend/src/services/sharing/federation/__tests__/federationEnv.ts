/**
 * Test helper: give this process a server identity through FEDERATION_* env vars and switch
 * trip sharing across servers on, then put everything back. Not a suite.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { resetIdentityCache } from "../../../federation/identity";
import { setTripFlags } from "./instanceFlags";

export async function withTripFederation(origin: string): Promise<() => Promise<void>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-fed-"));
  const key = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(path.join(dir, "local.key"), key);
  const env = ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"] as const;
  const previous = env.map((k) => process.env[k]);
  process.env.FEDERATION_ENABLED = "1";
  process.env.FEDERATION_PUBLIC_ORIGIN = origin;
  process.env.FEDERATION_KEY_FILE = path.join(dir, "local.key");
  resetIdentityCache();
  const flags = await setTripFlags({ betaFeaturesEnabled: true, tripFederationEnabled: true });
  return async () => {
    await setTripFlags(flags);
    env.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
    resetIdentityCache();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
