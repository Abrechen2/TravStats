import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { createFlight, registerUser, wipe } from "./syncFixtures";

/**
 * If-Match / baseVersion on the Companion's edits and deletes (forgejo#141):
 * a stale edit is refused with the record as it is now, a current one goes
 * through, and a request without a version behaves exactly as before.
 */

const quoted = (version: Date) => `"${version.toISOString()}"`;

describe("version preconditions on edits and deletes", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("refuses an edit made on a version that has moved on, naming what moved", async () => {
    const user = await registerUser("sync-pre-1");
    const flight = await createFlight(user.id, { notes: "start" });
    const read = flight.updatedAt;
    await prisma.flight.update({ where: { id: flight.id }, data: { notes: "web edit" } });

    const response = await request(app)
      .put(`/api/v1/flights/${flight.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(read))
      .send({ notes: "phone edit" })
      .expect(409);

    expect(response.body).toMatchObject({
      code: "VERSION_CONFLICT",
      entity: "flight",
      id: flight.id,
      baseVersion: read.toISOString(),
      changedFields: ["notes"],
    });
    expect(response.body.current.notes).toBe("web edit");
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(stored.notes).toBe("web edit");
    expect(response.body.currentVersion).toBe(stored.updatedAt.toISOString());
  });

  it("lets an edit on the current version through", async () => {
    const user = await registerUser("sync-pre-2");
    const flight = await createFlight(user.id, { notes: "start" });

    await request(app)
      .put(`/api/v1/flights/${flight.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(flight.updatedAt))
      .send({ notes: "phone edit" })
      .expect(200);

    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(stored.notes).toBe("phone edit");
    expect(stored.updatedAt.getTime()).toBeGreaterThan(flight.updatedAt.getTime());
  });

  it("keeps unconditional edits working for clients that send no version", async () => {
    const user = await registerUser("sync-pre-3");
    const flight = await createFlight(user.id, { notes: "start" });
    await prisma.flight.update({ where: { id: flight.id }, data: { notes: "web edit" } });

    await request(app)
      .put(`/api/v1/flights/${flight.id}`)
      .set("Cookie", user.cookie)
      .send({ notes: "old app" })
      .expect(200);

    expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).notes).toBe(
      "old app"
    );
  });

  it("takes the version from the body too, and keeps it out of the record", async () => {
    const user = await registerUser("sync-pre-4");
    const lodging = await prisma.lodging.create({ data: { userId: user.id, name: "Alt" } });

    await request(app)
      .patch(`/api/v1/lodging/${lodging.id}`)
      .set("Cookie", user.cookie)
      .send({ name: "Neu", baseVersion: lodging.updatedAt.toISOString() })
      .expect(200);
    const stale = await request(app)
      .patch(`/api/v1/lodging/${lodging.id}`)
      .set("Cookie", user.cookie)
      .send({ name: "Zu spaet", baseVersion: lodging.updatedAt.toISOString() })
      .expect(409);

    expect(stale.body.changedFields).toEqual(["name"]);
    expect((await prisma.lodging.findUniqueOrThrow({ where: { id: lodging.id } })).name).toBe(
      "Neu"
    );
  });

  it("lets exactly one of two racing edits on the same version through", async () => {
    const user = await registerUser("sync-pre-5");
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "Start" } });
    const send = (name: string) =>
      request(app)
        .patch(`/api/v1/trips/${trip.id}`)
        .set("Cookie", user.cookie)
        .set("If-Match", quoted(trip.updatedAt))
        .send({ name });

    const statuses = (await Promise.all([send("Phone"), send("Web")])).map((r) => r.status);

    expect(statuses.sort()).toEqual([200, 409]);
  });

  it("refuses a delete of a record that changed since it was read", async () => {
    const user = await registerUser("sync-pre-6");
    const flight = await createFlight(user.id);
    await prisma.flight.update({ where: { id: flight.id }, data: { notes: "edited" } });

    await request(app)
      .delete(`/api/v1/flights/${flight.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(flight.updatedAt))
      .expect(409);

    expect(await prisma.flight.findUnique({ where: { id: flight.id } })).not.toBeNull();
  });

  it("leaves another account's record to the route's own 404", async () => {
    const user = await registerUser("sync-pre-7");
    const stranger = await prisma.user.create({
      data: { username: "sync-pre-7b", passwordHash: "x" },
    });
    const theirs = await createFlight(stranger.id, { notes: "theirs" });

    const response = await request(app)
      .put(`/api/v1/flights/${theirs.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(new Date("2020-01-01T00:00:00Z")))
      .send({ notes: "mine now" });

    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty("current");
  });

  it("answers 400 for a version it never issued", async () => {
    const user = await registerUser("sync-pre-8");
    const flight = await createFlight(user.id);

    await request(app)
      .put(`/api/v1/flights/${flight.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", '"yesterday"')
      .send({ notes: "x" })
      .expect(400);
  });

  it("says it cannot name the changed fields when the base predates the change log", async () => {
    const user = await registerUser("sync-pre-9");
    const flight = await createFlight(user.id);
    // A version read before the change log existed (an app that cached the
    // record before this server was upgraded).
    const ancient = { updatedAt: new Date("2020-01-01T00:00:00Z") };

    const response = await request(app)
      .put(`/api/v1/flights/${flight.id}`)
      .set("Cookie", user.cookie)
      .set("If-Match", quoted(ancient.updatedAt))
      .send({ notes: "x" })
      .expect(409);

    expect(response.body.changedFields).toBeNull();
  });
});
