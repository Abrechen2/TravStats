import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * The bootstrap admin is handed out once, and the user limit is a limit.
 *
 * Both decisions rest on one number — how many users exist — and that number
 * used to be read BEFORE the serializable transaction opened. Serializable
 * protects the reads it can see, and this one was invisible to it: four
 * registrations racing against an empty instance each read zero, each concluded
 * "I am the first user, so I am the admin", and the instance ended up with two
 * administrators and a configured limit of one (audit finding AUD-004).
 *
 * This test is the race. It is deliberately not a unit test of the branch: the
 * branch was always right, and reading it would have told you nothing.
 */
const USERNAMES = ["raceA", "raceB", "raceC", "raceD"];

describe("registration under concurrency", () => {
  let previousMaxUsers: number | null = null;
  let previousAllowRegistration: boolean | null = null;
  let settingsId: string | null = null;

  beforeAll(async () => {
    const settings = await prisma.adminSettings.findFirst();
    if (settings) {
      settingsId = settings.id;
      previousMaxUsers = settings.maxUsers;
      previousAllowRegistration = settings.allowRegistration;
    }
  });

  beforeEach(async () => {
    // An empty instance is the whole point: the first registration must be the
    // one and only bootstrap.
    await prisma.user.deleteMany({});
    if (settingsId) {
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { maxUsers: 1, allowRegistration: false },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
    if (settingsId) {
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: {
          maxUsers: previousMaxUsers ?? 10,
          allowRegistration: previousAllowRegistration ?? false,
        },
      });
    }
  });

  it("hands the instance exactly one bootstrap admin", async () => {
    const responses = await Promise.all(
      USERNAMES.map((username) =>
        request(app).post("/api/v1/auth/register").send({ username, password: "password123" })
      )
    );

    const created = responses.filter((res) => res.status === 201);
    expect(created).toHaveLength(1);
    expect(created[0]?.body.user.isAdmin).toBe(true);

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users.filter((u) => u.isAdmin)).toHaveLength(1);

    // The losers must be told what actually happened. A serialization conflict
    // surfacing as 500 would be this test passing on the count while the person
    // in front of the screen is told the server broke.
    const losers = responses.filter((res) => res.status !== 201);
    expect(losers).toHaveLength(3);
    for (const res of losers) {
      expect(res.status).toBeLessThan(500);
    }
  });

  it("holds the user limit when the instance is already full", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ username: USERNAMES[0], password: "password123" });

    if (settingsId) {
      await prisma.adminSettings.update({
        where: { id: settingsId },
        data: { maxUsers: 2, allowRegistration: true },
      });
    }

    const responses = await Promise.all(
      USERNAMES.slice(1).map((username) =>
        request(app).post("/api/v1/auth/register").send({ username, password: "password123" })
      )
    );

    const users = await prisma.user.findMany();
    expect(users.length).toBeLessThanOrEqual(2);
    expect(users.filter((u) => u.isAdmin)).toHaveLength(1);

    for (const res of responses.filter((r) => r.status !== 201)) {
      expect(res.status).toBeLessThan(500);
    }
  });
});
