import { TRAVEL_GRAPH, NON_TRAVEL_RELATIONS } from "../e2e/graph";
import { createCircle, grantCircle, ownerGrant, removeMember, addMember } from "../circles";
import { groupDevices, groupRead } from "../e2e/relay";
import { randomUUID, webcrypto } from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "../../../db";
import { invite, claim, listLinks, changeLink, saveGrant, revokeGrant } from "../links";
import {
  sourceDevices,
  registerDevice,
  beginPublication,
  putChunk,
  finishPublication,
  readSealed,
  revokeDevice,
} from "../e2e/store";
import { collectComparison, FIELD_INVENTORY, words } from "../e2e/source";
import { prepareScope } from "../permissions";
import { scopeSchema } from "../contract";
import {
  generateDevice,
  createPublication,
  openPublication,
} from "../../../../../frontend/src/lib/encryptedShare/crypto";
const users: string[] = [];
const scope = scopeSchema.parse({
  statistics: true,
  details: true,
  personal: true,
  costs: true,
  photos: true,
  documents: true,
  domains: ["flight", "cruise", "lodging", "poi", "roadtrip", "rail", "rental", "bus", "ferry"],
  tripIds: [],
  futureTrips: true,
  year: null,
  precision: "exact",
  expiresAt: null,
});
beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
});
afterAll(async () => {
  await prisma.comparisonAudit.deleteMany({ where: { ownerId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function user() {
  const u = await prisma.user.create({
    data: { username: `e2e-${randomUUID()}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
async function pair(a: string, b: string) {
  const inv = await invite(a);
  await claim(b, { origin: "local", code: inv.code, label: "a" });
  const aa = (await listLinks(a)).at(-1)!,
    bb = (await listLinks(b)).at(-1)!;
  await changeLink(a, aa.id, "confirm", "b", aa.code);
  await changeLink(b, bb.id, "confirm", "a", bb.code);
  return { a: await prisma.comparisonLink.findUniqueOrThrow({ where: { id: aa.id } }), b: bb };
}
it("classifies every scalar on every traversed travel model (new fields fail closed)", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../../../../prisma/schema.prisma"), "utf8");
  const blocks = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)],
    models = new Set(blocks.map((m) => m[1]));
  const userBlock = blocks.find((m) => m[1] === "User")!;
  const userRelations = [...userBlock[2].matchAll(/^\s*(\w+)\s+(\w+)[?\[\]]*/gm)]
    .filter((m) => models.has(m[2]))
    .map((m) => m[1]);
  expect([...Object.keys(TRAVEL_GRAPH), ...NON_TRAVEL_RELATIONS].sort()).toEqual(
    userRelations.sort()
  );
  for (const [name, inventory] of Object.entries(FIELD_INVENTORY)) {
    const block = blocks.find((m) => m[1] === name)!;
    const scalar = [...block[2].matchAll(/^\s*(\w+)\s+(\w+)[?\[\]]*/gm)]
      .filter((m) => !models.has(m[2]))
      .map((m) => m[1]);
    expect(Object.values(inventory).flatMap(words).sort()).toEqual(scalar.sort());
    expect(new Set(Object.values(inventory).flatMap(words)).size).toBe(scalar.length);
  }
});
it("never classifies a cost or personal-looking field as a plain detail", () => {
  // Flight taxes/fees, a ferry's number plate and a stay's guest list once sat in `details`,
  // so a statistics-and-details grant published them with no cost or personal consent.
  const costOrPersonal = /price|tax|fee|amount|cost|registration|plate|guest/i;
  // An aircraft tail number is a public fact about the aeroplane, not about the traveller.
  const publicFacts = new Set(["Flight.aircraftRegistration"]);
  const leaks = Object.entries(FIELD_INVENTORY).flatMap(([model, inventory]) =>
    words(inventory.details)
      .filter((field) => costOrPersonal.test(field) && !publicFacts.has(`${model}.${field}`))
      .map((field) => `${model}.${field}`)
  );
  expect(leaks).toEqual([]);
  expect(words(FIELD_INVENTORY.Flight.personal)).toContain("boardingGroup");
});
it("collects the complete graph and keeps ownership, personal categories and credentials separate", async () => {
  const a = await user(),
    b = await user();
  await prisma.userSettings.create({
    data: { userId: a, enabledDomains: scope.domains, data: {} },
  });
  await prisma.note.create({
    data: {
      userId: a,
      body: "shareable note deliberately shared",
      occurredAt: new Date("2026-01-01Z"),
      occurredZone: "UTC",
      visibility: "shareable",
    },
  });
  // forgejo#146: a private note never leaves its owner, even under a personal grant.
  await prisma.note.create({
    data: { userId: a, body: "OWNER-ONLY NOTE", occurredAt: new Date(), occurredZone: "UTC" },
  });
  await prisma.note.create({
    data: { userId: b, body: "STRANGER", occurredAt: new Date(), occurredZone: "UTC" },
  });
  const all = await collectComparison(a, await prepareScope(a, scope));
  expect(JSON.stringify(all.sections)).toContain("shareable note deliberately shared");
  expect(JSON.stringify(all)).not.toMatch(/STRANGER|OWNER-ONLY NOTE|passwordHash|test-only/);
  expect(all.sections).toHaveProperty("ferryJourneys");
  expect(all.sections).toHaveProperty("tourRoutes");
  const restricted = await collectComparison(
    a,
    await prepareScope(a, {
      ...scope,
      personal: false,
      photos: false,
      documents: false,
      costs: false,
    })
  );
  expect(restricted.sections.notes).toBeUndefined();
  expect(JSON.stringify(restricted)).not.toContain("shareable note deliberately shared");
});
// Security review of TravTrack T5: a recorded flight line leaves only through
// the owner's privacy cut, here too.
it("hands a flight recording over without any vertex inside the owner's privacy zones", async () => {
  const a = await user();
  await prisma.userSettings.create({
    data: { userId: a, enabledDomains: scope.domains, data: {} },
  });
  const flight = await prisma.flight.create({
    data: {
      userId: a,
      depIata: "FRA",
      arrIata: "BER",
      depLat: 50.03,
      depLon: 8.56,
      arrLat: 52.36,
      arrLon: 13.5,
      flightNumber: "LH1",
      departureTime: new Date("2026-03-01T08:00:00Z"),
      arrivalTime: new Date("2026-03-01T09:00:00Z"),
      status: "flown",
    },
  });
  await prisma.flightTrack.create({
    data: {
      flightId: flight.id,
      source: "companion",
      uploadId: "e2e-zone",
      startedAt: new Date("2026-03-01T08:00:00Z"),
      endedAt: new Date("2026-03-01T09:00:00Z"),
      geometry: [
        [8.56, 50.03],
        [10.0, 51.0],
        [13.4111, 52.5222],
      ],
      segmentStarts: [0],
      cumulativeKm: [0, 150, 430],
      pointCount: 3,
      distanceKm: 430,
    },
  });
  await prisma.travTrackPrivacyZone.create({
    data: { userId: a, name: "Zuhause", lat: 52.5222, lon: 13.4111, radiusM: 500 },
  });
  const all = await collectComparison(a, await prepareScope(a, scope));
  const text = JSON.stringify(all.sections);
  expect(text).toContain("8.56");
  expect(text).not.toContain("52.5222");
  const flights = all.sections.flights as Array<{
    track?: { geometry: unknown; cumulativeKm: unknown };
  }>;
  const track = flights.find((f) => f.track)?.track;
  expect(track).toMatchObject({
    geometry: [
      [8.56, 50.03],
      [10, 51],
    ],
    cumulativeKm: [0, 150],
    // What is left, measured; the hidden arrival end has no time.
    distanceKm: 150,
    pointCount: 2,
    endedAt: null,
    startedAt: "2026-03-01T08:00:00.000Z",
  });
});

it("stores ciphertext only, commits atomically, authenticates the device and stops reads after revocation", async () => {
  const a = await user(),
    b = await user(),
    links = await pair(a, b);
  const sender = await generateDevice("sender"),
    receiver = await generateDevice("receiver");
  await registerDevice(a, sender.device.public);
  await registerDevice(b, receiver.device.public);
  await expect(registerDevice(b, sender.device.public)).rejects.toThrow();
  const grant = await saveGrant(a, links.a.id, "", scope);
  const c = {
    version: 2 as const,
    id: randomUUID(),
    channel: links.a.channel,
    audience: "",
    revision: grant.revision,
    sender: sender.device.public.fingerprint,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  const sealed = await createPublication(sender.device, c, [receiver.device.public]);
  await beginPublication(a, links.a.id, c);
  const part = await sealed.chunk(new TextEncoder().encode("SECRET TRAVEL VALUE"));
  await putChunk(a, c.id, part);
  expect(await readSealed(links.a, "", receiver.device.public.fingerprint)).toBeNull();
  const manifest = await sealed.finish();
  await expect(
    finishPublication(a, c.id, { ...manifest, ephemeral: receiver.device.public.encryption })
  ).rejects.toThrow();
  await finishPublication(a, c.id, manifest);
  const head = (await readSealed(links.a, "", receiver.device.public.fingerprint)) as {
    manifest: typeof manifest;
  };
  const decrypt = await openPublication(receiver.device, sender.device.public, head.manifest, {
    audience: "",
    channel: links.a.channel,
  });
  const stored = await prisma.comparisonChunk.findMany({ where: { publicationId: c.id } });
  expect(JSON.stringify(stored)).not.toContain("SECRET TRAVEL VALUE");
  expect(new TextDecoder().decode(await decrypt(0, stored[0].bytes))).toBe("SECRET TRAVEL VALUE");
  await expect(putChunk(a, c.id, part)).rejects.toThrow();
  await revokeGrant(a, links.a.id, "");
  await expect(readSealed(links.a, "", receiver.device.public.fingerprint)).rejects.toThrow();
  await revokeDevice(a, sender.device.public.id);
  expect(await sourceDevices(links.a)).toEqual([]);
  await expect(registerDevice(a, sender.device.public)).rejects.toThrow();
});

it("relays group ciphertext for three members and invalidates it when membership changes", async () => {
  const [host, a, b, newcomer] = await Promise.all([user(), user(), user(), user()]);
  const ha = await pair(host, a),
    hb = await pair(host, b),
    hn = await pair(host, newcomer);
  const [hDevice, aDevice, bDevice] = await Promise.all(["h", "a", "b"].map(generateDevice));
  await registerDevice(host, hDevice.device.public);
  await registerDevice(a, aDevice.device.public);
  await registerDevice(b, bDevice.device.public);
  const circle = await createCircle(host, "group", [ha.a.id, hb.a.id]),
    audience = `${circle.id}:${circle.version}`;
  const roster = await groupDevices(host, circle.id);
  expect(roster.members.flatMap((m) => m.devices)).toHaveLength(3);
  await grantCircle(a, ha.b.id, circle.id, circle.version, scope);
  await grantCircle(b, hb.b.id, circle.id, circle.version, scope);
  await ownerGrant(host, circle.id, circle.version, scope);
  const grant = await prisma.comparisonGrant.findUniqueOrThrow({
    where: { linkId_audience: { linkId: ha.b.id, audience } },
  });
  const c = {
    version: 2 as const,
    id: randomUUID(),
    channel: ha.b.channel,
    audience,
    revision: grant.revision,
    sender: aDevice.device.public.fingerprint,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  const sealed = await createPublication(
    aDevice.device,
    c,
    roster.members.flatMap((m) => m.devices)
  );
  await beginPublication(a, ha.b.id, c);
  const part = await sealed.chunk(new TextEncoder().encode("member A group value"));
  await putChunk(a, c.id, part);
  const manifest = await sealed.finish();
  await finishPublication(a, c.id, manifest);
  const request = {
    action: "sealed" as const,
    operation: "group-read" as const,
    channel: hb.a.channel,
    circleId: circle.id,
    audience,
    source: ha.a.channel,
    recipient: bDevice.device.public.fingerprint,
  };
  const head = (await groupRead(host, circle.id, request, hb.a)) as { manifest: typeof manifest };
  expect(head.manifest.signature).toBe(manifest.signature);
  const body = (await groupRead(
    host,
    circle.id,
    { ...request, publication: c.id, part: 0 },
    hb.a
  )) as { bytes: string };
  const decrypt = await openPublication(bDevice.device, aDevice.device.public, manifest, {
    audience,
  });
  expect(new TextDecoder().decode(await decrypt(0, body.bytes))).toBe("member A group value");
  await expect(groupRead(host, circle.id, request, hn.a)).rejects.toThrow();
  await addMember(host, circle.id, hn.a.id);
  await expect(groupRead(host, circle.id, request, hb.a)).rejects.toThrow();
  const memberLink = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ha.b.id } });
  await expect(
    readSealed(memberLink, audience, bDevice.device.public.fingerprint)
  ).rejects.toThrow();
  await removeMember(host, circle.id, hb.a.channel);
  await expect(groupRead(host, circle.id, request, hb.a)).rejects.toThrow();
});

it("hands a friend only the ciphertext addressed to the friend's own devices", async () => {
  // readSealed checked only that the fingerprint was in the manifest, so the friend could ask for
  // the copy wrapped for the OWNER's device and walk away with every recipient's envelope.
  const a = await user(),
    b = await user(),
    links = await pair(a, b);
  const sender = await generateDevice("sender"),
    receiver = await generateDevice("receiver");
  await registerDevice(a, sender.device.public);
  await registerDevice(b, receiver.device.public);
  const grant = await saveGrant(a, links.a.id, "", scope);
  const c = {
    version: 2 as const,
    id: randomUUID(),
    channel: links.a.channel,
    audience: "",
    revision: grant.revision,
    sender: sender.device.public.fingerprint,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  const sealed = await createPublication(sender.device, c, [
    receiver.device.public,
    sender.device.public,
  ]);
  await beginPublication(a, links.a.id, c);
  await putChunk(a, c.id, await sealed.chunk(new TextEncoder().encode("value")));
  await finishPublication(a, c.id, await sealed.finish());
  expect(await readSealed(links.a, "", receiver.device.public.fingerprint)).not.toBeNull();
  await expect(readSealed(links.a, "", sender.device.public.fingerprint)).rejects.toThrow();
});
it("deletes a grant's ciphertext when the grant or the friendship is revoked", async () => {
  // Revocation only flipped `active`; the encrypted copies stayed on the server until expiry.
  const a = await user(),
    b = await user(),
    links = await pair(a, b);
  const sender = await generateDevice("sender"),
    receiver = await generateDevice("receiver");
  await registerDevice(a, sender.device.public);
  await registerDevice(b, receiver.device.public);
  const publish = async () => {
    const grant = await saveGrant(a, links.a.id, "", scope);
    const c = {
      version: 2 as const,
      id: randomUUID(),
      channel: links.a.channel,
      audience: "",
      revision: grant.revision,
      sender: sender.device.public.fingerprint,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
    const sealed = await createPublication(sender.device, c, [receiver.device.public]);
    await beginPublication(a, links.a.id, c);
    await putChunk(a, c.id, await sealed.chunk(new TextEncoder().encode("value")));
    await finishPublication(a, c.id, await sealed.finish());
  };
  const stored = () => prisma.comparisonPublication.count({ where: { linkId: links.a.id } });
  await publish();
  expect(await stored()).toBe(1);
  await revokeGrant(a, links.a.id, "");
  expect(await stored()).toBe(0);
  await publish();
  expect(await stored()).toBe(1);
  await changeLink(b, links.b.id, "revoke");
  expect(await stored()).toBe(0);
});
