/**
 * Rental-provider logos (forgejo#196) — the airline-logo pattern
 * (`services/airlineLogo/airlineLogoService.ts`) on a smaller scale: a chain
 * of tiers, each returning `null` on a miss so the next one is asked, and the
 * whole chain returning `null` when nobody has a logo. NEVER a placeholder:
 * the client draws its monogram for a miss, which is honest, where a generic
 * glyph or a guessed brand would not be.
 *
 * Tiers, all keyless:
 *   site   — the provider's own `apple-touch-icon.png` (the square mark a
 *            phone puts on its home screen). The company's own artwork, from
 *            the domain in the catalogue, so it cannot be someone else's.
 *   ddg    — DuckDuckGo's icon service for the same domain, the tail net for
 *            a site without a touch icon. Asked about the catalogue domain
 *            only, never about a name, so it too cannot pick a wrong company.
 *
 * Only providers in `data/rental/providers.json` are ever looked up; a free-
 * text provider nobody catalogued answers null without a request.
 *
 * Positive results are cached on disk (one file per provider, refreshed after
 * LOGO_MAX_AGE); misses are remembered in memory for a day, so a provider
 * without a logo does not cost a request per page view.
 */
import fs from "fs/promises";
import path from "path";
import logger from "../../utils/logger";
import { findRentalProvider, type RentalProvider } from "./providerCatalog";

export interface ProviderLogo {
  body: Buffer;
  contentType: string;
}

export type ProviderLogoSource = "site" | "ddg";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const LOGO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const negativeCache = new Map<string, number>();
const inFlight = new Map<string, Promise<ProviderLogo | null>>();

export function __resetProviderLogoCachesForTests(): void {
  negativeCache.clear();
  inFlight.clear();
}

export function providerLogoCacheDir(): string {
  return process.env.NODE_ENV === "production"
    ? "/app/data/cache/provider-logos"
    : path.join(process.cwd(), ".travstats-data", "cache", "provider-logos");
}

/** Raster images only: an SVG from a third-party site is markup, not a picture. */
const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

async function fetchImage(url: string): Promise<ProviderLogo | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!ACCEPTED_TYPES.has(contentType)) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0 || body.length > MAX_BYTES) return null;
    return { body, contentType };
  } catch (error) {
    logger.warn({
      operation: "provider_logo_fetch_failed",
      url,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return null;
  }
}

const TIERS: readonly {
  source: ProviderLogoSource;
  url: (p: RentalProvider) => string;
}[] = [
  { source: "site", url: (p) => `https://www.${p.domain}/apple-touch-icon.png` },
  { source: "ddg", url: (p) => `https://icons.duckduckgo.com/ip3/${p.domain}.ico` },
];

async function fetchFromChain(provider: RentalProvider): Promise<ProviderLogo | null> {
  for (const tier of TIERS) {
    const logo = await fetchImage(tier.url(provider));
    if (logo) return logo;
  }
  return null;
}

async function readCached(id: string): Promise<{ logo: ProviderLogo; fetchedAt: number } | null> {
  try {
    const dir = providerLogoCacheDir();
    const meta = JSON.parse(await fs.readFile(path.join(dir, `${id}.meta.json`), "utf-8")) as {
      contentType?: unknown;
      fetchedAt?: unknown;
    };
    if (typeof meta.contentType !== "string" || typeof meta.fetchedAt !== "number") return null;
    const body = await fs.readFile(path.join(dir, `${id}.img`));
    return { logo: { body, contentType: meta.contentType }, fetchedAt: meta.fetchedAt };
  } catch {
    return null; // cold miss or a corrupt entry — the same thing
  }
}

async function writeCached(id: string, logo: ProviderLogo): Promise<void> {
  try {
    const dir = providerLogoCacheDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.img`), logo.body);
    await fs.writeFile(
      path.join(dir, `${id}.meta.json`),
      JSON.stringify({ contentType: logo.contentType, fetchedAt: Date.now() })
    );
  } catch (error) {
    // A cache that cannot be written costs a refetch next time, not the answer.
    logger.warn({
      operation: "provider_logo_cache_write_failed",
      id,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function resolveFresh(provider: RentalProvider): Promise<ProviderLogo | null> {
  const existing = inFlight.get(provider.id);
  if (existing) return existing;
  const task = (async (): Promise<ProviderLogo | null> => {
    try {
      const logo = await fetchFromChain(provider);
      if (!logo) {
        negativeCache.set(provider.id, Date.now() + NEGATIVE_TTL_MS);
        return null;
      }
      await writeCached(provider.id, logo);
      return logo;
    } finally {
      inFlight.delete(provider.id);
    }
  })();
  inFlight.set(provider.id, task);
  return task;
}

/**
 * The logo for a provider as the user typed it, or null — unknown provider,
 * or no tier has a logo for it. A stale cached logo is still served while a
 * refresh runs behind it; a failed refresh keeps the old bytes.
 */
export async function resolveProviderLogo(typed: string): Promise<ProviderLogo | null> {
  const provider = findRentalProvider(typed);
  if (!provider) return null;

  const cached = await readCached(provider.id);
  if (cached) {
    if (Date.now() - cached.fetchedAt > LOGO_MAX_AGE_MS) {
      void resolveFresh(provider).catch(() => undefined);
    }
    return cached.logo;
  }

  const until = negativeCache.get(provider.id);
  if (until !== undefined && until > Date.now()) return null;
  negativeCache.delete(provider.id);
  return resolveFresh(provider);
}
