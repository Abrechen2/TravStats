import request from "supertest";
import { unzipSync, zipSync, strToU8 } from "fflate";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * Recordings out as GPX and back in (owner, 2026-09-25: tours move between
 * accounts WITH their recordings). The property that matters most: a
 * recording moved through our own file arrives with the figures it left
 * with, not with what a simplified line would re-measure.
 */
describe("track archive", () => {
  const USERS = ["archivesource", "archivetarget", "archivestranger"];
  let source: { id: string; cookie: string };
  let target: { id: string; cookie: string };
  let stranger: { cookie: string };
  let tourId: string;
  let trackId: string;

  const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  };

  async function user(name: string) {
    const u = await prisma.user.create({ data: { username: name, passwordHash: "x" } });
    return { id: u.id, cookie: `auth_token=${generateToken(u.id)}` };
  }

  function importFiles(cookie: string, files: Array<[string, Buffer]>, dryRun: boolean) {
    let req = request(app)
      .post("/api/v1/track-archive/import")
      .set("Cookie", cookie)
      .field("dryRun", String(dryRun));
    for (const [name, content] of files) req = req.attach("files", content, name);
    return req;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    source = await user(USERS[0]);
    target = await user(USERS[1]);
    stranger = await user(USERS[2]);
    const tour = await prisma.tripRoute.create({
      data: {
        userId: source.id,
        name: "Preikestolen",
        kind: "tour",
        mode: "foot",
        activity: "hike",
      },
    });
    tourId = tour.id;
    const track = await prisma.tripRouteTrack.create({
      data: {
        routeId: tour.id,
        source: "gpx",
        name: "Morgens hoch",
        startedAt: new Date("2026-09-20T07:00:00Z"),
        endedAt: new Date("2026-09-20T10:42:00Z"),
        geometry: [
          [6.19, 58.98],
          [6.2, 58.985],
          [6.21, 58.99],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 4.2, 8.1],
        pointCount: 4210,
        distanceKm: 8.1,
        ascentM: 512,
        descentM: 498,
        movingSeconds: 13320,
        elevations: [
          [0, 270],
          [8.1, 280],
        ],
      },
    });
    trackId = track.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  async function exportedGpx(): Promise<Buffer> {
    const res = await request(app)
      .get(`/api/v1/tours/${tourId}/tracks/${trackId}/gpx`)
      .set("Cookie", source.cookie)
      .buffer(true)
      .parse(binary);
    return res.body as Buffer;
  }

  it("hands one recording out as a GPX attachment, to its owner only", async () => {
    const res = await request(app)
      .get(`/api/v1/tours/${tourId}/tracks/${trackId}/gpx`)
      .set("Cookie", source.cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/gpx+xml");
    expect(res.headers["content-disposition"]).toContain("2026-09-20_Preikestolen.gpx");
    const other = await request(app)
      .get(`/api/v1/tours/${tourId}/tracks/${trackId}/gpx`)
      .set("Cookie", stranger.cookie);
    expect(other.status).toBe(404);
  });

  it("puts every recording into one ZIP", async () => {
    const res = await request(app)
      .get("/api/v1/track-archive")
      .set("Cookie", source.cookie)
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    const entries = unzipSync(new Uint8Array(res.body as Buffer));
    expect(Object.keys(entries)).toEqual(["2026-09-20_Preikestolen.gpx"]);
  });

  it("adds nothing when a file goes back into the account it came from", async () => {
    const res = await importFiles(source.cookie, [["back.gpx", await exportedGpx()]], false);
    expect(res.body.files).toEqual([
      expect.objectContaining({ action: "duplicate", tourId, tourName: "Preikestolen" }),
    ]);
    expect(await prisma.tripRouteTrack.count({ where: { routeId: tourId } })).toBe(1);
  });

  it("moves a tour into another account with the figures it left with, once", async () => {
    const zip = Buffer.from(zipSync({ "tour.gpx": new Uint8Array(await exportedGpx()) }));

    const preview = await importFiles(target.cookie, [["archiv.zip", zip]], true);
    expect(preview.body).toMatchObject({
      dryRun: true,
      files: [{ action: "createTour", tourName: "Preikestolen" }],
    });
    expect(await prisma.tripRoute.count({ where: { userId: target.id } })).toBe(0);

    await importFiles(target.cookie, [["archiv.zip", zip]], false);
    const moved = await prisma.tripRoute.findFirstOrThrow({
      where: { userId: target.id },
      include: { tracks: true },
    });
    expect(moved).toMatchObject({ name: "Preikestolen", kind: "tour", activity: "hike" });
    expect(moved.tracks[0]).toMatchObject({
      distanceKm: 8.1,
      ascentM: 512,
      descentM: 498,
      movingSeconds: 13320,
      pointCount: 4210,
      cumulativeKm: [0, 4.2, 8.1],
    });

    const again = await importFiles(target.cookie, [["archiv.zip", zip]], false);
    expect(again.body.files[0].action).toBe("duplicate");
    expect(await prisma.tripRouteTrack.count({ where: { route: { userId: target.id } } })).toBe(1);
  });

  it("makes someone else's GPX a new day tour, and the same file twice one recording", async () => {
    const gpx = Buffer.from(`<?xml version="1.0"?>
<gpx version="1.1" creator="Garmin" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Morgenlauf</name><trkseg>
    <trkpt lat="53.55" lon="10.0"><ele>5</ele><time>2026-09-21T06:00:00Z</time></trkpt>
    <trkpt lat="53.56" lon="10.01"><ele>8</ele><time>2026-09-21T06:05:00Z</time></trkpt>
    <trkpt lat="53.57" lon="10.02"><ele>6</ele><time>2026-09-21T06:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`);
    const first = await importFiles(target.cookie, [["lauf.gpx", gpx]], false);
    expect(first.body.files[0]).toMatchObject({ action: "createTour", tourName: "Morgenlauf" });
    const second = await importFiles(target.cookie, [["lauf-kopie.gpx", gpx]], false);
    expect(second.body.files[0].action).toBe("duplicate");
  });

  it("says why a recording without times cannot be placed", async () => {
    const gpx = Buffer.from(
      `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>` +
        `<trkpt lat="53.55" lon="10.0"/><trkpt lat="53.56" lon="10.01"/></trkseg></trk></gpx>`
    );
    const res = await importFiles(target.cookie, [["ohnezeit.gpx", gpx]], true);
    expect(res.body.files[0]).toMatchObject({ action: "error", message: "noTimestamps" });
  });

  it("does not invent a roadtrip from a recording — its stations come from the spreadsheet", async () => {
    const roadtrip = await prisma.tripRoute.create({
      data: { userId: source.id, name: "Fjorde", kind: "roadtrip", mode: "road" },
    });
    const track = await prisma.tripRouteTrack.create({
      data: {
        routeId: roadtrip.id,
        source: "gpx",
        startedAt: new Date("2026-09-18T08:00:00Z"),
        endedAt: new Date("2026-09-18T18:00:00Z"),
        geometry: [
          [10, 53.55],
          [9.96, 57.59],
        ],
        pointCount: 2,
        distanceKm: 482,
      },
    });
    const gpx = (
      await request(app)
        .get(`/api/v1/tours/${roadtrip.id}/tracks/${track.id}/gpx`)
        .set("Cookie", source.cookie)
        .buffer(true)
        .parse(binary)
    ).body as Buffer;

    const missing = await importFiles(target.cookie, [["fjorde.gpx", gpx]], true);
    expect(missing.body.files[0]).toMatchObject({ action: "error", message: "roadtripNotFound" });

    await prisma.tripRoute.create({
      data: { userId: target.id, name: "Fjorde", kind: "roadtrip", mode: "road" },
    });
    const found = await importFiles(target.cookie, [["fjorde.gpx", gpx]], true);
    expect(found.body.files[0]).toMatchObject({ action: "attach", tourName: "Fjorde" });
  });

  it("refuses an archive whose unpacked content is past the limit, without unpacking it", async () => {
    const big = new Uint8Array(16 * 1024 * 1024); // zeros: a few KB packed
    const zip = Buffer.from(zipSync({ "big.gpx": big, "ok.gpx": strToU8("<gpx/>") }));
    const res = await importFiles(target.cookie, [["bomb.zip", zip]], true);
    expect(res.status).toBe(413);
  });
});
