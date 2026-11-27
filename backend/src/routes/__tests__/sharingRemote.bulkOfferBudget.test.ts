import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { generateKeyPairSync, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

import { setFederationIdentity } from "../../services/federation/__tests__/identityFixture";
import { resetIdentityCache } from "../../services/federation/identity";
import { setTripFlags } from "../../services/sharing/federation/__tests__/instanceFlags";

import app from "../../index";
import { prisma } from "../../db";
import { makeAccount, wipeShareTestAccounts } from "./sharingFixtures";

/**
 * Security review 2026-11-27: the bulk offer must not get past the outbound-offer budget. It
 * counts against the same limiter and key as a single offer; only its own route may go up to 90
 * an hour (about sixty trips with a retry).
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-offer-budget-"));
let flagsBefore: Awaited<ReturnType<typeof setTripFlags>>;
let restoreIdentity: () => Promise<void> = async () => undefined;

describe("bulk offers share the outbound offer budget", () => {
  beforeAll(async () => {
    const key = path.join(dir, "local.key");
    fs.writeFileSync(
      key,
      generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" })
    );
    restoreIdentity = await setFederationIdentity("https://local.bulk-budget.test", key);
    resetIdentityCache();
    flagsBefore = await setTripFlags({ betaFeaturesEnabled: true, tripFederationEnabled: true });
  });

  afterAll(async () => {
    await setTripFlags(flagsBefore);
    await restoreIdentity();
    resetIdentityCache();
    fs.rmSync(dir, { recursive: true, force: true });
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const bulk = (cookie: string) =>
    request(app)
      .post("/api/v1/sharing/remote/link-bulk/offers")
      .set("Cookie", cookie)
      .send({ tripId: randomUUID(), remoteId: randomUUID() });
  const single = (cookie: string) =>
    request(app)
      .post(`/api/v1/sharing/remote/trips/${randomUUID()}/offers`)
      .set("Cookie", cookie)
      .send({ remoteId: randomUUID() });

  it("thirty bulk offers use up the single offer's hour", async () => {
    const user = await makeAccount("bulkbudget");
    for (let i = 0; i < 30; i++) expect((await bulk(user.cookie)).status).not.toBe(429);
    expect((await single(user.cookie)).status).toBe(429);
    // The bulk route itself may go on, up to its own cap of 90.
    expect((await bulk(user.cookie)).status).not.toBe(429);
  });

  it("the bulk route stops at 90 in the hour, with Retry-After for the pause", async () => {
    const user = await makeAccount("bulkcap");
    for (let i = 0; i < 90; i++) await bulk(user.cookie);
    const res = await bulk(user.cookie);
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});
