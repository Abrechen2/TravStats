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

/** Exact catalogue aliases only; user input is never treated as a website. */
export function findRailOperator(name: string): RentalProvider | null {
  const key = normalizeProviderName(name);
  return (
    railOperators().find((operator) =>
      [operator.name, ...operator.aliases].some((alias) => normalizeProviderName(alias) === key)
    ) ?? null
  );
}
