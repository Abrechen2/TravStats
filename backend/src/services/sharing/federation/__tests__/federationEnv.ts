/**
 * Test helper: give this process a server identity through the instance settings and switch
 * trip sharing across servers on, then put everything back. Not a suite.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { setFederationIdentity } from "../../../federation/__tests__/identityFixture";
import { setTripFlags } from "./instanceFlags";

export async function withTripFederation(origin: string): Promise<() => Promise<void>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-fed-"));
  const key = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(path.join(dir, "local.key"), key);
  const restoreIdentity = await setFederationIdentity(origin, path.join(dir, "local.key"));
  const flags = await setTripFlags({ betaFeaturesEnabled: true, tripFederationEnabled: true });
  return async () => {
    await setTripFlags(flags);
    await restoreIdentity();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
