import fs from "fs";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getUploadDir,
  getTripPhotoDir,
  getPlacePhotoDir,
  getLodgingPhotoDir,
} from "../../middleware/upload";
import { getTrainingUploadDir } from "../../routes/training";

/**
 * Finding I2: every upload route was open to the shared demo account. A
 * visitor's photograph is then shown to the next one, it is not deleted by the
 * nightly reseed (`wipeDemoUser` removes rows, not files), and twenty files of
 * fifteen megabytes per request fills the data volume of a public instance
 * that nobody is watching.
 *
 * So the shared account uploads nothing. Reading and deleting what is already
 * there is untouched — the seed writes no photos, so there is nothing of its
 * own to read, and a visitor tidying up after another is harmless.
 *
 * Wave C finding C2 (Codex review, 2026-09-17): the original version of this
 * file sent every request with NO file attached, so multer never ran even
 * when the guard passed — the test stayed green whether the guard sat above
 * or below multer, which is exactly the ordering it exists to pin. Every case
 * below now attaches a real (tiny) file to the field the route actually reads,
 * and asserts that the route's storage — a disk directory for six of them, the
 * `TripRouteTrack` table for the GPX one, which uses memory storage and has no
 * directory of its own — is unchanged afterwards. A guard mounted below multer
 * would fail this: the disk-based routes would have written a file before
 * refusing, and the GPX route would 400 on a real trip/route rather than 403
 * before ever reading `req.file`.
 */

/** A real PNG header — same fixture `placeVisitPhotos.test.ts` uses; the
 *  upload filters check the declared mimetype, and a believable body keeps
 *  this test honest about what it is sending. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

/** Well-formed enough that a guard mounted below multer would reach
 *  `parseGpx` — the point is the guard never lets it get that far. */
const GPX = Buffer.from(
  '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="1" lon="1"></trkpt></trkseg></trk></gpx>',
  "utf-8"
);

const NIL = "00000000-0000-0000-0000-000000000000";

/** Snapshots a disk directory before the request and returns an assertion
 *  that its contents are unchanged — the same idiom `placeVisitPhotos.test.ts`
 *  already uses for a single directory, generalised to every upload route's
 *  own directory here. */
function diskUntouched(dir: () => string): () => Promise<() => void> {
  return async () => {
    const before = fs.readdirSync(dir()).sort();
    return () => {
      expect(fs.readdirSync(dir()).sort()).toEqual(before);
    };
  };
}

/** The GPX route's "storage" is a database row, not a disk file (memory
 *  storage never touches disk at all) — so its untouched-check counts rows
 *  instead of listing a directory. */
const trackTableUntouched = async (): Promise<() => Promise<void>> => {
  const before = await prisma.tripRouteTrack.count();
  return async () => {
    expect(await prisma.tripRouteTrack.count()).toBe(before);
  };
};

interface UploadCase {
  name: string;
  path: string;
  field: string;
  filename: string;
  buffer: Buffer;
  snapshotStorage: () => Promise<() => Promise<void> | void>;
}

const uploads: UploadCase[] = [
  {
    name: "receipt",
    path: "/api/v1/uploads/receipt",
    field: "receipt",
    filename: "receipt.png",
    buffer: PNG,
    snapshotStorage: diskUntouched(getUploadDir),
  },
  {
    name: "trip photos",
    path: `/api/v1/trips/${NIL}/photos`,
    field: "photos",
    filename: "photo.png",
    buffer: PNG,
    snapshotStorage: diskUntouched(getTripPhotoDir),
  },
  {
    name: "trip cover",
    path: `/api/v1/trips/${NIL}/cover`,
    field: "cover",
    filename: "cover.png",
    buffer: PNG,
    snapshotStorage: diskUntouched(getTripPhotoDir),
  },
  {
    name: "place visit photos",
    path: `/api/v1/places/visits/${NIL}/photos`,
    field: "photos",
    filename: "photo.png",
    buffer: PNG,
    snapshotStorage: diskUntouched(getPlacePhotoDir),
  },
  {
    name: "lodging photos",
    path: `/api/v1/lodging/${NIL}/photos`,
    field: "photos",
    filename: "photo.png",
    buffer: PNG,
    snapshotStorage: diskUntouched(getLodgingPhotoDir),
  },
  {
    name: "parser training sample",
    path: "/api/v1/training/upload",
    field: "file",
    filename: "sample.png",
    buffer: PNG,
    snapshotStorage: diskUntouched(getTrainingUploadDir),
  },
  {
    // Found by an independent review on 2026-09-17 (finding A5): the GPX
    // upload for a tour route section was the one upload route this list had
    // missed, and it reaches multer and an XML parser. A track is location
    // history, which is worse than a photograph to accept from a stranger and
    // then show to the next one.
    name: "tour route GPX",
    path: `/api/v1/trips/${NIL}/routes/${NIL}/tracks`,
    field: "file",
    filename: "track.gpx",
    buffer: GPX,
    snapshotStorage: trackTableUntouched,
  },
];

describe("upload routes and the shared demo account", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "uploadUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "uploadUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it.each(uploads)(
    "refuses the $name upload for the shared demo account before it touches storage",
    async ({ path, field, filename, buffer, snapshotStorage }) => {
      const assertUntouched = await snapshotStorage();

      const res = await request(app)
        .post(path)
        .set("Cookie", demoCookie)
        .attach(field, buffer, filename);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
      await assertUntouched();
    }
  );

  it.each(uploads.map(({ name, path }): [string, string] => [name, path]))(
    "does not refuse the %s upload for a normal account",
    async (_name, path) => {
      const res = await request(app).post(path).set("Cookie", userCookie);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    }
  );

  it("still lets the shared demo account read what is already there", async () => {
    // A trip of its own, so the read path is exercised rather than a 404 that
    // would pass whatever the guard did. The trip detail carries the photos.
    const trip = await prisma.trip.create({
      data: { userId: ids[0], name: "Demo trip", startDate: new Date("2026-01-01") },
      select: { id: true },
    });
    const res = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", demoCookie);
    expect(res.status).toBe(200);
    await prisma.trip.delete({ where: { id: trip.id } });
  });
});
