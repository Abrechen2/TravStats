import { promises as fs } from "fs";
import path from "path";

import { prisma } from "../../../db";
import { UPLOADS_ROOT } from "../../../config/uploadDirs";
import * as accountFiles from "../../files/accountFiles";
import * as sessionTimeouts from "../../db/sessionTimeouts";
import { STALLED_DELETION_MS, recoverStalledDeletions, removeAccount } from "../removeAccount";

/**
 * forgejo#415: a deletion is reserved (role and sign-in off, marker with the
 * prior values) before federated peers are told. A crash between that and the
 * delete must not leave the account silently demoted and locked: the recovery
 * sweep finishes it, or restores it when finishing would leave no admin.
 */
const NAMES = ["markerPlain", "markerAdmin", "markerOtherAdmin"];
const NOW = new Date("2026-11-21T12:00:00Z");
const stale = new Date(NOW.getTime() - STALLED_DELETION_MS - 60_000);

async function makeUser(username: string, admin = false): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  return (await prisma.user.create({ data: { username, passwordHash: "x", isAdmin: admin } })).id;
}

/** The state a crash right after the reservation leaves behind. */
const reserve = (id: string, at: Date, priorAdmin: boolean) =>
  prisma.user.update({
    where: { id },
    data: {
      isAdmin: false,
      isActive: false,
      deletionStartedAt: at,
      deletionPriorAdmin: priorAdmin,
      deletionPriorActive: true,
    },
  });

describe("an interrupted account deletion is settled, never left half-done (forgejo#415)", () => {
  beforeEach(async () => {
    await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
    await prisma.$disconnect();
  });

  it("finishes a stalled deletion: the account and its files are gone", async () => {
    const id = await makeUser(NAMES[0]);
    const dir = path.join(UPLOADS_ROOT, "profile-pictures");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}_avatar.jpg`);
    await fs.writeFile(file, "x");
    await reserve(id, stale, false);

    const run = await recoverStalledDeletions(NOW);

    expect(run).toEqual({ completed: 1, restored: 0 });
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("raises the 30 s statement timeout for the one-statement delete cascade (perf audit item 13)", async () => {
    const raise = jest.spyOn(sessionTimeouts, "raiseStatementTimeout");
    const id = await makeUser(NAMES[0]);
    await reserve(id, stale, false);

    await recoverStalledDeletions(NOW);

    expect(raise).toHaveBeenCalledWith(expect.anything(), "accountDeletion");
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });

  it("restores a stalled admin when finishing would leave the instance without one", async () => {
    const id = await makeUser(NAMES[1], true);
    await reserve(id, stale, true);

    const run = await recoverStalledDeletions(NOW);

    expect(run).toEqual({ completed: 0, restored: 1 });
    expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({
      isAdmin: true,
      isActive: true,
      deletionStartedAt: null,
      deletionPriorAdmin: null,
    });
  });

  it("finishes a stalled admin when another admin remains", async () => {
    await makeUser(NAMES[2], true);
    const id = await makeUser(NAMES[1], true);
    await reserve(id, stale, true);
    expect(await recoverStalledDeletions(NOW)).toEqual({ completed: 1, restored: 0 });
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });

  it("restores the account when finishing fails, rather than leaving it locked", async () => {
    const id = await makeUser(NAMES[0]);
    await reserve(id, stale, false);
    jest.spyOn(accountFiles, "deleteAccountWithFiles").mockRejectedValueOnce(new Error("db down"));
    expect(await recoverStalledDeletions(NOW)).toEqual({ completed: 0, restored: 1 });
    expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({
      isActive: true,
      deletionStartedAt: null,
    });
  });

  it("two sweeps at once settle a stalled deletion once", async () => {
    const id = await makeUser(NAMES[0]);
    await reserve(id, stale, false);
    const [a, b] = await Promise.all([recoverStalledDeletions(NOW), recoverStalledDeletions(NOW)]);
    expect(a.completed + b.completed).toBe(1);
    expect(a.restored + b.restored).toBe(0);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });

  it("leaves a deletion still in its first minutes alone", async () => {
    const id = await makeUser(NAMES[0]);
    await reserve(id, new Date(NOW.getTime() - 60_000), false);
    expect(await recoverStalledDeletions(NOW)).toEqual({ completed: 0, restored: 0 });
    expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({ isActive: false });
  });

  it("a live deletion that fails gives the role and sign-in back and clears the marker", async () => {
    await makeUser(NAMES[2], true);
    const id = await makeUser(NAMES[1], true);
    jest.spyOn(accountFiles, "deleteAccountWithFiles").mockRejectedValueOnce(new Error("db down"));
    await expect(removeAccount(id, { actorId: id })).rejects.toThrow("db down");
    expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({
      isAdmin: true,
      isActive: true,
      deletionStartedAt: null,
    });
  });

  it("refuses a second deletion of an account already being deleted, and changes nothing", async () => {
    const id = await makeUser(NAMES[0]);
    await reserve(id, new Date(), false);
    await expect(removeAccount(id, { actorId: id })).rejects.toMatchObject({
      statusCode: 409,
      code: "DELETE_IN_PROGRESS",
    });
    expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({
      deletionPriorActive: true,
    });
  });
});
