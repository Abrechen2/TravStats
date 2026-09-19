import { prisma } from "../db";
import { runDemoSeed } from "../seedDemoAccount";

/**
 * The whole standard demo seed, run twice. Every domain must have rows, and a
 * second run (the nightly reset) must land on exactly the same counts.
 * Removes the "demo" user afterwards — it is disposable by definition.
 */
describe("the standard demo seed", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "demo" } });
  });

  it("fills every domain and is idempotent", async () => {
    const first = await runDemoSeed();
    for (const [domain, count] of Object.entries(first.counts)) {
      // Two-argument expect(value, message) is not used here (see R3) —
      // a labelled throw gives the same "which domain failed" signal.
      if (!(count > 0)) throw new Error(`expected ${domain} to have rows, got ${count}`);
    }
    const second = await runDemoSeed();
    expect(second.userId).toBe(first.userId);
    expect(second.counts).toEqual(first.counts);
  }, 240_000);
});
