import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { fillEmptyCover } from "../../services/trip/tripCover";

/**
 * Trip cover crop (owner, 2026-11-22). The crop is stored non-destructively on
 * the trip and a cover records who chose it. Pinned: a crop persists and
 * round-trips; a new cover starts uncropped; echoing the same URL keeps the
 * crop; a crop with no cover is refused; and an AUTOMATIC cover never replaces
 * one a person set (it fills an empty cover only).
 */
describe("trip cover crop and source", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  const read = async () =>
    (await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie)).body.trip;
  const patch = (body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/trips/${tripId}`).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `cover-crop-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  beforeEach(async () => {
    tripId = (await prisma.trip.create({ data: { userId, name: "Cover" } })).id;
  });
  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("stores a crop with the cover, marks it manual and returns it", async () => {
    const res = await patch({
      coverImageUrl: "/api/v1/trips/x/photos/y/file",
      coverCrop: { x: 0.3, y: 0.7, zoom: 2 },
    });
    expect(res.status).toBe(200);
    const trip = await read();
    expect(trip.coverCrop).toEqual({ x: 0.3, y: 0.7, zoom: 2 });
    expect(trip.coverSource).toBe("manual");
  });

  it("a new cover URL starts uncropped, the same URL echoed keeps the crop", async () => {
    await patch({ coverImageUrl: "/a", coverCrop: { x: 0.2, y: 0.2, zoom: 3 } });
    await patch({ coverImageUrl: "/a" });
    expect((await read()).coverCrop).toEqual({ x: 0.2, y: 0.2, zoom: 3 });
    await patch({ coverImageUrl: "/b" });
    expect((await read()).coverCrop).toBeNull();
  });

  it("re-frames an existing cover with a crop alone and clears it with null", async () => {
    await patch({ coverImageUrl: "/a" });
    await patch({ coverCrop: { x: 0.9, y: 0.1, zoom: 1.5 } });
    expect((await read()).coverCrop).toEqual({ x: 0.9, y: 0.1, zoom: 1.5 });
    await patch({ coverCrop: null });
    expect((await read()).coverCrop).toBeNull();
  });

  it("refuses a crop without a cover and an out-of-range crop", async () => {
    expect((await patch({ coverCrop: { x: 0.5, y: 0.5, zoom: 2 } })).status).toBe(400);
    await patch({ coverImageUrl: "/a" });
    expect((await patch({ coverCrop: { x: 1.5, y: 0.5, zoom: 2 } })).status).toBe(400);
    expect((await patch({ coverCrop: { x: 0.5, y: 0.5, zoom: 0.5 } })).status).toBe(400);
  });

  it("refuses a crop made on a cover that has been replaced meanwhile (409)", async () => {
    await patch({ coverImageUrl: "/a" });
    await patch({ coverImageUrl: "/b" });
    const res = await patch({ coverCrop: { x: 0.5, y: 0.5, zoom: 2 }, coverCropFor: "/a" });
    expect(res.status).toBe(409);
    expect((await read()).coverCrop).toBeNull();
    expect(
      (await patch({ coverCrop: { x: 0.5, y: 0.5, zoom: 2 }, coverCropFor: "/b" })).status
    ).toBe(200);
  });

  it("refuses to create a trip with a crop but no cover", async () => {
    const res = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "x", coverCrop: { x: 0.5, y: 0.5, zoom: 2 } });
    expect(res.status).toBe(400);
  });

  it("removing the cover clears crop and source", async () => {
    await patch({ coverImageUrl: "/a", coverCrop: { x: 0.5, y: 0.5, zoom: 2 } });
    await patch({ coverImageUrl: null });
    const trip = await read();
    expect(trip.coverCrop).toBeNull();
    expect(trip.coverSource).toBeNull();
  });

  it("an automatic cover fills an EMPTY cover and is marked auto", async () => {
    expect(await fillEmptyCover(tripId, "/auto")).toBe(true);
    const trip = await read();
    expect(trip.coverImageUrl).toBe("/auto");
    expect(trip.coverSource).toBe("auto");
  });

  it("an automatic cover never overwrites a manual one, and a manual set replaces an auto one", async () => {
    await patch({ coverImageUrl: "/mine", coverCrop: { x: 0.4, y: 0.4, zoom: 2 } });
    expect(await fillEmptyCover(tripId, "/auto")).toBe(false);
    let trip = await read();
    expect(trip.coverImageUrl).toBe("/mine");
    expect(trip.coverCrop).toEqual({ x: 0.4, y: 0.4, zoom: 2 });

    await prisma.trip.update({
      where: { id: tripId },
      data: { coverImageUrl: null, coverCrop: undefined, coverSource: null },
    });
    await fillEmptyCover(tripId, "/auto");
    await patch({ coverImageUrl: "/mine-again" });
    trip = await read();
    expect(trip.coverImageUrl).toBe("/mine-again");
    expect(trip.coverSource).toBe("manual");
  });

  it("an automatic cover does not overwrite a legacy cover (no source recorded)", async () => {
    await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl: "/legacy" } });
    expect(await fillEmptyCover(tripId, "/auto")).toBe(false);
    expect((await read()).coverImageUrl).toBe("/legacy");
  });
});
