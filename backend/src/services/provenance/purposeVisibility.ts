import { createHash } from "crypto";

import { prisma } from "../../db";
import { purposeVisibilitySchema } from "../../schemas/purpose";
import { PURPOSE_DOMAINS, type PurposeVisibility } from "../../shared/purpose";
import { entryFilterActive, purposeDomainOfModel, setScopeHidden } from "./recordedOnly";

const PURPOSE_MODELS = [
  "PlaceVisit",
  "Flight",
  "LodgingStay",
  "RailJourney",
  "BusJourney",
  "FerryJourney",
  "RentalBooking",
  "Cruise",
] as const;

/** The user's stored per-domain setting, as the schema reads it (a bad value hides nothing). */
export async function loadPurposeVisibilitySetting(userId: string): Promise<PurposeVisibility> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { purposeVisibility: true },
  });
  return parseStoredVisibility(row?.purposeVisibility);
}

/** A stored value that no longer parses hides nothing: showing an entry is the safe direction. */
export function parseStoredVisibility(stored: unknown): PurposeVisibility {
  const parsed = purposeVisibilitySchema.safeParse(stored ?? {});
  return parsed.success ? (parsed.data as PurposeVisibility) : {};
}

/** The same setting keyed by Prisma model, which is what the entry filter reads. */
export async function loadPurposeVisibility(userId: string): Promise<Record<string, string[]>> {
  return modelsFromSetting(await loadPurposeVisibilitySetting(userId));
}

function modelsFromSetting(setting: PurposeVisibility): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const model of PURPOSE_MODELS) {
    const domain = purposeDomainOfModel(model);
    const hidden = domain ? setting[domain] : undefined;
    if (hidden && hidden.length > 0) out[model] = hidden;
  }
  return out;
}

/**
 * Called once a request is authenticated: the user's "ausblenden" choices join the open scope
 * (services/provenance/recordedOnly.ts). No scope — a write, a job, a path outside the scope
 * prefixes — means nothing to narrow, and costs no query.
 */
export async function openPurposeVisibility(
  userId: string,
  /** The stored value, when the caller already read it with the user (no extra query). */
  stored?: unknown
): Promise<string | null> {
  if (!entryFilterActive().open) return null;
  const setting =
    stored === undefined
      ? await loadPurposeVisibilitySetting(userId)
      : parseStoredVisibility(stored);
  setScopeHidden(modelsFromSetting(setting));
  return purposeVisibilityRevision(setting);
}

/**
 * The visibility revision: changes whenever the stored setting changes, so a client holding
 * cached rows (the Companion) knows to evict them. Derived from the normalised setting, so two
 * equal settings share a revision and no counter has to be kept in step.
 */
export function purposeVisibilityRevision(setting: PurposeVisibility): string {
  const canonical = PURPOSE_DOMAINS.map(
    (d) => `${d}:${[...(setting[d] ?? [])].sort().join(",")}`
  ).join(";");
  return createHash("sha1").update(canonical).digest("hex").slice(0, 12);
}

/** The header a scoped read carries so the Companion can evict cached rows when it changes. */
export const PURPOSE_REVISION_HEADER = "X-Purpose-Visibility";

export function markPurposeRevision(
  res: { setHeader(name: string, value: string): unknown },
  revision: string | null
): void {
  if (revision) res.setHeader(PURPOSE_REVISION_HEADER, revision);
}
