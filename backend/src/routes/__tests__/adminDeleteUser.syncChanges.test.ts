import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";

/**
 * beta.23 UAT before 2.7.0-rc.20: deleting an account left 43 rows in
 * `sync_changes` — the change log of what the account had written, plus the
 * tombstones its own cascade wrote. Nothing can read them any more (no device
 * of a deleted account authenticates), and the daily retention job only
 * removes them hours later. A deleted account's change log must not outlive it.
 */

const ADMIN = "adminDeleteSyncAdmin";
const VICTIM = "adminDeleteSyncVictim";
const BYSTANDER = "adminDeleteSyncBystander";

const cookiesOf = (res: request.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[]) ?? [];

async function makeUser(username: string, isAdmin = false): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword("password123"), isAdmin },
  });
  return user.id;
}

describe("DELETE /admin/users/:id and the sync change log", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [ADMIN, VICTIM, BYSTANDER] } } });
    await prisma.$disconnect();
  });

  it("removes the deleted account's change rows and keeps everyone else's", async () => {
    await makeUser(ADMIN, true);
    const victim = await makeUser(VICTIM);
    const bystander = await makeUser(BYSTANDER);
    await prisma.trip.create({ data: { userId: victim, name: "Victim's trip" } });
    await prisma.trip.create({ data: { userId: bystander, name: "Bystander's trip" } });
    // Precondition: the writes above are in the log, or the test proves nothing.
    expect(await prisma.syncChange.count({ where: { userId: victim } })).toBeGreaterThan(0);
    const bystanderRows = await prisma.syncChange.count({ where: { userId: bystander } });
    expect(bystanderRows).toBeGreaterThan(0);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: ADMIN, password: "password123" });
    const res = await request(app)
      .delete(`/api/v1/admin/users/${victim}`)
      .set("Cookie", cookiesOf(login));
    expect(res.status).toBe(200);

    expect(await prisma.syncChange.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.syncChange.count({ where: { userId: bystander } })).toBe(bystanderRows);
  });
});
