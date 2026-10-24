import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

import { prisma } from "../../db";
import { USER_EXPORT_SELECT } from "../../services/export/allDataExport";
import { shareTrip } from "../../services/sharing/shareTrip";
import { buildTripView, loadOwnedTrip } from "../../services/shareLinks/tripView";
import { collectTrip } from "../../services/trip/exchange/collect";
import { SHARE_LINK_FIELDS } from "../../schemas/shareLinks";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A trip recording is private to the person who recorded it (forgejo#316): it
 * never travels with a shared copy of the trip, a `.travstats` file or a
 * public link — and it DOES travel with the account's own data export, since
 * the server is the record and the phone may be gone.
 *
 * The coordinate and uploadId below appear nowhere else, so finding either in
 * an output is finding the recording there.
 */
const MARK_LAT = 38.7123456;
const MARK_LON = -9.1398765;
const MARK_UPLOAD = "PRIVATE-RECORDING-UPLOAD";

describe("trip recording — private to its owner", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let full: Awaited<ReturnType<typeof makeFullTrip>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("rec-anna");
    ben = await makeAccount("rec-ben");
    full = await makeFullTrip(anna);
    await prisma.tripRecordingBatch.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        deviceId: "anna-phone",
        uploadId: MARK_UPLOAD,
        startedAt: new Date("2025-05-02T10:00:00Z"),
        endedAt: new Date("2025-05-02T10:05:00Z"),
        points: [
          [Date.parse("2025-05-02T10:00:00Z"), MARK_LAT, MARK_LON, 20],
          [Date.parse("2025-05-02T10:05:00Z"), MARK_LAT, MARK_LON + 0.01, null],
        ],
        pointCount: 2,
      },
    });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const leaks = (value: unknown): boolean => {
    const text = JSON.stringify(value);
    return [String(MARK_LAT), String(MARK_LON), MARK_UPLOAD, "anna-phone"].some((m) =>
      text.includes(m)
    );
  };

  it("is not copied into the trip a companion receives", async () => {
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, full.trip.id, companion.id);
    const bensTrips = await prisma.trip.findMany({ where: { userId: ben.id } });
    expect(bensTrips).toHaveLength(1);
    expect(await prisma.tripRecordingBatch.count({ where: { userId: ben.id } })).toBe(0);
    expect(
      await prisma.tripRecordingBatch.count({
        where: { tripId: { in: bensTrips.map((t) => t.id) } },
      })
    ).toBe(0);
  });

  it("is not in a .travstats trip file, not even with every private part asked for", async () => {
    const collected = await collectTrip(anna.id, full.trip.id, {
      documents: true,
      photos: true,
      private: true,
    });
    expect(collected.file).toBeDefined();
    expect(leaks(collected)).toBe(false);
  });

  it("is not in a public link's view, whatever fields it shares", async () => {
    const row = await loadOwnedTrip(anna.id, full.trip.id);
    const view = await buildTripView(anna.id, row!, new Set(SHARE_LINK_FIELDS.trip), "Anna", []);
    expect(view.name).toBe(full.trip.name);
    expect(leaks(view)).toBe(false);
  });

  it("is in the account's own data export, raw", async () => {
    const exported = await prisma.user.findUniqueOrThrow({
      where: { id: anna.id },
      select: USER_EXPORT_SELECT,
    });
    expect(exported.tripRecordingBatches).toEqual([
      expect.objectContaining({
        tripId: full.trip.id,
        uploadId: MARK_UPLOAD,
        deviceId: "anna-phone",
        pointCount: 2,
        points: [
          [Date.parse("2025-05-02T10:00:00Z"), MARK_LAT, MARK_LON, 20],
          [Date.parse("2025-05-02T10:05:00Z"), MARK_LAT, MARK_LON + 0.01, null],
        ],
      }),
    ]);
  });

  /**
   * The guard for the paths not written yet: the table is read by its own
   * router and the account export, and by nothing else. A new reader — a
   * share adapter, a comparison collector, a stats route — fails here and has
   * to answer, in this list, why the recording may go there.
   */
  it("is read by its own router and the account export only", () => {
    const SRC = join(__dirname, "../..");
    const ALLOWED = new Set([
      "routes/trips/tripRecording.ts",
      "services/tripRecording/bounds.ts",
      "services/export/allDataExport.ts",
      // Merge moves a source trip's recording to the target (same owner, never
      // propagated); cleanup keeps a recorded trip from being dissolved.
      "services/tripCleanupService.ts",
      // Classifies the User relation as never published (NON_TRAVEL_RELATIONS).
      "services/federation/e2e/graph.ts",
      // The trip recording's own read path since TravTrack plan T5: it chooses
      // between the own recording and the provider for the same owner's router.
      "services/locationProvider/entryTrack.ts",
    ]);
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          return ["generated", "__tests__"].includes(name) ? [] : files(path);
        }
        return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
      });
    const readers = files(SRC)
      .filter((path) => /tripRecordingBatch|recordingBatches/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).split("\\").join("/"))
      .filter((rel) => !ALLOWED.has(rel));
    expect(readers).toEqual([]);
  });
});
