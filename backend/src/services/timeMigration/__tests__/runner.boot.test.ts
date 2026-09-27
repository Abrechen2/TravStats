import { prisma } from "../../../db";
import * as zoneOf from "../../../shared/time/zoneOf";
import { clearJobs, settleAllJobs } from "../../jobs/jobRegistry";
import { buildTimeMigrationReport } from "../report";
import { startTimeModelBackfillAtBoot } from "../runner";
import { setBackfillRunState } from "../state";
import { kindOf, stillOpen } from "../openQuestions";

/**
 * When the backfill runs at boot, and when it must not (ADR 0002 phase 3b).
 */

jest.setTimeout(60_000);

async function setMarker(at: Date | null): Promise<void> {
  await prisma.adminSettings.updateMany({ data: { timeModelBackfillAt: at } });
}

beforeEach(async () => {
  clearJobs();
  setBackfillRunState({ state: "idle" });
  await prisma.timeMigrationLedger.deleteMany({});
  const { ensureAdminSettingsRow } = await import("../../adminSettingsRow");
  await ensureAdminSettingsRow();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await setMarker(null);
  setBackfillRunState({ state: "idle" });
});

describe("the backfill at boot", () => {
  it("does not start again once it finished on this instance", async () => {
    await setMarker(new Date("2026-09-27T00:00:00.000Z"));
    expect(await startTimeModelBackfillAtBoot()).toBeNull();
  });

  it("does not start when the zone lookup failed its self-check, and the report says why", async () => {
    await setMarker(null);
    jest.spyOn(zoneOf, "zoneSelfCheckResult").mockReturnValue({ ok: false, reason: "broken" });
    expect(await startTimeModelBackfillAtBoot()).toBeNull();
    const report = await buildTimeMigrationReport();
    expect(report.backfill).toMatchObject({
      state: "failed",
      lastError: "TIMEZONE_LOOKUP_UNAVAILABLE",
      completedAt: null,
    });
  });

  it("runs as a job and sets the marker when it finished", async () => {
    await setMarker(null);
    jest.spyOn(zoneOf, "zoneSelfCheckResult").mockReturnValue({ ok: true });
    const job = await startTimeModelBackfillAtBoot();
    expect(job?.kind).toBe("timeModel.backfill");
    expect((await buildTimeMigrationReport()).backfill.state).toBe("running");
    await settleAllJobs();
    const report = await buildTimeMigrationReport();
    expect(report.backfill.state).toBe("completed");
    expect(report.backfill.completedAt).not.toBeNull();
  });
});

describe("whether a backfill question still stands", () => {
  it("maps each reason to one inbox kind", () => {
    expect(kindOf("no_position")).toBe("time_zone_unresolved");
    expect(kindOf("port_unresolved")).toBe("time_zone_unresolved");
    expect(kindOf("writer_unknown")).toBe("time_precision_unknown");
    expect(kindOf("day_anchor_ambiguous")).toBe("time_day_ambiguous");
    expect(kindOf("date_only_day_differs")).toBe("time_day_ambiguous");
  });

  it("is answered by a zone, a known time of day, or a changed day", () => {
    const spec = { zone: "z", precision: "p", legacy: "l" };
    expect(stillOpen(spec, "no_position", null, { z: null })).toBe(true);
    expect(stillOpen(spec, "no_position", null, { z: "Europe/Berlin" })).toBe(false);
    expect(stillOpen(spec, "writer_unknown", null, { p: "unknown" })).toBe(true);
    expect(stillOpen(spec, "writer_unknown", null, { p: "minute" })).toBe(false);
    const legacy = "2026-05-02T10:30:00.000Z";
    expect(stillOpen(spec, "day_anchor_ambiguous", legacy, { l: new Date(legacy) })).toBe(true);
    expect(
      stillOpen(spec, "day_anchor_ambiguous", legacy, { l: new Date("2026-05-02T00:00:00.000Z") })
    ).toBe(false);
  });
});
