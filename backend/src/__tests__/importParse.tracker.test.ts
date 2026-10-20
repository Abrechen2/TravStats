/**
 * forgejo#311 — a tracker export end to end through the existing import
 * path: /import/parse recognises and reads it, /import/preview resolves it,
 * /flights/batch stores it with its source and a provenance key, and a
 * second run of the same file adds nothing.
 */
import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../index";
import { prisma } from "../db";

const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, "fixtures/trackers", name), "utf-8");

describe("tracker exports through /import/parse → preview → /flights/batch", () => {
  let cookie: string[];

  const clean = async (): Promise<void> => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "tracker-import", password: "password123" })
      .expect(201);
    cookie = [registration.headers["set-cookie"]].flat();
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  /** The same mapping as the browser's commitPreviewRows. */
  const toBatch = (rows: Array<Record<string, unknown>>, dataSource: string) =>
    rows.map((r) => ({
      airline: r.airline,
      flightNumber: r.flightNumberNormalised,
      departure: { iata: r.fromIata, lat: r.depLat, lon: r.depLon },
      arrival: { iata: r.toIata, lat: r.arrLat, lon: r.arrLon },
      departureLocal: r.departureLocal,
      arrivalLocal: r.arrivalLocalCorrected || null,
      depTimezone: r.depTimezone,
      arrTimezone: r.arrTimezone,
      depTimeSemantics: r.timeSemantics,
      arrTimeSemantics: r.timeSemantics,
      ...(r.datePrecision ? { datePrecision: r.datePrecision } : {}),
      bookingReference: r.bookingReference,
      status: r.statusDefault,
      dataSource,
    }));

  const parse = (body: object) =>
    request(app).post("/api/v1/import/parse").set("Cookie", cookie).send(body);

  it("recognises the format and returns the rows", async () => {
    const res = await parse({ source: "tracker", content: fixture("flighty.csv") }).expect(200);
    expect(res.body.format).toBe("flighty");
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.parserErrors).toEqual([expect.objectContaining({ code: "cancelled" })]);
  });

  it("answers an unknown file with what it expected, not with zero rows", async () => {
    const res = await parse({ source: "tracker", content: "a,b\n1,2\n" }).expect(200);
    expect(res.body.format).toBeNull();
    expect(res.body.rows).toEqual([]);
    expect(res.body.parserErrors[0].code).toBe("unknownFormat");
    expect(res.body.expected.openflights).toContain("Flight_Number");
  });

  it("reads a file as the format the caller names", async () => {
    const res = await parse({
      source: "tracker",
      format: "jetlog",
      content: fixture("flighty.csv"),
    }).expect(200);
    expect(res.body.format).toBe("jetlog");
    expect(res.body.parserErrors[0]).toMatchObject({ code: "missingHeader", value: "date" });
  });

  it("refuses a format it does not know", async () => {
    await parse({ source: "tracker", format: "tripit", content: "x" }).expect(400);
  });

  it("stores a Jetlog export with its source and recognises it the second time", async () => {
    const parsed = await parse({ source: "tracker", content: fixture("jetlog.csv") }).expect(200);
    const preview = await request(app)
      .post("/api/v1/import/preview")
      .set("Cookie", cookie)
      .send({ rows: parsed.body.rows })
      .expect(200);
    const rows = preview.body.rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.fromIata, r.toIata])).toEqual([
      ["FRA", "JFK"],
      ["MUC", "HKG"],
      ["LHR", "FRA"],
    ]);

    const payload = toBatch(rows, "imported_jetlog");
    const first = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", cookie)
      .send(payload)
      .expect(201);
    expect(first.body.count).toBe(3);

    const stored = await prisma.flight.findMany({ orderBy: { departureTime: "asc" } });
    expect(stored.map((f) => f.dataSource)).toEqual([
      "imported_jetlog",
      "imported_jetlog",
      "imported_jetlog",
    ]);
    expect(stored.every((f) => f.externalRef?.startsWith("import:"))).toBe(true);
    // The overnight leg lands on its own day: MUC 21:45 → HKG next day 15:30.
    const hkg = stored.find((f) => f.arrIata === "HKG");
    expect(hkg?.arrivalTime?.toISOString()).toBe("2023-08-21T07:30:00.000Z");
    // The day-and-route-only line is kept, as the form keeps one: historical.
    const dayOnly = stored.find((f) => f.depIata === "LHR");
    expect(dayOnly?.status).toBe("historical");

    const second = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", cookie)
      .send(payload)
      .expect(201);
    expect(second.body.count).toBe(0);
    expect(second.body.skipped).toBe(3);
  });

  it("stores an OpenFlights year-only flight with its precision", async () => {
    const parsed = await parse({ source: "tracker", content: fixture("openflights.csv") }).expect(
      200
    );
    expect(parsed.body.format).toBe("openflights");
    const preview = await request(app)
      .post("/api/v1/import/preview")
      .set("Cookie", cookie)
      .send({ rows: parsed.body.rows })
      .expect(200);
    const rows = preview.body.rows as Array<Record<string, unknown>>;
    expect(rows.every((r) => (r.flags as string[]).length === 0)).toBe(true);
    await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", cookie)
      .send(toBatch(rows, "imported_openflights"))
      .expect(201);
    const yearOnly = await prisma.flight.findFirst({ where: { depIata: "JFK" } });
    expect(yearOnly?.status).toBe("historical");
    expect(yearOnly?.dataSource).toBe("imported_openflights");
    expect(yearOnly?.depPrecision).toBe("year");
    const icao = await prisma.flight.findFirst({ where: { flightNumber: "LH901" } });
    expect([icao?.depIata, icao?.arrIata]).toEqual(["LHR", "FRA"]);
  });
});
