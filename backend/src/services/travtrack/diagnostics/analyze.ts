/**
 * Why a device's day has holes (spec 2026-10-29-travtrack-diagnostics,
 * "Gaps"). Pure: the reader hands in one device's points, minute buckets,
 * events, the state carried in from before the day, its reported gaps and
 * which points uploads the server holds a receipt for.
 *
 * The rules claim only what the log shows. `background` is never evidence of
 * anything (the recorder runs in the background), and the last rule is
 * `unexplained`, not "the app ran": suspension, the OS distance filter and no
 * delivery at all leave the same empty log.
 */

export const GAP_MIN_MS = 10 * 60_000;
const PART_MIN_MS = 2 * 60_000;
const NO_LOG_LOOKBACK_MS = 30 * 60_000;

export type GapCause =
  | "reportedGap"
  | "permission"
  | "recorderPaused"
  | "lostAfterUpload"
  | "uploadFailed"
  | "notUploaded"
  | "droppedOnPhone"
  | "appNotRunning"
  | "noLog"
  | "unexplained";

export interface FixBucket {
  tMs: number;
  received: number;
  kept: number;
  dropped: Record<string, number>;
}

export interface LogEvent {
  tMs: number;
  kind: string;
  data: Record<string, unknown>;
}

export interface CarriedState {
  permission?: string;
  recorder?: string;
  lifecycle?: string;
}

export interface AnalysisInput {
  fromMs: number;
  untilMs: number;
  /** This device's stored points, ascending. */
  pointTimes: readonly number[];
  fixes: readonly FixBucket[];
  /** Every non-`fixes` event, ascending; `upload` events may lie after the day. */
  events: readonly LogEvent[];
  carried: CarriedState;
  reported: readonly { fromMs: number; toMs: number; reason: string }[];
  /** Points upload ids the server holds a receipt for. */
  receipts: ReadonlySet<string>;
  /**
   * Whether the device logged anything within the day itself. Events before
   * the day (the 30-minute lookback) and uploads after it do not make the
   * day's edges a gap.
   */
  hasLog: boolean;
}

export interface GapEvidence {
  fixesReceived: number;
  fixesKept: number;
  dropped: Record<string, number>;
  uploads: { uploadId: string; status: number | null; received: boolean }[];
  permission: string | null;
  recorder: string | null;
  lifecycle: string | null;
  reportedReason: string | null;
}

export interface AnalysedGap {
  fromMs: number;
  toMs: number;
  cause: GapCause;
  evidence: GapEvidence;
}

type Span = { fromMs: number; toMs: number };

/** Point-free stretches of at least {@link GAP_MIN_MS}, edges only where the log speaks. */
export function pointFreeStretches(input: AnalysisInput, hasLog: boolean): Span[] {
  const { fromMs, untilMs, pointTimes } = input;
  if (pointTimes.length === 0) return hasLog ? [{ fromMs, toMs: untilMs }] : [];
  const stretches: Span[] = [];
  if (hasLog) stretches.push({ fromMs, toMs: pointTimes[0] });
  for (let i = 1; i < pointTimes.length; i++) {
    stretches.push({ fromMs: pointTimes[i - 1], toMs: pointTimes[i] });
  }
  if (hasLog) stretches.push({ fromMs: pointTimes[pointTimes.length - 1], toMs: untilMs });
  return stretches.filter((s) => s.toMs - s.fromMs >= GAP_MIN_MS);
}

/** The stretch cut at reported gaps: reported parts and the rest, in order. */
function splitAtReported(
  stretch: Span,
  reported: AnalysisInput["reported"]
): (Span & { reason: string | null })[] {
  const cuts = reported
    .map((r) => ({
      fromMs: Math.max(r.fromMs, stretch.fromMs),
      toMs: Math.min(r.toMs, stretch.toMs),
      reason: r.reason,
    }))
    .filter((r) => r.toMs > r.fromMs)
    .sort((a, b) => a.fromMs - b.fromMs);
  const parts: (Span & { reason: string | null })[] = [];
  let at = stretch.fromMs;
  for (const cut of cuts) {
    if (cut.toMs <= at) continue;
    const start = Math.max(cut.fromMs, at);
    if (start - at >= PART_MIN_MS) parts.push({ fromMs: at, toMs: start, reason: null });
    parts.push({ fromMs: start, toMs: cut.toMs, reason: cut.reason });
    at = cut.toMs;
  }
  if (stretch.toMs - at >= PART_MIN_MS)
    parts.push({ fromMs: at, toMs: stretch.toMs, reason: null });
  return parts;
}

const field = (e: LogEvent, key: string): string | null =>
  typeof e.data[key] === "string" ? (e.data[key] as string) : null;

/** The state of one kind at an instant: the latest event before it, else what was carried in. */
function stateAt(
  events: readonly LogEvent[],
  kind: string,
  key: string,
  atMs: number,
  carried: string | undefined
): string | null {
  let state = carried ?? null;
  for (const e of events) {
    if (e.tMs >= atMs) break;
    if (e.kind === kind) state = field(e, key) ?? state;
  }
  return state;
}

function inside(events: readonly LogEvent[], kind: string, part: Span): LogEvent[] {
  return events.filter((e) => e.kind === kind && e.tMs >= part.fromMs && e.tMs < part.toMs);
}

const RESUMED = new Set(["start", "resume"]);
const WOKE = new Set(["launch", "backgroundLaunch", "significantWake"]);
const ok = (status: number | null): boolean => status !== null && status >= 200 && status < 300;

function classify(part: Span, input: AnalysisInput): { cause: GapCause; evidence: GapEvidence } {
  const { events, carried } = input;
  const permission = stateAt(events, "permission", "status", part.fromMs, carried.permission);
  const recorder = stateAt(events, "recorder", "event", part.fromMs, carried.recorder);
  const lifecycle = stateAt(events, "lifecycle", "event", part.fromMs, carried.lifecycle);

  const buckets = input.fixes.filter((f) => f.tMs >= part.fromMs && f.tMs < part.toMs);
  const dropped: Record<string, number> = {};
  for (const b of buckets) {
    for (const [reason, n] of Object.entries(b.dropped))
      dropped[reason] = (dropped[reason] ?? 0) + n;
  }
  const fixesReceived = buckets.reduce((n, b) => n + b.received, 0);
  const fixesKept = buckets.reduce((n, b) => n + b.kept, 0);

  const uploads = events
    .filter((e) => e.kind === "upload")
    .filter((e) => {
      const from = typeof e.data.fromT === "number" ? e.data.fromT : null;
      const to = typeof e.data.toT === "number" ? e.data.toT : null;
      return from !== null && to !== null && from < part.toMs && to >= part.fromMs;
    })
    .map((e) => {
      const uploadId = field(e, "uploadId") ?? "";
      return {
        uploadId,
        status: typeof e.data.status === "number" ? e.data.status : null,
        received: input.receipts.has(uploadId),
      };
    });

  const evidence: GapEvidence = {
    fixesReceived,
    fixesKept,
    dropped,
    uploads,
    permission,
    recorder,
    lifecycle,
    reportedReason: null,
  };

  const notAlways = (s: string | null) => s !== null && s !== "always";
  if (
    notAlways(permission) ||
    inside(events, "permission", part).some((e) => notAlways(field(e, "status")))
  ) {
    return { cause: "permission", evidence };
  }
  if (
    (recorder === "stop" || recorder === "pause") &&
    !inside(events, "recorder", part).some((e) => RESUMED.has(field(e, "event") ?? ""))
  ) {
    return { cause: "recorderPaused", evidence };
  }
  if (fixesKept > 0) {
    if (uploads.some((u) => ok(u.status) || u.received))
      return { cause: "lostAfterUpload", evidence };
    return { cause: uploads.length > 0 ? "uploadFailed" : "notUploaded", evidence };
  }
  if (fixesReceived > 0) return { cause: "droppedOnPhone", evidence };

  const lifecycleIn = inside(events, "lifecycle", part);
  const lastTerminate = [...lifecycleIn].reverse().find((e) => field(e, "event") === "terminate");
  const endedBefore =
    lifecycle === "terminate" && !lifecycleIn.some((e) => WOKE.has(field(e, "event") ?? ""));
  const endedInside =
    lastTerminate !== undefined &&
    !lifecycleIn.some((e) => e.tMs > lastTerminate.tMs && WOKE.has(field(e, "event") ?? ""));
  if (endedBefore || endedInside) return { cause: "appNotRunning", evidence };

  const spoke =
    events.some((e) => e.tMs >= part.fromMs - NO_LOG_LOOKBACK_MS && e.tMs < part.toMs) ||
    input.fixes.some((f) => f.tMs >= part.fromMs - NO_LOG_LOOKBACK_MS && f.tMs < part.toMs);
  if (!spoke && permission === null && recorder === null && lifecycle === null) {
    return { cause: "noLog", evidence };
  }
  return { cause: "unexplained", evidence };
}

export function analyseGaps(input: AnalysisInput): AnalysedGap[] {
  const gaps: AnalysedGap[] = [];
  for (const stretch of pointFreeStretches(input, input.hasLog)) {
    for (const part of splitAtReported(stretch, input.reported)) {
      if (part.reason !== null) {
        const { evidence } = classify(part, input);
        gaps.push({
          fromMs: part.fromMs,
          toMs: part.toMs,
          cause: "reportedGap",
          evidence: { ...evidence, reportedReason: part.reason },
        });
      } else {
        gaps.push({ fromMs: part.fromMs, toMs: part.toMs, ...classify(part, input) });
      }
    }
  }
  return gaps;
}
