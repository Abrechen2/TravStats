import { analyseGaps, type AnalysisInput, type LogEvent } from "../analyze";

/**
 * The gap rules (spec 2026-10-29, "Gaps"), one case per cause, plus the
 * Codex findings on the first draft: an upload is matched by the span of its
 * fixes, not by being "later"; `background` proves nothing; a reported gap
 * explains only its own part; state carried in from before the day counts.
 */

const H = 3_600_000;
const M = 60_000;
const DAY = Date.parse("2026-10-28T00:00:00Z");

/** Points every minute 06:00–07:00 and 09:00–10:00: one gap 07:00–09:00. */
const points = [
  ...Array.from({ length: 61 }, (_, i) => DAY + 6 * H + i * M),
  ...Array.from({ length: 61 }, (_, i) => DAY + 9 * H + i * M),
];

const base = (over: Partial<AnalysisInput> = {}): AnalysisInput => ({
  fromMs: DAY,
  untilMs: DAY + 24 * H,
  pointTimes: points,
  fixes: [],
  events: [],
  carried: {},
  reported: [],
  receipts: new Set(),
  hasLog: (over.events?.length ?? 0) > 0 || (over.fixes?.length ?? 0) > 0,
  ...over,
});

const ev = (tMs: number, kind: string, data: Record<string, unknown>): LogEvent => ({
  tMs,
  kind,
  data,
});
const inGap = DAY + 7 * H + 30 * M;
const theGap = (input: AnalysisInput) => analyseGaps(input).find((g) => g.fromMs === DAY + 7 * H)!;

describe("analyseGaps", () => {
  it("reports no edges and an unlogged gap as noLog when the phone sent no log", () => {
    const gaps = analyseGaps(base());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ fromMs: DAY + 7 * H, toMs: DAY + 9 * H, cause: "noLog" });
  });

  it("names a permission in force, carried in from before the day", () => {
    expect(theGap(base({ carried: { permission: "whenInUse" } })).cause).toBe("permission");
  });

  it("names a paused recorder that did not resume", () => {
    const events = [ev(DAY + 6 * H + 59 * M, "recorder", { event: "pause" })];
    expect(theGap(base({ events })).cause).toBe("recorderPaused");
  });

  it("matches uploads by the span of their fixes", () => {
    const fixes = [{ tMs: inGap, received: 60, kept: 60, dropped: {} }];
    const covering = ev(DAY + 12 * H, "upload", {
      uploadId: "u1",
      status: 500,
      fromT: inGap - M,
      toT: inGap + M,
    });
    const unrelated = ev(DAY + 12 * H, "upload", {
      uploadId: "u2",
      status: 201,
      fromT: DAY + 11 * H,
      toT: DAY + 12 * H,
    });
    expect(theGap(base({ fixes, events: [covering, unrelated] })).cause).toBe("uploadFailed");
    expect(theGap(base({ fixes, events: [unrelated] })).cause).toBe("notUploaded");
    expect(theGap(base({ fixes, events: [covering], receipts: new Set(["u1"]) })).cause).toBe(
      "lostAfterUpload"
    );
  });

  it("names fixes the phone dropped, with the reasons", () => {
    const fixes = [{ tMs: inGap, received: 30, kept: 0, dropped: { accuracy: 30 } }];
    const gap = theGap(base({ fixes }));
    expect(gap.cause).toBe("droppedOnPhone");
    expect(gap.evidence.dropped).toEqual({ accuracy: 30 });
  });

  it("does not read `background` as a terminated app", () => {
    const events = [ev(DAY + 7 * H + M, "lifecycle", { event: "background" })];
    expect(theGap(base({ events })).cause).toBe("unexplained");
  });

  it("says whether iOS's automatic pause was on for an unexplained gap", () => {
    const events = [
      ev(DAY + 5 * H, "recorder", { event: "start", pausesAuto: true }),
      ev(DAY + 7 * H + M, "lifecycle", { event: "background" }),
    ];
    expect(theGap(base({ events })).evidence.autoPause).toBe(true);
    expect(theGap(base()).evidence.autoPause).toBeNull();
  });

  it("does not count the edge minute of the point that ends the gap", () => {
    // The fix kept at 09:00 is the point at 09:00; it was uploaded and stored.
    const fixes = [{ tMs: DAY + 9 * H, received: 1, kept: 1, dropped: {} }];
    const upload = ev(DAY + 9 * H + M, "upload", {
      uploadId: "u1",
      status: 201,
      fromT: DAY + 9 * H,
      toT: DAY + 9 * H,
    });
    const gap = theGap(base({ fixes, events: [upload] }));
    expect(gap.evidence.fixesKept).toBe(0);
    expect(gap.cause).not.toBe("notUploaded");
  });

  it("reads autoPause from the recorder in force at the gap's start", () => {
    const later = [ev(DAY + 8 * H, "recorder", { event: "start", pausesAuto: true })];
    expect(theGap(base({ events: later })).evidence.autoPause).toBeNull();
  });

  it("names a terminate with no wake before the gap ends", () => {
    const ended = [ev(DAY + 7 * H + M, "lifecycle", { event: "terminate" })];
    expect(theGap(base({ events: ended })).cause).toBe("appNotRunning");
    const woke = [...ended, ev(DAY + 8 * H, "lifecycle", { event: "significantWake" })];
    expect(theGap(base({ events: woke })).cause).toBe("unexplained");
  });

  it("explains only the reported part and classifies the rest on its own", () => {
    const gaps = analyseGaps(
      base({
        reported: [{ fromMs: DAY + 7 * H, toMs: DAY + 7 * H + 20 * M, reason: "zonesUnknown" }],
        carried: { permission: "always", lifecycle: "foreground" },
      })
    );
    expect(gaps.map((g) => g.cause)).toEqual(["reportedGap", "unexplained"]);
    expect(gaps[0].evidence.reportedReason).toBe("zonesUnknown");
    expect(gaps[1].fromMs).toBe(DAY + 7 * H + 20 * M);
  });

  it("does not open the day's edges for an upload logged after the day", () => {
    const later = [ev(DAY + 30 * H, "upload", { uploadId: "u9", status: 201, fromT: 0, toT: 1 })];
    expect(analyseGaps(base({ events: later, hasLog: false }))).toHaveLength(1);
  });

  it("adds the day's edges only where the log speaks", () => {
    const fixes = [{ tMs: DAY + H, received: 0, kept: 0, dropped: {} }];
    const gaps = analyseGaps(base({ fixes }));
    expect(gaps.map((g) => [g.fromMs, g.toMs])).toEqual([
      [DAY, DAY + 6 * H],
      [DAY + 7 * H, DAY + 9 * H],
      [DAY + 10 * H, DAY + 24 * H],
    ]);
  });
});
