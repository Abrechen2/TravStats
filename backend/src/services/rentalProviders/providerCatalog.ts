/**
 * The rental-provider catalogue (forgejo#196) — DATA, read from
 * `backend/data/rental/providers.json`, not a list in code. It answers two
 * questions and nothing else: what to suggest in the free-text provider field,
 * and which known company a typed provider string names (so its logo can be
 * looked up). It never rewrites what a user typed — `provider` stays free text.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import logger from "../../utils/logger";

const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(80),
  aliases: z.array(z.string().min(1).max(80)).default([]),
  /** The company's own website — where its logo is looked up. */
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
});
const fileSchema = z.object({ providers: z.array(providerSchema) });

export type RentalProvider = z.infer<typeof providerSchema>;

const FILE = path.resolve(__dirname, "../../../data/rental/providers.json");

let cache: readonly RentalProvider[] | null = null;

/**
 * The catalogue, validated once. A missing or malformed file is logged and
 * read as EMPTY: no suggestions and no logos, while every rental still saves
 * — the catalogue is a convenience, never a gate.
 */
export function rentalProviders(): readonly RentalProvider[] {
  if (cache) return cache;
  try {
    const parsed = fileSchema.safeParse(JSON.parse(fs.readFileSync(FILE, "utf-8")));
    if (!parsed.success) {
      logger.error({ operation: "rental_providers_invalid", issues: parsed.error.issues });
      cache = [];
    } else {
      cache = parsed.data.providers;
    }
  } catch (error) {
    logger.error({
      operation: "rental_providers_unreadable",
      message: error instanceof Error ? error.message : String(error),
    });
    cache = [];
  }
  return cache;
}

/** Case, spacing and punctuation folded away: "SIXT rent-a-car" ~ "sixt rent a car". */
export function normalizeProviderName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * The known company a typed provider names — by its name or an alias, after
 * folding. Exact only: "Sixt Leasing" or a local "Auto Müller" names no known
 * company, and a guess would put a wrong logo on the row.
 */
export function findRentalProvider(typed: string | null | undefined): RentalProvider | null {
  if (!typed) return null;
  const key = normalizeProviderName(typed);
  if (!key) return null;
  for (const provider of rentalProviders()) {
    if (normalizeProviderName(provider.name) === key) return provider;
    if (provider.aliases.some((alias) => normalizeProviderName(alias) === key)) return provider;
  }
  return null;
}

/** Test seam: re-read the file on next use. */
export function __resetRentalProvidersForTests(): void {
  cache = null;
}
