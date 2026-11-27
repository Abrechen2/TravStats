/**
 * "Alle passenden Reisen verknüpfen" across two servers (UAT 2026-11-27). The owner on A has three
 * trips his father on B holds too. The sending side lists the trips the father travelled on and
 * offers them; the father's inbox pairs each offer with his own trip, links the ones whose
 * differences the quality rule settles (only a better line here), leaves the real conflict for
 * him, duplicates nothing on a repeat, and one pair is undone by leaving its group.
 */
import { addFlight, pairAcross } from "./sharedTripFixtures";
import { servers, user, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const LINE = Array.from({ length: 40 }, (_, i) => [10.1 + i * 0.01, 54.3 + i * 0.1]);

const ferry = (s: Server, userId: string, tripId: string, drawn: boolean) =>
  s.prisma.ferryJourney.create({
    data: {
      userId,
      tripId,
      operator: "Color Line",
      depStationName: "Kiel",
      depLat: 54.32,
      depLon: 10.14,
      depTimezone: "Europe/Berlin",
      arrStationName: "Oslo",
      arrLat: 59.9,
      arrLon: 10.74,
      arrTimezone: "Europe/Oslo",
      departureTime: new Date("2031-07-02T12:00:00Z"),
      arrivalTime: new Date("2031-07-03T08:00:00Z"),
      geometry: drawn ? LINE : [LINE[0], LINE[LINE.length - 1]],
      geometrySource: drawn ? "manual" : "straight",
    },
  });

async function trip(s: Server, userId: string, name: string, from: string, to: string) {
  return s.prisma.trip.create({
    data: { userId, name, startDay: day(from), endDay: day(to) },
  });
}

async function setup() {
  const owner = await user(a, "Owner");
  const father = await user(b, "Father");
  const remote = await pairAcross(a, owner, b, father);
  const companion = await a.prisma.companion.create({
    data: {
      userId: owner,
      canonicalName: "papa",
      displayName: "Papa",
      searchName: "papa",
      linkedRemoteId: remote.id,
    },
  });
  const mine = {
    portugal: await trip(a, owner, "Portugal", "2030-06-01", "2030-06-10"),
    norway: await trip(a, owner, "Norwegen", "2031-07-01", "2031-07-05"),
    rome: await trip(a, owner, "Rom", "2032-04-01", "2032-04-04"),
    alone: await trip(a, owner, "Allein", "2033-01-01", "2033-01-02"),
  };
  for (const t of [mine.portugal, mine.norway, mine.rome])
    await a.prisma.tripCompanion.create({
      data: { tripId: t.id, companionId: companion.id, position: 0 },
    });
  await addFlight(a, owner, mine.portugal.id);
  await ferry(a, owner, mine.norway.id, true);
  const romeFlight = await addFlight(a, owner, mine.rome.id);
  await a.prisma.flight.update({
    where: { id: romeFlight.id },
    data: { departureTime: new Date("2032-04-01T08:00:00Z") },
  });

  const his = {
    portugal: await trip(b, father, "Portugal 2030", "2030-06-01", "2030-06-10"),
    norway: await trip(b, father, "Norwegen", "2031-07-01", "2031-07-05"),
    rome: await trip(b, father, "Rom", "2032-04-01", "2032-04-04"),
  };
  await addFlight(b, father, his.portugal.id);
  const hisFerry = await ferry(b, father, his.norway.id, false);
  const hisRome = await addFlight(b, father, his.rome.id);
  await b.prisma.flight.update({
    where: { id: hisRome.id },
    data: { departureTime: new Date("2032-04-01T08:00:00Z"), gate: "C3" },
  });
  return { owner, father, remote, mine, his, hisFerry };
}

const count = async (s: Server, userId: string) => ({
  trips: await s.prisma.trip.count({ where: { userId } }),
  flights: await s.prisma.flight.count({ where: { userId } }),
  ferries: await s.prisma.ferryJourney.count({ where: { userId } }),
});

it("the sending side lists the trips the father travelled on, and offers them one by one", async () => {
  const { owner, remote, mine } = await setup();
  const candidates = await a.bulkLink.remoteBulkOfferCandidates(owner, remote.id);
  expect(candidates.map((c) => c.id)).toEqual([mine.portugal.id, mine.norway.id, mine.rome.id]);
  expect(candidates.every((c) => !c.offered)).toBe(true);
  for (const c of candidates) await a.offers.offerTrip(owner, c.id, remote.id);
  const again = await a.bulkLink.remoteBulkOfferCandidates(owner, remote.id);
  expect(again.every((c) => c.offered)).toBe(true);
});

it("the father's inbox pairs every offer, links the automatic ones by quality, and leaves the conflict", async () => {
  const { owner, father, remote, his, hisFerry } = await setup();
  for (const c of await a.bulkLink.remoteBulkOfferCandidates(owner, remote.id))
    await a.offers.offerTrip(owner, c.id, remote.id);
  const before = await count(b, father);

  const listed = await b.bulkLink.remoteBulkPairs(father);
  if (listed.access !== "full") throw new Error("expected the pairs");
  expect(listed.pairs.map((p) => p.trip?.id)).toEqual([
    his.portugal.id,
    his.norway.id,
    his.rome.id,
  ]);
  expect(listed.pairs.every((p) => !p.ambiguous && p.from?.origin === a.origin)).toBe(true);

  const verdicts: Record<string, boolean> = {};
  for (const p of listed.pairs) {
    const preview = await b.offerLink.previewOfferLink(father, p.id, p.trip!.id);
    if (preview.access !== "full") throw new Error("expected the dry run");
    verdicts[p.trip!.id] = preview.automatic;
  }
  expect(verdicts).toEqual({
    [his.portugal.id]: true,
    [his.norway.id]: true,
    [his.rome.id]: false,
  });

  for (const p of listed.pairs.filter((x) => verdicts[x.trip!.id]))
    await b.offerLink.linkOffer(father, p.id, p.trip!.id, "best");
  await a.outbox.runDeliveries();
  await b.outbox.runDeliveries();

  // The owner's drawn line reached the father; nothing was created on either side.
  const fatherFerry = await b.prisma.ferryJourney.findUniqueOrThrow({ where: { id: hisFerry.id } });
  expect(fatherFerry.geometrySource).toBe("manual");
  expect(await count(b, father)).toEqual(before);
  const ownerFerry = await a.prisma.ferryJourney.findFirstOrThrow({ where: { userId: owner } });
  expect(ownerFerry.geometrySource).toBe("manual");

  // A repeat run finds only the pair still waiting: nothing is linked twice.
  const rerun = await b.bulkLink.remoteBulkPairs(father);
  if (rerun.access !== "full") throw new Error("expected the pairs");
  expect(rerun.pairs.map((p) => p.trip?.id)).toEqual([his.rome.id]);

  // Undo one pair: the father's trip leaves its group, his entries stay his.
  await b.shareTrip.leaveGroup(father, his.portugal.id);
  const portugal = await b.prisma.trip.findUniqueOrThrow({ where: { id: his.portugal.id } });
  expect(portugal.shareGroupId).toBeNull();
  expect(await count(b, father)).toEqual(before);
});

it("before the consent is accepted, the inbox lists no pair", async () => {
  const { owner, father, remote } = await setup();
  for (const c of await a.bulkLink.remoteBulkOfferCandidates(owner, remote.id))
    await a.offers.offerTrip(owner, c.id, remote.id);
  const remoteIds = (
    await b.prisma.remoteShareAccount.findMany({ where: { userId: father }, select: { id: true } })
  ).map((r) => r.id);
  await b.prisma.shareConsent.updateMany({
    where: {
      OR: [{ remoteRequesterId: { in: remoteIds } }, { remoteTargetId: { in: remoteIds } }],
    },
    data: { status: "pending" },
  });
  const listed = await b.bulkLink.remoteBulkPairs(father);
  expect(listed).toEqual({ access: "full", pairs: [] });
});

it("a bulk offer refuses a trip the bulk list would not offer (security review 2026-11-27)", async () => {
  const { owner, remote, mine } = await setup();
  await expect(a.bulkLink.bulkOffer(owner, mine.alone.id, remote.id)).rejects.toMatchObject({
    statusCode: 409,
    code: "SHARE_REMOTE_BULK_NOT_CANDIDATE",
  });
  await expect(a.bulkLink.bulkOffer(owner, mine.portugal.id, remote.id)).resolves.toMatchObject({
    state: "invited",
  });
});
