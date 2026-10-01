import { prisma } from "../../../db";
import { afterDatabaseRestore } from "../../backup/backupRestore";
import { createFlight, drainFeed, readFeed, registerUser, wipe } from "./syncFixtures";

/**
 * A restore replaces every synced row with the archive's. A phone that kept
 * its cursor would go on applying deltas to a state the server no longer
 * has — the records the archive lacks would stay on the phone forever, with
 * no tombstone ever coming for them. The restore therefore ends the feed's
 * history, and the phone is told to read in full.
 */
describe("afterDatabaseRestore", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("sends every phone that synced before the restore to a full read", async () => {
    const user = await registerUser("sync-restore-1");
    await createFlight(user.id);
    const before = await drainFeed(user);

    await afterDatabaseRestore(null, "backup-under-test");

    const answer = await readFeed(user, before.cursor);
    expect(answer.status).toBe(410);
    expect(answer.body).toMatchObject({ code: "SYNC_RESYNC_REQUIRED", reason: "epochChanged" });
    expect(await prisma.syncChange.count()).toBe(0);
  });
});
