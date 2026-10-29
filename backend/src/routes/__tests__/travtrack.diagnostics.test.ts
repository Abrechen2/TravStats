import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { pruneDiagnostics } from "../../services/travtrack/diagnostics/ingest";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * The TravTrack diagnostics log (spec 2026-10-29-travtrack-diagnostics): only
 * a paired phone sends, a retry is answered from the receipt, an event with a
 * position is refused alone, the day is read per device against that device's
 * own points, and the log is gone after delete and after 14 days.
 */

const PREFIX = "travtrack-diag-";
const MIN = 60_000;

describe("TravTrack — /travtrack/diagnostics", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;
  let phone: string;

  async function token(deviceId: string | null) {
    const t = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId,
        label: deviceId ? `Phone ${deviceId}` : "Script",
        lookupHash: t.lookupHash,
        hash: t.hash,
        scope: "write",
        deviceId,
        platform: deviceId ? "ios" : null,
      },
    });
    return `Bearer ${t.plaintext}`;
  }

  const post = (body: object, auth = phone) =>
    request(app).post("/api/v1/travtrack/diagnostics").set("Authorization", auth).send(body);

  // Yesterday on the UTC clock (the profile has no zone), so every event is fresh.
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const at = (hh: number, mm = 0) => Date.parse(`${day}T00:00:00Z`) + (hh * 60 + mm) * MIN;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function storePoints(deviceId: string, fromMs: number, minutes: number) {
    await prisma.travTrackPoint.createMany({
      data: Array.from({ length: minutes }, (_, i) => {
        const t = fromMs + i * MIN;
        return {
          userId,
          t: new Date(t),
          tS: Math.floor(t / 1000),
          lat: 48 + i / 1000,
          lon: 11 + i / 1000,
          origin: `companion:${deviceId}`,
          originRef: `${deviceId}:${t}`,
          deviceId,
        };
      }),
    });
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    const u = await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackDiagnosticEvent.deleteMany({ where: { userId } });
    await prisma.travTrackDiagnosticUpload.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    phone = await token("phone-1");
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("says in the capabilities that it takes the log", async () => {
    const res = await request(app).get("/api/v1/travtrack/capabilities").set("Cookie", cookie);
    expect(res.body.diagnostics).toBe(true);
  });

  it("takes events only from a paired device", async () => {
    const body = { uploadId: "u1", events: [{ t: iso(at(8)), kind: "note", data: { code: "x" } }] };
    const web = await request(app)
      .post("/api/v1/travtrack/diagnostics")
      .set("Cookie", cookie)
      .send(body);
    expect(web.status).toBe(403);
    const script = await token(null);
    const res = await post(body, script);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DEVICE_REQUIRED");
  });

  it("refuses an event with a position alone and replays a retry", async () => {
    const body = {
      uploadId: "u1",
      device: { model: "iPhone15,2", os: "iOS 26.1", appVersion: "1.4.0 (212)" },
      events: [
        { t: iso(at(8)), kind: "lifecycle", data: { event: "launch" } },
        { t: iso(at(8, 1)), kind: "note", data: { lat: 48.137 } },
      ],
    };
    const first = await post(body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      stored: 1,
      rejected: [{ index: 1, reason: "coordinates" }],
    });

    const again = await post(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ stored: 1, replayed: true });
    expect(await prisma.travTrackDiagnosticEvent.count({ where: { userId } })).toBe(1);

    const changed = await post({ ...body, events: body.events.slice(0, 1).concat(body.events) });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("RECORDING_UPLOAD_ID_REUSED");
  });

  it("explains a device's gap from its own log, not another phone's points", async () => {
    await storePoints("phone-1", at(6), 60);
    await storePoints("phone-1", at(9), 60);
    // A second phone recorded through the hole; it must not fill it.
    await storePoints("phone-2", at(7), 120);
    const res = await post({
      uploadId: "u2",
      events: [
        { t: iso(at(5)), kind: "permission", data: { status: "always" } },
        {
          t: iso(at(7, 30)),
          kind: "fixes",
          data: { received: 40, kept: 0, dropped: { accuracy: 30 } },
        },
        {
          t: iso(at(7, 30)),
          kind: "fixes",
          data: { received: 10, kept: 0, dropped: { accuracy: 10 } },
        },
      ],
    });
    expect(res.status).toBe(201);

    const read = await request(app)
      .get(`/api/v1/travtrack/diagnostics/day?date=${day}&deviceId=phone-1`)
      .set("Cookie", cookie);
    expect(read.status).toBe(200);
    expect(read.body.devices.map((d: { deviceId: string }) => d.deviceId).sort()).toEqual([
      "phone-1",
      "phone-2",
    ]);
    const gap = read.body.gaps.find((g: { from: string }) => g.from === iso(at(7) - MIN));
    expect(gap).toMatchObject({ cause: "droppedOnPhone", evidence: { fixesReceived: 50 } });
    expect(gap.evidence.dropped).toEqual({ accuracy: 40 });
    expect(read.body.fixesPerMinute).toEqual([
      { t: iso(at(7, 30)), received: 50, kept: 0, dropped: { accuracy: 40 } },
    ]);
  });

  it("reads the 30 minutes before midnight, so an early gap is not 'no log'", async () => {
    await storePoints("phone-1", at(0, 20), 40);
    await post({
      uploadId: "u5",
      events: [
        { t: iso(at(0) - 10 * MIN), kind: "power", data: { battery: 0.8 } },
        { t: iso(at(3)), kind: "note", data: { code: "sendNow" } },
      ],
    });
    const read = await request(app)
      .get(`/api/v1/travtrack/diagnostics/day?date=${day}`)
      .set("Cookie", cookie);
    expect(read.body.gaps[0]).toMatchObject({ from: iso(at(0)), cause: "unexplained" });
  });

  it("keeps a log readable and deletable while TravTrack is off", async () => {
    await post({ uploadId: "u6", events: [{ t: iso(at(8)), kind: "note", data: { code: "a" } }] });
    await switches.set({ beta: true, config: false });
    const read = await request(app)
      .get(`/api/v1/travtrack/diagnostics/day?date=${day}`)
      .set("Cookie", cookie);
    expect(read.status).toBe(200);
    const gone = await request(app).delete("/api/v1/travtrack/diagnostics").set("Cookie", cookie);
    expect(gone.body).toEqual({ deleted: 1 });
  });

  it("exports the raw log as a file and deletes it on request", async () => {
    await post({
      uploadId: "u3",
      events: [{ t: iso(at(8)), kind: "power", data: { battery: 0.5 } }],
    });
    const file = await request(app)
      .get(`/api/v1/travtrack/diagnostics/export?from=${iso(at(0))}&to=${iso(at(24))}`)
      .set("Cookie", cookie);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toContain("attachment");
    expect(file.body.events).toEqual([
      { deviceId: "phone-1", t: iso(at(8)), kind: "power", data: { battery: 0.5 } },
    ]);

    const gone = await request(app).delete("/api/v1/travtrack/diagnostics").set("Cookie", cookie);
    expect(gone.body).toEqual({ deleted: 1 });
    expect(await prisma.travTrackDiagnosticUpload.count({ where: { userId } })).toBe(0);
  });

  it("prunes what is older than the retention", async () => {
    await post({ uploadId: "u4", events: [{ t: iso(at(8)), kind: "note", data: { code: "a" } }] });
    expect(await pruneDiagnostics(14)).toMatchObject({ events: 0 });
    const pruned = await pruneDiagnostics(0, Date.now() + MIN);
    expect(pruned.events).toBeGreaterThanOrEqual(1);
    expect(await prisma.travTrackDiagnosticEvent.count({ where: { userId } })).toBe(0);
  });
});
