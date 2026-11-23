import fs from "fs";
import path from "path";
import { z } from "zod";
import {
  providerSchema,
  normalizeProviderName,
  type RentalProvider,
} from "../rentalProviders/providerCatalog";

let cached: readonly RentalProvider[] | null = null;
export function railOperators(): readonly RentalProvider[] {
  if (cached) return cached;
  try {
    cached = z
      .array(providerSchema)
      .parse(
        JSON.parse(
          fs.readFileSync(path.resolve(__dirname, "../../../data/rail/operators.json"), "utf8")
        )
      );
  } catch {
    cached = [];
  }
  return cached;
}

function matchExact(name: string): RentalProvider | null {
  const key = normalizeProviderName(name);
  if (!key) return null;
  return (
    railOperators().find((operator) =>
      [operator.name, ...operator.aliases].some((alias) => normalizeProviderName(alias) === key)
    ) ?? null
  );
}

/**
 * Exact catalogue aliases only; user input is never treated as a website.
 * A compound name ("China Railway / MTR", "DB Fernverkehr, ÖBB") is tried as
 * typed first, then without a bracketed note ("Shanghai Maglev (Transrapid)"),
 * then segment by segment — the first segment the catalogue knows names the
 * logo. Still exact: a segment nobody catalogued is a miss, not a guess.
 */
export function findRailOperator(name: string): RentalProvider | null {
  const whole = matchExact(name);
  if (whole) return whole;
  const unbracketed = name.replace(/\([^)]*\)/g, " ").trim();
  const bare = unbracketed !== name ? matchExact(unbracketed) : null;
  if (bare) return bare;
  for (const segment of unbracketed.split(/\s*[/,;&+]\s*|\s+(?:und|and)\s+/i)) {
    const hit = matchExact(segment);
    if (hit) return hit;
  }
  return null;
}
