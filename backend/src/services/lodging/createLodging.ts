/**
 * Creating a lodging — shared by the form route and the spreadsheet import.
 *
 * Small on purpose, and still worth one home: the ISO country code is derived
 * from the EFFECTIVE country (the payload merged with whatever geocoding
 * filled in), and `dataSource` is provenance the server stamps, never a value
 * a client sends. A second copy in the importer would be the place where one
 * of those two quietly stops being true.
 *
 * Geocoding stays with the caller. The form geocodes inline; a bulk import
 * does not (same rule as the CSV import, spec §3.1) — rows without
 * coordinates are filled later by the throttled background pass.
 */

import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import type { LodgingInput } from "../../schemas/lodging";
import { resolveCountryCode } from "../../shared/geo/countryCode";

/** Coordinates/address a caller resolved before the write (the form geocodes). */
export interface LodgingLocationPatch {
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
}

export async function createLodgingRecord<I extends Prisma.LodgingInclude>(
  userId: string,
  input: LodgingInput & { visited?: boolean },
  opts: { dataSource: string; location?: LodgingLocationPatch; include?: I }
): Promise<Prisma.LodgingGetPayload<{ include: I }>> {
  const created = { ...input, ...(opts.location ?? {}) };
  // Typed as the plain args, not through the generic `I`: with the 2.7 schema
  // TypeScript gives up comparing the generic include ("excessive stack
  // depth"). The result is re-typed below, where `I` is what callers read.
  const args: Prisma.LodgingCreateArgs = {
    data: {
      ...created,
      isoCountryCode: resolveCountryCode(created.country ?? null),
      userId,
      dataSource: opts.dataSource,
    },
    include: opts.include,
  };
  return prisma.lodging.create(args) as unknown as Promise<
    Prisma.LodgingGetPayload<{ include: I }>
  >;
}
