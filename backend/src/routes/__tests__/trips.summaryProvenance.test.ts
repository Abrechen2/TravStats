import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { summariseTrip } from "../../services/tripSummaryService";

/**
 * forgejo#132 item 8: a trip's summary says who wrote it. The design shows
 * "maschinell · aus n Einträgen · Datum" for a model's text; one text column
 * that the summarize route and a person both write could not say which.
 * Pinned: the model's write records source, time and entry count; a person's
 * edit turns it into "user"; saving the trip form with the text unchanged does
 * NOT; and a summary from before the columns stays unknown, never "user".
 */
describe("trip summary provenance", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  const read = async () =>
    (await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie)).body.trip;
  const patch = (body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/trips/${tripId}`).set("Cookie", cookie).send(body);
  const summarise = () =>
    summariseTrip(tripId, userId, {
      language: "de",
      target: { url: "http://fake:11434", model: "fake-model" },
      generate: async () => "Zwei Nächte in Köln, ein Nachmittag am Dom.",
    });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `sum-prov-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    const trip = await prisma.trip.create({ data: { userId, name: "Köln im Mai" } });
    tripId = trip.id;
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Chelsea", city: "Köln", country: "Deutschland" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        tripId,
        checkIn: new Date("2026-05-10T00:00:00Z"),
        checkOut: new Date("2026-05-12T00:00:00Z"),
      },
    });
    const place = await prisma.place.create({
      data: { userId, name: "Kölner Dom", category: "landmark", lat: 50.94, lon: 6.96 },
    });
    await prisma.placeVisit.create({
      data: { userId, placeId: place.id, tripId, visitedAt: new Date("2026-05-11T00:00:00Z") },
    });
    await prisma.tripJournalEntry.create({
      data: { tripId, date: new Date("2026-05-11T00:00:00Z"), body: "Regen, dann Sonne." },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: `sum-prov-${stamp}` } });
  });

  it("keeps a summary from before the columns unknown, even when the form is saved", async () => {
    await prisma.trip.update({ where: { id: tripId }, data: { summary: "Alt." } });
    const res = await patch({ name: "Köln im Mai", summary: "Alt." });
    expect(res.status).toBe(200);
    const trip = await read();
    expect(trip.summary).toBe("Alt.");
    expect(trip).toMatchObject({
      summarySource: null,
      summaryGeneratedAt: null,
      summaryEntryCount: null,
    });
  });

  it("records the model's text: source llm, when, and from how many entries", async () => {
    const before = Date.now();
    const result = await summarise();
    expect(result).toMatchObject({ summarySource: "llm", summaryEntryCount: 3 });
    const trip = await read();
    expect(trip.summarySource).toBe("llm");
    // One stay, one place visit, one journal entry.
    expect(trip.summaryEntryCount).toBe(3);
    expect(Date.parse(trip.summaryGeneratedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("does not call the model's text the user's when the form is saved with it unchanged", async () => {
    const { summary } = await read();
    const res = await patch({ name: "Köln im Mai 2026", summary });
    expect(res.status).toBe(200);
    expect(await read()).toMatchObject({ summarySource: "llm", summaryEntryCount: 3 });
  });

  it("turns into the user's text when a person edits it", async () => {
    await patch({ summary: "Mein eigener Text." });
    expect(await read()).toMatchObject({
      summary: "Mein eigener Text.",
      summarySource: "user",
      summaryGeneratedAt: null,
      summaryEntryCount: null,
    });
  });

  it("forgets the provenance with the text when the summary is cleared", async () => {
    await summarise();
    await patch({ summary: null });
    expect(await read()).toMatchObject({
      summary: null,
      summarySource: null,
      summaryGeneratedAt: null,
      summaryEntryCount: null,
    });
  });

  it("marks a summary typed when the trip is created as the user's, and none as unknown", async () => {
    const typed = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "Mit Text", summary: "Selbst geschrieben." });
    expect(typed.status).toBe(201);
    expect(typed.body.trip.summarySource).toBe("user");
    const empty = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "Ohne Text" });
    expect(empty.body.trip.summarySource).toBeNull();
  });
});
