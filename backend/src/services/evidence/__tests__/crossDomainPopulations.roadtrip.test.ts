import { prisma } from "../../../db";
import { loadCrossDomainPopulation } from "../crossDomainPopulations";

/**
 * Roadtrips in the cross-domain overview (2.7): one event spanning the
 * stations' days, countries read from the stations' coordinates, and a
 * roadtrip that has not started yet counting nowhere.
 */

const USER = "crossdomainroadtrip";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("cross-domain population — roadtrips", () => {
  let userId: string;

  async function roadtrip(
    name: string,
    stops: Array<[number, number, string, string | null, string?]>
  ) {
    const route = await prisma.tripRoute.create({
      data: { userId, name, mode: "road", kind: "roadtrip" },
    });
    for (const [i, [lat, lon, start, end, stayCountry]] of stops.entries()) {
      const lodging = stayCountry
        ? await prisma.lodging.create({
            data: { userId, name: `Platz ${i}`, type: "campsite", isoCountryCode: stayCountry },
          })
        : null;
      const stay = lodging
        ? await prisma.lodgingStay.create({
            data: {
              userId,
              lodgingId: lodging.id,
              checkIn: d(start),
              checkOut: end ? d(end) : null,
            },
          })
        : null;
      await prisma.tripStop.create({
        data: {
          title: `s${i}`,
          lat,
          lon,
          startDate: d(start),
          endDate: end ? d(end) : null,
          routeId: route.id,
          routeOrderIdx: i,
          overnight: end !== null,
          lodgingStayId: stay?.id ?? null,
        },
      });
    }
    return route.id;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("files a past roadtrip as one event over its days, in the countries its stations stand in", async () => {
    const id = await roadtrip("Skandinavien", [
      [53.55, 9.99, "2024-07-12", null], // Hamburg — inland, the boundaries answer
      [57.59, 9.96, "2024-07-13", "2024-07-14", "DK"], // Hirtshals — shore, the stay answers
      [58.97, 5.73, "2024-07-14", "2024-07-16"], // Stavanger — shore, no stay: abstains
    ]);
    await roadtrip("Nächstes Jahr", [[47.8, 13.04, "2099-06-01", "2099-06-03"]]);

    const population = await loadCrossDomainPopulation(userId, ["roadtrip"]);
    expect(population.events).toHaveLength(1);
    expect(population.events[0]).toMatchObject({ domain: "roadtrip", year: 2024 });
    expect(population.events[0].entry).toMatchObject({ id, href: `/roadtrips/${id}` });
    expect(population.events[0].dayKeys).toHaveLength(5);
    expect(population.countryRows[0].countries.sort()).toEqual(["DE", "DK"]);
  });
});
