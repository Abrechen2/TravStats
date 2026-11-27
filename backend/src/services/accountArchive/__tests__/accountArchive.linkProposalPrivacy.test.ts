import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { prisma } from "../../../db";
import type { PrismaClient } from "../../../prisma";
import {
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import { writeAccountArchive } from "../exportArchive";
import { readZip } from "./archiveHelpers";

jest.setTimeout(120_000);

/**
 * A link proposal names the recipient's trip once it is linked (`linked_trip_id`). The proposal
 * flow never shows that trip to the proposer, so the proposer's account archive must not carry it
 * either (security review of integrate/rc48, 2026-11-27).
 */
describe("account archive: trip link proposals", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let bensTripId: string;
  let work: string;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-arch");
    ben = await makeAccount("ben-arch");
    const annas = await makeFullTrip(anna);
    const bens = await makeFullTrip(ben);
    bensTripId = bens.trip.id;
    await prisma.tripLinkProposal.create({
      data: {
        proposerId: anna.id,
        recipientId: ben.id,
        tripId: annas.trip.id,
        status: "linked",
        linkedTripId: bensTripId,
        decidedAt: new Date(),
      },
    });
    work = fs.mkdtempSync(path.join(os.tmpdir(), "arch-lp-"));
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("does not leak the recipient's linked trip id into the proposer's archive", async () => {
    const zip = path.join(work, "anna.zip");
    await writeAccountArchive(anna.id, zip, undefined, {
      uploadsRoot: work,
      client: prisma as unknown as PrismaClient,
    });
    const entries = await readZip(zip);
    const rows = entries.get("info/trip_link_proposals.jsonl")?.toString() ?? "";
    expect(rows).toContain(anna.id); // the proposal itself is still listed for the reader
    const text = [...entries.values()].map((b) => b.toString("latin1")).join("\n");
    expect(text).not.toContain(bensTripId);
    fs.rmSync(work, { recursive: true, force: true });
  });
});
