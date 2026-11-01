import * as fs from "fs";
import * as path from "path";
import { CRON_JOBS, stopCronJobs } from "../cronJobs";

// Started outside the list on purpose (index.ts starts and stops them itself).
const STARTED_ELSEWHERE = new Set(["usageStatsScheduler.ts"]);

describe("cron job registry", () => {
  it("lists every scheduler module, so shutdown stops all of them (four were never stopped)", () => {
    const dir = path.join(__dirname, "..");
    const modules = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith("Scheduler.ts") && !STARTED_ELSEWHERE.has(f));
    const source = fs.readFileSync(path.join(dir, "cronJobs.ts"), "utf8");
    for (const file of modules) {
      expect(source).toContain(`./${file.replace(/\.ts$/, "")}"`);
    }
  });

  it("gives every job a stop that matches its start", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "cronJobs.ts"), "utf8");
    const starts = [...source.matchAll(/\.(start\w+)\(/g)].map((m) => m[1].replace("start", ""));
    const stops = [...source.matchAll(/\.(stop\w+)\(\)/g)].map((m) => m[1].replace("stop", ""));
    expect(stops).toEqual(starts.filter((s) => s !== "CronJobs"));
    expect(CRON_JOBS.length).toBe(starts.length);
  });

  it("stopCronJobs runs without throwing when nothing was started", async () => {
    await expect(stopCronJobs()).resolves.toBeUndefined();
  });
});
