/**
 * Update checker — caches the latest stable GitHub release and exposes a
 * small "is there a new version" answer to the public /api/v1/version
 * endpoint, so the frontend can surface an update banner.
 *
 * Polls `repos/<owner>/<repo>/releases/latest` (only stable releases,
 * GitHub already filters out prereleases). The cache lives in process
 * memory for 6 hours; failures keep the cache stale rather than thrashing
 * GitHub. Self-hosted instances behind firewalls degrade silently —
 * `check()` returns `null` and the badge stays hidden.
 */

import logger from '../utils/logger';

const GITHUB_REPO = 'Abrechen2/TravStats';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

interface UpdateInfo {
  latestAvailable: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
}

interface CacheEntry {
  fetchedAt: number;
  data: UpdateInfo | null;
}

let cache: CacheEntry | null = null;
let inflight: Promise<UpdateInfo | null> | null = null;

interface GithubReleasePayload {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

function isObject(value: unknown): value is GithubReleasePayload {
  return typeof value === 'object' && value !== null;
}

async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'travstats-update-check',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn({
        operation: 'update_check_http_error',
        status: response.status,
      });
      return null;
    }

    const payload: unknown = await response.json();
    if (!isObject(payload)) return null;

    if (payload.draft === true || payload.prerelease === true) return null;

    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : null;
    const htmlUrl = typeof payload.html_url === 'string' ? payload.html_url : null;
    if (!tag || !htmlUrl) return null;

    const version = tag.replace(/^v/, '');
    const body = typeof payload.body === 'string' ? payload.body : '';
    const publishedAt = typeof payload.published_at === 'string' ? payload.published_at : '';

    return {
      latestAvailable: version,
      releaseUrl: htmlUrl,
      releaseNotes: body,
      publishedAt,
    };
  } catch (err) {
    logger.warn({
      operation: 'update_check_network_error',
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getCachedLatestRelease(): Promise<UpdateInfo | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < REFRESH_INTERVAL_MS) {
    return cache.data;
  }

  if (inflight) return inflight;

  inflight = fetchLatestRelease()
    .then((data) => {
      cache = { fetchedAt: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Compare a current running version against the latest available stable
 * version. Pre-release suffixes on the current version are stripped, so a
 * user on `1.2.0-rc.3` doesn't get spammed when `1.2.0` ships — the
 * release IS what they're running.
 *
 * Returns `true` only when latest > current under semver, both treated as
 * stable for the comparison.
 */
export function isUpdateAvailable(current: string, latest: string): boolean {
  const cur = parseSemver(stripPrerelease(current));
  const lat = parseSemver(stripPrerelease(latest));
  if (!cur || !lat) return false;

  for (let i = 0; i < 3; i++) {
    if (lat[i] > cur[i]) return true;
    if (lat[i] < cur[i]) return false;
  }
  return false;
}

function stripPrerelease(version: string): string {
  return version.replace(/^v/, '').split('-')[0]!;
}

function parseSemver(s: string): [number, number, number] | null {
  const parts = s.split('.');
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!];
}

/**
 * Test seam — clears the in-memory cache. Production code never calls this.
 */
export function __resetUpdateCheckerCache(): void {
  cache = null;
  inflight = null;
}
