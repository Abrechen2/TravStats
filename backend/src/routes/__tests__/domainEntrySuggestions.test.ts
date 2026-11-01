import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#405: the forms of ferry, rental, cruise and places suggest what the
 * user entered before. Every value is the user's own (another account's rows
 * are the proof of scoping), a typed provider/line/operator narrows the
 * vocabularies that belong to it, and an empty logbook is an answer, not a 404
 * (nor, for "/:id", a route swallowed by the domain's own router).
 */
describe("entry-suggestions of ferry, rental, cruise and places (forgejo#405)", () => {
  const stamp = Date.now();
  let userId: string;
  let otherId: string;
  let emptyId: string;
  let cookie: string;
  let emptyCookie: string;

  const get = (path: string, query: Record<string, string> = {}, as = cookie) =>
    request(app).get(`/api/v1/${path}/entry-suggestions`).query(query).set("Cookie", as);

  const crossing = (owner: string, day: string, extra: Record<string, unknown>) => ({
    userId: owner,
    depStationName: "Kiel",
    depLat: 54.3,
    depLon: 10.1,
    depCountry: "DE",
    arrStationName: "Oslo",
    arrLat: 59.9,
    arrLon: 10.7,
    arrCountry: "NO",
    departureTime: new Date(`${day}T15:00:00Z`),
    ...extra,
  });

  const rental = (owner: string, extra: Record<string, unknown>) => ({
    userId: owner,
    provider: "Sixt",
    pickupStationName: "Lisbon Airport",
    pickupLat: 38.78,
    pickupLon: -9.13,
    pickupTimezone: "Europe/Lisbon",
    returnStationName: "Lisbon Airport",
    returnLat: 38.78,
    returnLon: -9.13,
    returnTimezone: "Europe/Lisbon",
    pickupTime: new Date("2025-05-01T10:00:00Z"),
    returnTime: new Date("2025-05-08T10:00:00Z"),
    ...extra,
  });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const make = async (name: string) =>
      (await prisma.user.create({ data: { username: `${name}-${stamp}`, passwordHash } })).id;
    userId = await make("dom-suggest");
    otherId = await make("dom-suggest-other");
    emptyId = await make("dom-suggest-empty");
    cookie = `auth_token=${generateToken(userId)}`;
    emptyCookie = `auth_token=${generateToken(emptyId)}`;

    await prisma.ferryJourney.createMany({
      data: [
        crossing(userId, "2025-01-10", {
          operator: "Color Line",
          vesselName: "Color Magic",
          fareClass: "Economy",
        }),
        crossing(userId, "2025-02-10", { operator: "Color Line", vesselName: "Color Magic" }),
        crossing(userId, "2025-03-10", { operator: "Stena Line", vesselName: "Stena Saga" }),
        crossing(otherId, "2025-03-11", { operator: "Stranger Ferries", vesselName: "Hidden" }),
      ],
    });
    await prisma.rentalBooking.createMany({
      data: [
        rental(userId, { vehicleClass: "Compact", vehicleExample: "VW Golf or similar" }),
        rental(userId, { vehicleClass: "Compact" }),
        rental(userId, { provider: "Europcar", vehicleClass: "SUV", broker: "Check24" }),
        rental(otherId, { provider: "Stranger Cars", vehicleClass: "Tank" }),
      ],
    });
    await prisma.cruise.createMany({
      data: [
        { userId, cruiseLine: "AIDA", routeName: "Mittelmeer" },
        { userId, cruiseLine: "AIDA", routeName: "Mittelmeer" },
        { userId, cruiseLine: "TUI Cruises", routeName: "Norwegen" },
        { userId: otherId, cruiseLine: "Stranger Line", routeName: "Hidden" },
      ],
    });
    await prisma.place.createMany({
      data: [
        {
          userId,
          name: "Café A",
          lat: 41.9,
          lon: 12.5,
          city: "Rom",
          country: "Italien",
          isoCountryCode: "IT",
        },
        {
          userId,
          name: "Café B",
          lat: 41.9,
          lon: 12.5,
          city: "Rom",
          country: "Italien",
          isoCountryCode: "IT",
        },
        {
          userId,
          name: "Bar C",
          lat: 43.7,
          lon: 11.2,
          city: "Florenz",
          country: "Italien",
          isoCountryCode: "IT",
        },
        { userId: otherId, name: "Other", lat: 1, lon: 1, city: "Romanshorn", country: "Schweiz" },
      ],
    });
  });

  afterAll(async () => {
    const ids = [userId, otherId, emptyId];
    await prisma.ferryJourney.deleteMany({ where: { userId: { in: ids } } });
    await prisma.rentalBooking.deleteMany({ where: { userId: { in: ids } } });
    await prisma.cruise.deleteMany({ where: { userId: { in: ids } } });
    await prisma.place.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("ferry: operators by count, vessels narrowed to the typed operator, ports from both ends", async () => {
    const all = await get("ferry");
    expect(all.status).toBe(200);
    expect(all.body.data.operators).toEqual(["Color Line", "Stena Line"]);
    expect(JSON.stringify(all.body)).not.toContain("Stranger");
    expect(JSON.stringify(all.body)).not.toContain("Hidden");

    const stena = await get("ferry", { operator: "stena line" });
    expect(stena.body.data.vessels).toEqual(["Stena Saga"]);
    expect(stena.body.data.fareClasses).toEqual([]);

    const ports = await get("ferry", { depName: "osl" });
    expect(ports.body.data.terminals).toEqual([
      { name: "Oslo", address: null, lat: 59.9, lon: 10.7, country: "NO" },
    ]);
  });

  it("rental: providers, brokers and the classes of the typed provider only", async () => {
    const all = await get("rentals");
    expect(all.status).toBe(200);
    expect(all.body.data.providers).toEqual(["Sixt", "Europcar"]);
    expect(all.body.data.brokers).toEqual(["Check24"]);
    expect(JSON.stringify(all.body)).not.toContain("Stranger");
    expect(JSON.stringify(all.body)).not.toContain("Tank");

    const sixt = await get("rentals", { provider: "SIXT" });
    expect(sixt.body.data.vehicleClasses).toEqual(["Compact"]);
    expect(sixt.body.data.vehicleExamples).toEqual(["VW Golf or similar"]);
  });

  it("cruise: lines by count and the route names of the typed line", async () => {
    const all = await get("cruises");
    expect(all.status).toBe(200);
    expect(all.body.data.cruiseLines).toEqual(["AIDA", "TUI Cruises"]);
    expect(JSON.stringify(all.body)).not.toContain("Stranger");

    const aida = await get("cruises", { cruiseLine: "aida" });
    expect(aida.body.data.routeNames).toEqual(["Mittelmeer"]);
  });

  it("places: cities that start with what is typed, with country and ISO code together", async () => {
    const res = await get("places", { city: "ro" });
    expect(res.status).toBe(200);
    // "Romanshorn" belongs to another account: not offered.
    expect(res.body.data.cities).toEqual([
      { city: "Rom", country: "Italien", isoCountryCode: "IT" },
    ]);
    // The country list follows the country field, not the city: all the user's own countries.
    expect(res.body.data.countries).toEqual([{ country: "Italien", isoCountryCode: "IT" }]);

    const countries = await get("places", { country: "ital" });
    expect(countries.body.data.countries).toEqual([{ country: "Italien", isoCountryCode: "IT" }]);
  });

  it("answers an empty logbook with empty lists on all four, not a 404 from the :id route", async () => {
    for (const path of ["ferry", "rentals", "cruises", "places"]) {
      const res = await get(path, {}, emptyCookie);
      expect(res.status).toBe(200);
      for (const value of Object.values(res.body.data as Record<string, unknown[]>)) {
        expect(value).toEqual([]);
      }
    }
  });

  it("refuses an unauthenticated read", async () => {
    for (const path of ["ferry", "rentals", "cruises", "places"]) {
      const res = await request(app).get(`/api/v1/${path}/entry-suggestions`);
      expect(res.status).toBe(401);
    }
  });
});
