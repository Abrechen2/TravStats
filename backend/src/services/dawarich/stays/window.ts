import type { DawarichClient, DawarichPoint } from "../dawarichClient";
const DAY = 86400000,
  MAX_POINTS = 250000;
/** Long/backfilled or capped windows are fetched per day, never silently truncated to the newest points. */
export async function readStayWindow(
  client: DawarichClient,
  start: Date,
  end: Date,
  isAllowed: () => Promise<boolean>
) {
  let truncated = false;
  const found = new Map<string, DawarichPoint>();
  const add = (points: DawarichPoint[], lo: number, hi: number) => {
    for (const p of points) {
      if (p.timestampMs < lo || p.timestampMs > hi) continue;
      if (found.size >= MAX_POINTS) {
        truncated = true;
        break;
      }
      found.set(`${p.id}:${p.timestampMs}`, p);
    }
  };
  if (end.getTime() - start.getTime() <= 7 * DAY) {
    if (!(await isAllowed())) return { points: [], truncated: false, cancelled: true };
    const result = await client.getPoints({ startAt: start, endAt: end });
    if (!result.truncated) {
      add(result.points, start.getTime(), end.getTime());
      return { points: [...found.values()], truncated, cancelled: false };
    }
  }
  for (let at = start.getTime(); at < end.getTime(); at += DAY) {
    if (!(await isAllowed()))
      return { points: [...found.values()], truncated: true, cancelled: true };
    const to = Math.min(at + DAY - 1, end.getTime());
    const part = await client.getPoints({ startAt: new Date(at), endAt: new Date(to) });
    truncated ||= part.truncated;
    add(part.points, at, to);
    if (found.size >= MAX_POINTS) {
      truncated = true;
      break;
    }
  }
  return {
    points: [...found.values()].sort((a, b) => a.timestampMs - b.timestampMs),
    truncated,
    cancelled: false,
  };
}
