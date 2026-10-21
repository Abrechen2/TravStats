import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { mergeTrips } from "../tripCleanupService";

/**
 * A Companion upload that lands on a source trip WHILE it is being merged
 * (forgejo#316). The merge moves the source's recordings, then deletes the
 * source; an upload committed between the two used to be cascade-deleted
 * while both the merge and the upload reported success. Either the points
 * reach the merged trip, or the upload is refused — never both "stored" and
 * gone.
 */
const gate = (() => {
  let open = () => {};
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { open: () => open(), wait };
})();
let paused = false;

jest.mock("../trip/mergeTripRelations", () => {
  const actual = jest.requireActual<typeof import("../trip/mergeTripRelations")>(
    "../trip/mergeTripRelations"
  );
  return {
    ...actual,
    // Runs after the recording move and before the source trip is deleted.
    mergeImmichAlbums: async (...args: Parameters<typeof actual.mergeImmichAlbums>) => {
      paused = true;
      await gate.wait;
      return actual.mergeImmichAlbums(...args);
    },
  };
});

const USERNAME = `merge-rec-race-${Date.now()}`;

describe("trip merge — a recording uploaded mid-merge", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { username: USERNAME, passwordHash: "x" } });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("never reports an upload as stored that the merge then deletes", async () => {
    const span = {
      userId,
      startDate: new Date("2026-05-01T00:00:00Z"),
      endDate: new Date("2026-05-03T00:00:00Z"),
      startDay: new Date("2026-05-01T00:00:00Z"),
      endDay: new Date("2026-05-03T00:00:00Z"),
      startZone: "UTC",
      endZone: "UTC",
    };
    const target = await prisma.trip.create({ data: { ...span, name: "Target" } });
    const source = await prisma.trip.create({ data: { ...span, name: "Source" } });

    const merge = mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });
    while (!paused) await new Promise((r) => setTimeout(r, 10));

    const upload = request(app)
      .post(`/api/v1/trips/${source.id}/recording`)
      .set("Cookie", cookie)
      .send({
        uploadId: "mid-merge",
        points: [{ t: "2026-05-02T10:00:00Z", lat: 38.7, lon: -9.1 }],
      })
      .then((res) => res);
    // Give the upload time to reach its write while the merge is held.
    await new Promise((r) => setTimeout(r, 500));
    gate.open();

    await expect(merge).resolves.toMatchObject({ tripId: target.id });
    const res = await upload;
    const kept = await prisma.tripRecordingBatch.findMany({
      where: { userId, uploadId: "mid-merge" },
    });
    if (res.status === 201) {
      expect(kept).toHaveLength(1);
      expect(kept[0].tripId).toBe(target.id);
    } else {
      // Refused as the gone trip it is — not a server error, nothing stored.
      expect(res.status).toBe(404);
      expect(kept).toHaveLength(0);
    }
  });
});
