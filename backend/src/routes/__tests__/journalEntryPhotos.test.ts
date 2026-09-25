import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Package 9, item 5: a journal entry shows photos picked from its trip's own
 * gallery. What these pin: the pick round-trips in order through the trip
 * detail; a photo of ANOTHER trip — even the same user's — is refused before
 * anything is written; PATCH replaces the set and `[]` clears it; the gallery
 * list the picker reads leaves the cover's internal row out.
 */
describe("journal entry photos", () => {
  const stamp = Date.now();
  let cookie: string;
  let tripId: string;
  let otherTripPhotoId: string;
  const ids: string[] = [];

  const photo = (trip: string, caption: string | null = null) =>
    prisma.tripPhoto.create({
      data: {
        tripId: trip,
        filename: `jp-${stamp}-${Math.random().toString(36).slice(2)}.jpg`,
        mimetype: "image/jpeg",
        sizeBytes: 1,
        caption,
      },
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `jp-${stamp}`, passwordHash } });
    cookie = `auth_token=${generateToken(user.id)}`;
    tripId = (await prisma.trip.create({ data: { userId: user.id, name: "Lisboa" } })).id;
    const otherTrip = await prisma.trip.create({ data: { userId: user.id, name: "Porto" } });
    for (let i = 0; i < 3; i++) ids.push((await photo(tripId)).id);
    await photo(tripId, "__cover__");
    otherTripPhotoId = (await photo(otherTrip.id)).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: `jp-${stamp}` } });
  });

  const entryPhotos = async (entryId: string): Promise<string[]> => {
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    const entry = res.body.trip.journalEntries.find((e: { id: string }) => e.id === entryId);
    return entry.photos.map((p: { id: string }) => p.id);
  };

  it("keeps the picked photos in order and shows them on the trip detail", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/journal`)
      .set("Cookie", cookie)
      .send({ date: "2024-05-01", body: "Tram 28", photoIds: [ids[2], ids[0]] });
    expect(res.status).toBe(201);
    expect(await entryPhotos(res.body.entry.id)).toEqual([ids[2], ids[0]]);

    const patched = await request(app)
      .patch(`/api/v1/trips/${tripId}/journal/${res.body.entry.id}`)
      .set("Cookie", cookie)
      .send({ photoIds: [ids[1]] });
    expect(patched.status).toBe(200);
    expect(await entryPhotos(res.body.entry.id)).toEqual([ids[1]]);

    // A PATCH that does not name photos leaves them alone; `[]` clears them.
    await request(app)
      .patch(`/api/v1/trips/${tripId}/journal/${res.body.entry.id}`)
      .set("Cookie", cookie)
      .send({ title: "Alfama" });
    expect(await entryPhotos(res.body.entry.id)).toEqual([ids[1]]);
    await request(app)
      .patch(`/api/v1/trips/${tripId}/journal/${res.body.entry.id}`)
      .set("Cookie", cookie)
      .send({ photoIds: [] });
    expect(await entryPhotos(res.body.entry.id)).toEqual([]);
  });

  it("refuses a photo of another trip and writes no entry", async () => {
    const before = await prisma.tripJournalEntry.count({ where: { tripId } });
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/journal`)
      .set("Cookie", cookie)
      .send({ date: "2024-05-02", body: "Porto day", photoIds: [ids[0], otherTripPhotoId] });
    expect(res.status).toBe(400);
    expect(await prisma.tripJournalEntry.count({ where: { tripId } })).toBe(before);
  });

  it("lists the gallery for the picker, without the cover's row", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}/photos`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.photos.map((p: { id: string }) => p.id)).toEqual(ids);
  });
});
