/**
 * forgejo#440 across two servers: Anna on A offers "Portugal 2030" to Ben on B, who already holds
 * the same trip of his own — one stay more, no rail ride, his flight half an hour later. Instead
 * of accepting a second copy, Ben links the offer with his trip: the dry run (read from A before
 * any answer) names the differences, the link keys the matched entries and creates nothing — also
 * not when A's entries arrive afterwards — and later changes travel both ways as for any share.
 */
import { randomUUID } from "crypto";
import { addFlight, editFlight, gateOf, pairAcross } from "./sharedTripFixtures";
import { servers, user, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function stay(
  s: Server,
  userId: string,
  tripId: string,
  name: string,
  from: string,
  to: string
) {
  const lodging = await s.prisma.lodging.create({
    data: { userId, name, city: "Lisboa", country: "PT", isoCountryCode: "PT" },
  });
  return s.prisma.lodgingStay.create({
    data: {
      userId,
      tripId,
      lodgingId: lodging.id,
      checkIn: day(from),
      checkOut: day(to),
      checkInDate: day(from),
      checkOutDate: day(to),
      stayZone: "Europe/Lisbon",
    },
  });
}

async function setup() {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  const remote = await pairAcross(a, anna, b, ben);
  const period = { startDay: day("2030-06-01"), endDay: day("2030-06-10") };
  const annasTrip = await a.prisma.trip.create({
    data: { userId: anna, name: "Portugal 2030", ...period },
  });
  const annasFlight = await addFlight(a, anna, annasTrip.id);
  await stay(a, anna, annasTrip.id, "Hotel Avenida", "2030-06-01", "2030-06-05");
  await a.prisma.railJourney.create({
    data: {
      userId: anna,
      tripId: annasTrip.id,
      depStationName: "Lisboa Oriente",
      depLat: 38.77,
      depLon: -9.1,
      arrStationName: "Porto Campanhã",
      arrLat: 41.15,
      arrLon: -8.59,
      departureTime: new Date("2030-06-05T09:00:00.000Z"),
      depTimezone: "Europe/Lisbon",
      arrTimezone: "Europe/Lisbon",
    },
  });
  const bensTrip = await b.prisma.trip.create({
    data: { userId: ben, name: "Portugal", ...period },
  });
  const bensFlight = await addFlight(b, ben, bensTrip.id);
  await b.prisma.flight.update({
    where: { id: bensFlight.id },
    data: { departureTime: new Date("2030-06-01T08:30:00.000Z") },
  });
  await stay(b, ben, bensTrip.id, "Hotel Avenida", "2030-06-01", "2030-06-05");
  await stay(b, ben, bensTrip.id, "Pensão Amor", "2030-06-05", "2030-06-06");
  await a.offers.offerTrip(anna, annasTrip.id, remote.id);
  const [offer] = await b.offerInbox.listReceivedOffers(ben);
  return { anna, ben, annasTrip, annasFlight, bensTrip, bensFlight, offer };
}

const count = async (s: Server, userId: string) => ({
  flights: await s.prisma.flight.count({ where: { userId } }),
  stays: await s.prisma.lodgingStay.count({ where: { userId } }),
  rail: await s.prisma.railJourney.count({ where: { userId } }),
  trips: await s.prisma.trip.count({ where: { userId } }),
});

it("the dry run reads the offered entries from A and names every difference, writing nothing", async () => {
  const { ben, bensTrip, offer } = await setup();
  const candidates = await b.offerLink.offerLinkCandidates(ben, offer.id);
  expect(candidates.candidates).toEqual([
    expect.objectContaining({ id: bensTrip.id, reason: "period" }),
  ]);

  const preview = await b.offerLink.previewOfferLink(ben, offer.id, bensTrip.id);
  expect(preview.access).toBe("full");
  if (preview.access !== "full") throw new Error("expected the full dry run");
  expect(preview.byType).toEqual(
    expect.arrayContaining([
      { entity: "lodgingStay", here: 2, there: 1, matched: 1, differing: 0 },
      { entity: "rail", here: 0, there: 1, matched: 0, differing: 0 },
    ])
  );
  expect(preview.onlyHere).toEqual([expect.objectContaining({ entity: "lodgingStay" })]);
  expect(preview.onlyThere).toEqual([expect.objectContaining({ entity: "rail" })]);
  const flight = preview.matched.find((m) => m.entity === "flight");
  expect(flight?.conflicts.map((c) => c.field)).toContain("departureTime");
  // Nothing written: the offer still waits, Ben's trip is in no group.
  expect(await b.offerInbox.listReceivedOffers(ben)).toHaveLength(1);
  expect(
    (await b.prisma.trip.findUniqueOrThrow({ where: { id: bensTrip.id } })).shareGroupId
  ).toBeNull();
});

it("linking keys the matches, creates nothing — not even when A's entries arrive — and changes propagate", async () => {
  const { anna, ben, annasFlight, bensTrip, bensFlight, offer } = await setup();
  const before = await count(b, ben);

  const result = await b.offerLink.linkOffer(ben, offer.id, bensTrip.id, "theirs");
  expect(result).toMatchObject({ linked: 2, onlyHere: 1, onlyThere: 1, settled: 1 });
  await a.outbox.runDeliveries();

  expect(await count(b, ben)).toEqual(before);
  const linkedFlight = await b.prisma.flight.findUniqueOrThrow({ where: { id: bensFlight.id } });
  const homeFlight = await a.prisma.flight.findUniqueOrThrow({ where: { id: annasFlight.id } });
  expect(linkedFlight.shareKey).toBe(homeFlight.shareKey);
  // "theirs": A's departure is Ben's now.
  expect(linkedFlight.departureTime.toISOString()).toBe("2030-06-01T08:00:00.000Z");
  expect(await b.offerInbox.listReceivedOffers(ben)).toHaveLength(0);

  // A later change at the home reaches Ben's own (linked) flight.
  await editFlight(a, anna, annasFlight.id, { gate: "B7" });
  await a.outbox.runDeliveries();
  expect(await gateOf(b, bensFlight.id)).toBe("B7");
  expect(await count(b, ben)).toEqual(before);
});

it("'mine' sends Ben's departure to the home as an ordinary fact update", async () => {
  const { ben, annasFlight, bensTrip, offer } = await setup();
  await b.offerLink.linkOffer(ben, offer.id, bensTrip.id, "mine");
  await a.outbox.runDeliveries();
  await b.outbox.runDeliveries();
  const homeFlight = await a.prisma.flight.findUniqueOrThrow({ where: { id: annasFlight.id } });
  expect(homeFlight.departureTime.toISOString()).toBe("2030-06-01T08:30:00.000Z");
});

it("before the consent with Anna is accepted, the dry run holds nothing of hers", async () => {
  const { ben, bensTrip, offer } = await setup();
  const remoteIds = (
    await b.prisma.remoteShareAccount.findMany({ where: { userId: ben }, select: { id: true } })
  ).map((r) => r.id);
  await b.prisma.shareConsent.updateMany({
    where: {
      OR: [{ remoteRequesterId: { in: remoteIds } }, { remoteTargetId: { in: remoteIds } }],
    },
    data: { status: "pending" },
  });
  const preview = await b.offerLink.previewOfferLink(ben, offer.id, bensTrip.id);
  expect(preview).toEqual({ access: "awaitingConsent" });
});

it("an answer that does not arrive puts every entry's prior key back and the offer waits again", async () => {
  const { ben, bensTrip, bensFlight, offer } = await setup();
  const stale = randomUUID();
  await b.prisma.flight.update({ where: { id: bensFlight.id }, data: { shareKey: stale } });
  const spy = jest
    .spyOn(b.offerInbox, "answerTo")
    .mockRejectedValueOnce(new Error("connection reset"));
  try {
    await expect(b.offerLink.linkOffer(ben, offer.id, bensTrip.id, "both")).rejects.toBeTruthy();
  } finally {
    spy.mockRestore();
  }
  expect((await b.prisma.flight.findUniqueOrThrow({ where: { id: bensFlight.id } })).shareKey).toBe(
    stale
  );
  expect(
    await b.prisma.lodgingStay.count({ where: { userId: ben, shareKey: { not: null } } })
  ).toBe(0);
  expect(
    (await b.prisma.trip.findUniqueOrThrow({ where: { id: bensTrip.id } })).shareGroupId
  ).toBeNull();
  expect(await b.offerInbox.listReceivedOffers(ben)).toHaveLength(1);
});

it("a settle that fails after the other server accepted keeps the link and says settleFailed", async () => {
  const { ben, bensTrip, offer } = await setup();
  const spy = jest
    .spyOn(b.adapters.ADAPTERS.flight, "apply")
    .mockRejectedValueOnce(new Error("disk full"));
  let result;
  try {
    result = await b.offerLink.linkOffer(ben, offer.id, bensTrip.id, "theirs");
  } finally {
    spy.mockRestore();
  }
  expect(result).toMatchObject({ settleFailed: true, linked: 2 });
  expect(
    (await b.prisma.trip.findUniqueOrThrow({ where: { id: bensTrip.id } })).shareGroupId
  ).not.toBeNull();
});
