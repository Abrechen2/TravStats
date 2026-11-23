import { logger } from "../../lib/logger";

/** Recent queries the header search remembers, newest first. */
export const RECENT_SEARCH_MAX = 8;
const PREFIX = "travstats:global-search-recent:";

const keyFor = (userId: string): string => `${PREFIX}${userId}`;

/**
 * The remembered queries of ONE account, on this device only. Per user so a
 * shared browser never offers one person's searches to another; a read that
 * fails (private mode, corrupt value) is an empty list, never an error.
 */
export function readRecentSearches(userId: string | null): string[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string").slice(0, RECENT_SEARCH_MAX);
  } catch (err) {
    logger.warn("recentSearches: unreadable, starting empty", err);
    return [];
  }
}

/** Puts `query` first, dropping an older spelling of it (case-insensitively). */
export function rememberSearch(userId: string | null, query: string): string[] {
  const q = query.trim();
  const current = readRecentSearches(userId);
  if (!userId || q === "") return current;
  const next = [q, ...current.filter((c) => c.toLowerCase() !== q.toLowerCase())].slice(
    0,
    RECENT_SEARCH_MAX
  );
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch (err) {
    logger.warn("recentSearches: could not save", err);
  }
  return next;
}

export function clearRecentSearches(userId: string | null): void {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFor(userId));
  } catch (err) {
    logger.warn("recentSearches: could not clear", err);
  }
}
