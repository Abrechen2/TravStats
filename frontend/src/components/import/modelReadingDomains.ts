import type { ParseableImportDomain } from "./types";

/**
 * The domains whose server path hands a document the templates did not read to
 * the language model (`parseAs` in `backend/src/services/parsing/parseDocument.ts`):
 * flights, cruises, stays and rail. Every other domain is template-or-decline —
 * rentals by design (spec 2026-10-01-rental-domain-design §4: a parking booking
 * looks like a rental), packages and places because only templates read them.
 *
 * Mirrored by hand; change it together with the backend routing. For the rest
 * the import card says nothing about a model instead of promising one: it
 * would never be asked.
 */
const MODEL_READING_DOMAINS: ReadonlySet<ParseableImportDomain> = new Set([
  "flight",
  "cruise",
  "lodging",
  "rail",
]);

export function domainHasModelReading(domain: ParseableImportDomain): boolean {
  return MODEL_READING_DOMAINS.has(domain);
}
