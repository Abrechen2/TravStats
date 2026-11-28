/**
 * Security review of sharing UAT 2: the cap on ports one received message may add counted per
 * ENTRY in the entries-up path, so a message with many cruises could add far more. It now counts
 * across the whole message: three cruises of 15 new ports each, sent up together, add at most the
 * cap.
 */
import { randomUUID } from "crypto";

import { MAX_CARRIED_PORTS_PER_MESSAGE } from "../../../ports/uncodedPort";
import { sharedFlight } from "./sharedTripFixtures";
import { B, servers, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const tag = randomUUID().slice(0, 6);
afterAll(async () => {
  for (const s of [a, b]) {
    await s.prisma.cruise.deleteMany({ where: { routeName: { startsWith: `Cap ${tag}` } } });
    await s.prisma.port.deleteMany({ where: { name: { startsWith: `Cap ${tag}` } } });
  }
});

it("one entries-up message with many cruises adds at most the cap of new ports", async () => {
  const PER_CRUISE = 15;
  const CRUISES = 3;
  expect(PER_CRUISE).toBeLessThan(MAX_CARRIED_PORTS_PER_MESSAGE);
  expect(PER_CRUISE * CRUISES).toBeGreaterThan(MAX_CARRIED_PORTS_PER_MESSAGE);

  const t = await sharedFlight(a, b);
  await b.restore.suspendTripFederationAfterRestore();
  for (let c = 0; c < CRUISES; c++) {
    const ports = [];
    for (let i = 0; i < PER_CRUISE; i++)
      ports.push(
        await b.prisma.port.create({
          data: {
            name: `Cap ${tag} ${c}-${i}`,
            unlocode: null,
            lat: 10 + c * 5 + i * 0.1,
            lon: 100 + i * 0.1,
            country: "China",
            isUserAdded: true,
          },
        })
      );
    const cruise = await b.prisma.cruise.create({
      data: {
        userId: t.ben,
        tripId: t.benTrip,
        routeName: `Cap ${tag} ${c}`,
        departurePortId: ports[0].id,
        arrivalPortId: ports[PER_CRUISE - 1].id,
        startDate: new Date(`2030-06-0${c + 1}T00:00:00.000Z`),
        endDate: new Date(`2030-06-0${c + 2}T00:00:00.000Z`),
        stops: {
          create: ports.map((p, i) => ({ dayNumber: i + 1, portId: p.id, position: i })),
        },
      },
    });
    await b.propagate.propagateWrite(b.prisma, t.ben, "cruise", cruise.id);
  }
  await b.lifecycle.reconfirmTrip(t.ben, t.benTrip);
  await b.outbox.runDeliveries();

  const added = await a.prisma.port.count({
    where: { name: { startsWith: `Cap ${tag}` }, carriedFrom: B },
  });
  expect(added).toBe(MAX_CARRIED_PORTS_PER_MESSAGE);
});
