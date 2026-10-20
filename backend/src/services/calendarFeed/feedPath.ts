/**
 * The token in the last path segment of a feed URL, `<token>.ics`. The suffix
 * is part of the address calendar apps expect (some decide the format by it);
 * a segment without it names no feed.
 */
const FEED_SUFFIX = ".ics";

export function tokenOfFeedPath(segment: unknown): string | null {
  if (typeof segment !== "string" || !segment.endsWith(FEED_SUFFIX)) return null;
  return segment.slice(0, -FEED_SUFFIX.length);
}
