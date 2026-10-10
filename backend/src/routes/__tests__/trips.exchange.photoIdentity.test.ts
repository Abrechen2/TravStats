import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { getTripPhotoDir } from "../../middleware/upload";
import { readTripArchive, type TripArchive } from "../../services/trip/exchange/readArchive";
import { buildTripFileProposal } from "../../services/trip/exchange/proposal";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { PNG, seedFullTrip, type SeededTrip } from "./tripExchange.fixture";

/**
 * forgejo#276: a photo of a `.travstats` file is "already on the trip" only
 * when its BYTES are. Two different photos of the same size and the same (or
 * no) capture time used to share one identity, and the commit silently did not
 * write the imported one.
 */
const stamp = Date.now();

/** Same length as `PNG`, other bytes — still a PNG by its magic number. */
const OTHER_PNG = (() => {
  const b = Buffer.from(PNG);
  b[PNG.length - 20] ^= 0xff;
  return b;
})();

function withPhoto(archive: TripArchive, bytes: Buffer, takenAt: string | null): TripArchive {
  const [photo] = archive.file.photos;
  return {
    ...archive,
    file: { ...archive.file, photos: [{ ...photo, takenAt }] },
    blobs: new Map([...archive.blobs, [photo.file, bytes]]),
  };
}

describe("trip import — photo identity is the content (forgejo#276)", () => {
  let userId: string;
  let seeded: SeededTrip;
  let exported: TripArchive;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: `tx-photo-${stamp}`, passwordHash: "x" },
    });
    userId = u.id;
    seeded = await seedFullTrip(userId, stamp);
    const res = await request(app)
      .get(`/api/v1/trips/${seeded.tripId}/export?photos=1`)
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    exported = readTripArchive(res.body as Buffer);
    expect(exported.file.photos).toHaveLength(1);
  });

  afterAll(async () => {
    const photos = await prisma.tripPhoto.findMany({
      where: { trip: { userId } },
      select: { filename: true },
    });
    for (const p of photos) fs.rmSync(path.join(getTripPhotoDir(), p.filename), { force: true });
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.port.deleteMany({ where: { id: seeded.portId } });
    await prisma.$disconnect();
  });

  it("keeps an unchanged re-import idempotent — preview and commit agree", async () => {
    const proposal = await buildTripFileProposal(userId, exported);
    expect(proposal.trip.id).toBe(seeded.tripId);
    expect(proposal.photos).toEqual({ create: 0, skip: 1 });
    const result = await commitTripFile(userId, exported);
    expect(result.photos).toBe(0);
    expect(await prisma.tripPhoto.count({ where: { tripId: seeded.tripId } })).toBe(1);
  }, 20_000);

  it("keeps the same bytes as one photo even when the file states another capture time", async () => {
    const archive = withPhoto(exported, PNG, "2030-01-01T00:00:00.000Z");
    expect((await buildTripFileProposal(userId, archive)).photos).toEqual({ create: 0, skip: 1 });
  });

  it("keeps two different photos of equal size and identical capture time", async () => {
    const archive = withPhoto(exported, OTHER_PNG, exported.file.photos[0].takenAt);
    expect((await buildTripFileProposal(userId, archive)).photos).toEqual({ create: 1, skip: 0 });
  });

  it("keeps two different photos of equal size without a capture time — preview and commit", async () => {
    await prisma.tripPhoto.updateMany({
      where: { tripId: seeded.tripId },
      data: { takenAt: null },
    });
    const archive = withPhoto(exported, OTHER_PNG, null);
    expect((await buildTripFileProposal(userId, archive)).photos).toEqual({ create: 1, skip: 0 });

    const result = await commitTripFile(userId, archive);
    expect(result.photos).toBe(1);
    const stored = await prisma.tripPhoto.findMany({
      where: { tripId: seeded.tripId },
      select: { filename: true },
    });
    expect(stored).toHaveLength(2);
    const contents = stored.map((p) => fs.readFileSync(path.join(getTripPhotoDir(), p.filename)));
    expect(contents.some((b) => b.equals(OTHER_PNG))).toBe(true);
    expect(contents.some((b) => b.equals(PNG))).toBe(true);

    // ...and that import, repeated, is now the one that is skipped.
    expect((await buildTripFileProposal(userId, archive)).photos).toEqual({ create: 0, skip: 1 });
  }, 20_000);
});
