/**
 * Operator marks for the map cards (forgejo#323): the logo of a rail operator,
 * coach company, ferry line, cruise line or rental company, by the name a
 * journey records.
 *
 * The airline-logo chain is the template (`services/airlineLogo/*`, CLAUDE.md
 * "Airline logos"): tiers asked in order, each returning null on a miss so the
 * next is asked, and the whole chain answering null when nobody has a logo —
 * NEVER a placeholder; the client draws its monogram for a miss.
 *
 *   catalogue — rail operators and rental companies in the vendored
 *               catalogues (`data/rail/operators.json`, `data/rental/
 *               providers.json`), their own site's touch icon. No credit
 *               needed: it is the company's own artwork from its own domain.
 *   wikidata  — the item whose label IS the name, its logo from Commons, free
 *               licences only, rasterised by Commons, credited
 *               (`wikidataOperator.ts`). Only while the admin switch
 *               `operatorLogosOpenDataEnabled` is on (the default).
 *
 * Wikidata answers are cached on disk with their credit and served
 * stale-while-revalidate: a stale entry is served at once and refreshed in the
 * background, coalesced per key; a failed refresh writes only `lastAttemptAt`,
 * so the entry stays visibly stale and is retried after a backoff instead of
 * freezing. Misses are remembered in memory for a day (an outage for an hour),
 * so a logbook page of forty rows costs Wikimedia nothing after the first.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import logger from "../../utils/logger";
import { getInstanceSettings } from "../instanceSettingsService";
import {
  resolveCataloguedProviderLogo,
  resolveProviderLogo,
} from "../rentalProviders/providerLogoService";
import { findRailOperator } from "../rail/operatorCatalog";
import { normalizeProviderName } from "../rentalProviders/providerCatalog";
import {
  lookupOperatorMark,
  type OperatorMarkCredit,
  type OperatorMarkImage,
  type OperatorMarkMiss,
} from "./wikidataOperator";

export const OPERATOR_DOMAINS = ["rail", "bus", "ferry", "rental", "cruise"] as const;
export type OperatorDomain = (typeof OPERATOR_DOMAINS)[number];

export interface OperatorMark {
  image: OperatorMarkImage;
  source: "catalogue" | "wikidata";
  /** Present for a Commons logo, which must be credited; null for the company's own icon. */
  credit: OperatorMarkCredit | null;
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** After a failed refresh, wait this long before trying the same key again. */
const RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
/** An outage is not an answer: asked again sooner than a real miss. */
const OUTAGE_TTL_MS = 60 * 60 * 1000;
/** Bounded background work: at most this many refreshes waiting at once. */
const MAX_PENDING_REFRESHES = 8;

/** The miss memory is an LRU with a cap, swept of expired entries now and then. */
export const MAX_REMEMBERED_MISSES = 2_000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

const misses = new Map<string, { until: number; reason: OperatorMarkMiss }>();
const inFlight = new Map<string, Promise<OperatorMark | null>>();
let lastSweepAt = 0;

export function __resetOperatorMarkCachesForTests(): void {
  misses.clear();
  inFlight.clear();
  lastSweepAt = 0;
}

/** Test seam: how many misses are remembered right now. */
export function __rememberedMissCount(): number {
  return misses.size;
}

function sweepExpiredMisses(now: number): void {
  if (now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  for (const [key, miss] of misses) if (miss.until <= now) misses.delete(key);
}

/** Remember a miss, most recent last; past the cap the oldest one goes. */
export function rememberMiss(key: string, reason: OperatorMarkMiss, ttlMs: number): void {
  const now = Date.now();
  sweepExpiredMisses(now);
  misses.delete(key);
  misses.set(key, { until: now + ttlMs, reason });
  while (misses.size > MAX_REMEMBERED_MISSES) {
    const oldest = misses.keys().next().value;
    if (oldest === undefined) break;
    misses.delete(oldest);
  }
}

export function operatorMarkCacheDir(): string {
  return process.env.NODE_ENV === "production"
    ? "/app/data/cache/operator-logos"
    : path.join(process.cwd(), ".travstats-data", "cache", "operator-logos");
}

/** One file per operator NAME — the domain does not change who the company is. */
export function operatorMarkKey(name: string): string {
  return crypto.createHash("sha1").update(normalizeProviderName(name)).digest("hex").slice(0, 24);
}

interface CacheMeta {
  contentType: string;
  credit: OperatorMarkCredit;
  fetchedAt: number;
  lastAttemptAt: number;
}

async function readCache(key: string): Promise<{ mark: OperatorMark; meta: CacheMeta } | null> {
  try {
    const dir = operatorMarkCacheDir();
    const meta = JSON.parse(
      await fs.readFile(path.join(dir, `${key}.meta.json`), "utf-8")
    ) as CacheMeta;
    if (
      typeof meta.contentType !== "string" ||
      typeof meta.fetchedAt !== "number" ||
      !meta.credit
    ) {
      return null;
    }
    const body = await fs.readFile(path.join(dir, `${key}.img`));
    return {
      mark: {
        image: { body, contentType: meta.contentType },
        source: "wikidata",
        credit: meta.credit,
      },
      meta,
    };
  } catch {
    return null; // cold miss or a corrupt entry — the same thing
  }
}

async function writeCache(
  key: string,
  credit: OperatorMarkCredit,
  image: OperatorMarkImage
): Promise<void> {
  try {
    const dir = operatorMarkCacheDir();
    await fs.mkdir(dir, { recursive: true });
    const now = Date.now();
    await fs.writeFile(path.join(dir, `${key}.img`), image.body);
    const meta: CacheMeta = {
      contentType: image.contentType,
      credit,
      fetchedAt: now,
      lastAttemptAt: now,
    };
    await fs.writeFile(path.join(dir, `${key}.meta.json`), JSON.stringify(meta));
  } catch (error) {
    logger.warn({
      operation: "operator_logo_cache_write_failed",
      key,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
}

/** A failed refresh: only `lastAttemptAt` moves, so the entry stays stale and is retried. */
async function touchFailedRefresh(key: string, meta: CacheMeta): Promise<void> {
  try {
    await fs.writeFile(
      path.join(operatorMarkCacheDir(), `${key}.meta.json`),
      JSON.stringify({ ...meta, lastAttemptAt: Date.now() })
    );
  } catch {
    // Nothing to record — the next request simply retries.
  }
}

function fetchFromWikidata(key: string, name: string): Promise<OperatorMark | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = (async (): Promise<OperatorMark | null> => {
    try {
      const found = await lookupOperatorMark(name);
      if (!found.ok) {
        const outage =
          found.reason === "rateLimited" ||
          found.reason === "timeout" ||
          found.reason === "unavailable";
        rememberMiss(key, found.reason, outage ? OUTAGE_TTL_MS : MISS_TTL_MS);
        // Each failure has its own reason in the log; the name is the user's own
        // text, so only its key is logged.
        logger.info({
          operation: "operator_logo_lookup",
          key,
          outcome: "miss",
          reason: found.reason,
        });
        return null;
      }
      await writeCache(key, found.credit, found.image);
      logger.info({
        operation: "operator_logo_lookup",
        key,
        outcome: "found",
        qid: found.credit.qid,
      });
      return { image: found.image, source: "wikidata", credit: found.credit };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

async function catalogueMark(domain: OperatorDomain, name: string): Promise<OperatorMark | null> {
  const logo =
    domain === "rail"
      ? await resolveCataloguedProviderLogo(findRailOperator(name))
      : domain === "rental"
        ? await resolveProviderLogo(name)
        : null;
  return logo ? { image: logo, source: "catalogue", credit: null } : null;
}

async function wikidataMark(name: string): Promise<OperatorMark | null> {
  const key = operatorMarkKey(name);
  const cached = await readCache(key);
  if (cached) {
    const stale = Date.now() - cached.meta.fetchedAt > MAX_AGE_MS;
    const backedOff = Date.now() - cached.meta.lastAttemptAt < RETRY_BACKOFF_MS;
    if (stale && !backedOff && inFlight.size < MAX_PENDING_REFRESHES) {
      void fetchFromWikidata(key, name).then(async (fresh) => {
        if (!fresh) await touchFailedRefresh(key, cached.meta);
      });
    }
    return cached.mark;
  }
  const miss = misses.get(key);
  if (miss && miss.until > Date.now()) return null;
  misses.delete(key);
  return fetchFromWikidata(key, name);
}

/**
 * The operator's mark, or null — then the card draws the monogram. Asks the
 * catalogue first (rail, rental), then Wikidata while the admin switch is on.
 */
export async function resolveOperatorMark(
  domain: OperatorDomain,
  name: string
): Promise<OperatorMark | null> {
  const trimmed = name.trim();
  if (trimmed === "") return null;
  const fromCatalogue = await catalogueMark(domain, trimmed);
  if (fromCatalogue) return fromCatalogue;
  const { operatorLogosOpenDataEnabled } = await getInstanceSettings();
  if (!operatorLogosOpenDataEnabled) return null;
  return wikidataMark(trimmed);
}
