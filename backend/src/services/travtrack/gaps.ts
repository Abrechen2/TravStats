import { AppError } from "../../middleware/errorHandler";
import { instantMs } from "./classify";
import { GAP_REASONS, MAX_GAPS, type GapReason } from "./limits";

/**
 * What the phone reports it could not record (TravTrack plan T2): one wire
 * contract on both sides — `{ from, to, reason }`, ISO instants with an offset
 * like every point's `t`. A gap never names a privacy zone: a zone must not be
 * visible as a hole in the history.
 *
 * A gap is clipped against the account's deleted spans before it is stored, so
 * a late upload cannot re-create a gap inside a span the user deleted.
 */

export { GAP_REASONS, MAX_GAPS, type GapReason };

export type Span = { fromMs: number; toMs: number };
export type ParsedGap = Span & { reason: GapReason };

const invalid = (index: number, why: string): AppError =>
  new AppError(`gaps[${index}]: ${why}`, 400, "VALIDATION_FAILED");

/**
 * Reads every gap or refuses the upload (400): unlike a point, a gap has no
 * outcome of its own to carry a refusal, and storing half of what the phone
 * reported would make the rest look recorded.
 */
export function parseGaps(raw: readonly Record<string, unknown>[]): ParsedGap[] {
  if (raw.length > MAX_GAPS)
    throw new AppError(`At most ${MAX_GAPS} gaps`, 400, "VALIDATION_FAILED");
  return raw.map((g, index) => {
    const fromMs = instantMs(g.from);
    const toMs = instantMs(g.to);
    if (fromMs === null || toMs === null) {
      throw invalid(index, "from and to are instants with an offset, from 2000 to tomorrow");
    }
    if (toMs <= fromMs) throw invalid(index, "to must lie after from");
    if (!(GAP_REASONS as readonly unknown[]).includes(g.reason)) {
      throw invalid(index, `reason is one of ${GAP_REASONS.join(", ")}`);
    }
    return { fromMs, toMs, reason: g.reason as GapReason };
  });
}

/** What is left of a span once every deleted range (`toAt` exclusive) is cut out of it. */
export function clipSpan(span: Span, ranges: readonly { fromAt: Date; toAt: Date }[]): Span[] {
  let pieces: Span[] = [span];
  for (const r of ranges) {
    const rf = r.fromAt.getTime();
    const rt = r.toAt.getTime();
    pieces = pieces.flatMap((p) => {
      if (rt <= p.fromMs || rf >= p.toMs) return [p];
      const out: Span[] = [];
      if (rf > p.fromMs) out.push({ fromMs: p.fromMs, toMs: rf });
      if (rt < p.toMs) out.push({ fromMs: rt, toMs: p.toMs });
      return out;
    });
  }
  return pieces.sort((a, b) => a.fromMs - b.fromMs);
}
