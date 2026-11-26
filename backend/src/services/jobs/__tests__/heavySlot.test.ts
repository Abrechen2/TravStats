import fs from "fs";
import path from "path";

import { HeavySlot } from "../heavySlot";

/**
 * Perf audit 2026-11, item 12: the nightly jobs between 02:00 and 05:35 ran
 * into each other when one was slow, and nothing stopped a job from
 * overlapping its own previous run.
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("the heavy-job slot", () => {
  it("never runs two heavy jobs at once: the second waits for the first", async () => {
    const slot = new HeavySlot();
    const first = deferred();
    const order: string[] = [];
    const a = slot.run("logos", async () => {
      order.push("logos:start");
      await first.promise;
      order.push("logos:end");
    });
    const b = slot.run("fx", async () => {
      order.push("fx:start");
    });
    await Promise.resolve();
    expect(slot.state().running?.name).toBe("logos");
    expect(slot.state().waiting).toEqual(["fx"]);
    expect(order).toEqual(["logos:start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["logos:start", "logos:end", "fx:start"]);
    expect(slot.state()).toEqual({ running: null, waiting: [] });
  });

  it("skips a job whose previous run is still going (overlap guard)", async () => {
    const slot = new HeavySlot();
    const hold = deferred();
    const firstRun = slot.run("dataQuality", () => hold.promise);
    const second = await slot.run("dataQuality", async () => "never");
    expect(second).toEqual({ ran: false, reason: "overlap" });
    hold.resolve();
    expect(await firstRun).toEqual({ ran: true, value: undefined });
  });

  it("releases the turn when a job throws, and passes the error on", async () => {
    const slot = new HeavySlot();
    await expect(
      slot.run("broken", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await slot.run("next", async () => 42)).toEqual({ ran: true, value: 42 });
  });
});

describe("every nightly scheduler runs through the heavy-job slot", () => {
  // A daily cron at a fixed minute between 00:00 and 06:59 is nightly batch work.
  const NIGHTLY = /"(\d{1,2}) ([0-6]) \* \* \*"/;

  it("names no nightly cron that bypasses runHeavyJob", () => {
    const root = path.join(__dirname, "../../..");
    const files = [
      ...fs.readdirSync(path.join(root, "jobs")).map((f) => path.join(root, "jobs", f)),
      path.join(root, "services", "backupScheduler.ts"),
    ].filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const nightly = files.filter((f) => NIGHTLY.test(fs.readFileSync(f, "utf-8")));
    expect(nightly.length).toBeGreaterThanOrEqual(15);
    const bypassing = nightly
      .filter((f) => !fs.readFileSync(f, "utf-8").includes("runHeavyJob("))
      .map((f) => path.basename(f));
    expect(bypassing).toEqual([]);
  });
});
