/**
 * Cached, bounded access to the subject pictures (`subjectImageLookup.ts`) —
 * the operator-logo service's discipline (`operatorMarkService.ts`), kept to
 * what a hover picture needs:
 *
 * - hits on disk for 30 days, with their credit; an expired entry is looked
 *   up again cold rather than refreshed in the background;
 * - misses in a capped in-memory LRU for a day; an outage is NOT a miss: it
 *   answers `unavailable` and holds the key back for a few minutes only, so a
 *   Wikimedia 503 is neither shown nor remembered as "no picture";
 * - one lookup per key at a time; at most MAX_COLD_IN_FLIGHT cold lookups on
 *   the instance and PER_USER_COLD_LIMIT per user per window; a request waits
 *   COLD_WAIT_MS at most and answers `pending` past it (the tooltip simply has
 *   no picture this time);
 * - only while the instance's Wikimedia switch (`operatorLogosOpenDataEnabled`)
 *   is on — the same switch, because it is the same service asked the same
 *   kind of question: a name, never a place or a person.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import logger from "../../utils/logger";
import { getInstanceSettings } from "../instanceSettingsService";
import { normalizeProviderName } from "../rentalProviders/providerCatalog";
import type { OperatorMarkImage } from "../operatorLogos/wikidataOperator";
import {
  lookupSubjectImage,
  subjectSearchName,
  type SubjectImageCredit,
  type SubjectKind,
} from "./subjectImageLookup";

export interface SubjectImage {
  image: OperatorMarkImage;
  credit: SubjectImageCredit;
}

export interface SubjectImageAnswer {
  picture: SubjectImage | null;
  /** A lookup is running or was not admitted yet: ask again on a later view. */
  pending: boolean;
  /** Wikimedia did not answer (timeout, 429, 5xx, garbled): "could not ask", not "none". */
  unavailable: boolean;
}

const NONE: SubjectImageAnswer = { picture: null, pending: false, unavailable: false };
const PENDING: SubjectImageAnswer = { picture: null, pending: true, unavailable: false };
const UNAVAILABLE: SubjectImageAnswer = { picture: null, pending: false, unavailable: true };

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
/** How long an outage holds a key back — a back-off, not a verdict. */
const OUTAGE_BACKOFF_MS = 2 * 60 * 1000;
export const MAX_COLD_IN_FLIGHT = 3;
export const PER_USER_COLD_LIMIT = 20;
const PER_USER_WINDOW_MS = 15 * 60 * 1000;
const COLD_WAIT_MS = 3_000;
export const MAX_REMEMBERED_MISSES = 2_000;
const MAX_TRACKED_USERS = 1_000;

type LookupOutcome = { picture: SubjectImage | null; unavailable: boolean };

const misses = new Map<string, { until: number; unavailable: boolean }>();
const inFlight = new Map<string, Promise<LookupOutcome>>();
const coldByUser = new Map<string, { since: number; count: number }>();

export function __resetSubjectImageCachesForTests(): void {
  misses.clear();
  inFlight.clear();
  coldByUser.clear();
}

export function subjectImageCacheDir(): string {
  return process.env.NODE_ENV === "production"
    ? "/app/data/cache/subject-images"
    : path.join(process.cwd(), ".travstats-data", "cache", "subject-images");
}

/** One entry per kind and searched name — "VW Golf" and "Volkswagen Golf" share it. */
export function subjectImageKey(kind: SubjectKind, name: string): string {
  const searched = normalizeProviderName(subjectSearchName(kind, name));
  return crypto.createHash("sha1").update(`${kind}|${searched}`).digest("hex").slice(0, 24);
}

function rememberMiss(key: string, unavailable: boolean): void {
  misses.delete(key);
  misses.set(key, {
    until: Date.now() + (unavailable ? OUTAGE_BACKOFF_MS : MISS_TTL_MS),
    unavailable,
  });
  while (misses.size > MAX_REMEMBERED_MISSES) {
    const oldest = misses.keys().next().value;
    if (oldest === undefined) break;
    misses.delete(oldest);
  }
}

function admitUser(userId: string | undefined): boolean {
  if (!userId) return true;
  const now = Date.now();
  const entry = coldByUser.get(userId);
  if (!entry || now - entry.since > PER_USER_WINDOW_MS) {
    coldByUser.delete(userId);
    coldByUser.set(userId, { since: now, count: 1 });
    while (coldByUser.size > MAX_TRACKED_USERS) {
      const oldest = coldByUser.keys().next().value;
      if (oldest === undefined) break;
      coldByUser.delete(oldest);
    }
    return true;
  }
  if (entry.count >= PER_USER_COLD_LIMIT) return false;
  entry.count += 1;
  return true;
}

interface CacheMeta {
  contentType: string;
  credit: SubjectImageCredit;
  fetchedAt: number;
}

async function readCache(key: string): Promise<SubjectImage | null> {
  try {
    const dir = subjectImageCacheDir();
    const meta = JSON.parse(await fs.readFile(path.join(dir, `${key}.meta.json`), "utf-8")) as
      CacheMeta | undefined;
    if (
      !meta ||
      typeof meta.contentType !== "string" ||
      typeof meta.fetchedAt !== "number" ||
      !meta.credit ||
      Date.now() - meta.fetchedAt > MAX_AGE_MS
    ) {
      return null;
    }
    const body = await fs.readFile(path.join(dir, `${key}.img`));
    return { image: { body, contentType: meta.contentType }, credit: meta.credit };
  } catch {
    return null; // cold, expired or corrupt — looked up again
  }
}

async function writeCache(key: string, picture: SubjectImage): Promise<void> {
  try {
    const dir = subjectImageCacheDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${key}.img`), picture.image.body);
    const meta: CacheMeta = {
      contentType: picture.image.contentType,
      credit: picture.credit,
      fetchedAt: Date.now(),
    };
    await fs.writeFile(path.join(dir, `${key}.meta.json`), JSON.stringify(meta));
  } catch (error) {
    logger.warn({
      operation: "subject_image_cache_write_failed",
      key,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
}

function lookUp(key: string, kind: SubjectKind, name: string): Promise<LookupOutcome> {
  const task = (async (): Promise<LookupOutcome> => {
    try {
      const found = await lookupSubjectImage(kind, name);
      if (!found.ok) {
        const outage = ["rateLimited", "timeout", "unavailable", "malformed"].includes(
          found.reason
        );
        rememberMiss(key, outage);
        // The name is the user's own text: only its key reaches the log.
        logger.info({ operation: "subject_image_lookup", key, kind, outcome: found.reason });
        return { picture: null, unavailable: outage };
      }
      const picture = { image: found.image, credit: found.credit };
      await writeCache(key, picture);
      logger.info({ operation: "subject_image_lookup", key, kind, outcome: "found" });
      return { picture, unavailable: false };
    } catch (error) {
      rememberMiss(key, true);
      logger.warn({
        operation: "subject_image_lookup_failed",
        key,
        message: error instanceof Error ? error.message : "unknown error",
      });
      return { picture: null, unavailable: true };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

async function waitFor(task: Promise<LookupOutcome>, waitMs: number): Promise<SubjectImageAnswer> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs);
  });
  try {
    const result = await Promise.race([task, late]);
    return result === "late" ? PENDING : { ...result, pending: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function answerSubjectImage(
  kind: SubjectKind,
  name: string,
  ctx: { userId?: string; waitMs?: number } = {}
): Promise<SubjectImageAnswer> {
  if (subjectSearchName(kind, name) === "") return NONE;
  const { operatorLogosOpenDataEnabled } = await getInstanceSettings();
  if (!operatorLogosOpenDataEnabled) return NONE;
  const key = subjectImageKey(kind, name);
  const cached = await readCache(key);
  if (cached) return { ...NONE, picture: cached };
  const miss = misses.get(key);
  if (miss !== undefined && miss.until > Date.now()) return miss.unavailable ? UNAVAILABLE : NONE;
  misses.delete(key);
  const waitMs = ctx.waitMs ?? COLD_WAIT_MS;
  const running = inFlight.get(key);
  if (running) return waitFor(running, waitMs);
  if (inFlight.size >= MAX_COLD_IN_FLIGHT || !admitUser(ctx.userId)) {
    return PENDING;
  }
  return waitFor(lookUp(key, kind, name), waitMs);
}
