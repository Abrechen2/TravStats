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
import { assertChainsVisible } from "./chainScope";
import { osmRefToStore } from "./osmRef";

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
  // Typed as the plain args, not through the generic `I`: with the 2.7 schema
  // TypeScript gives up comparing the generic include ("excessive stack
  // depth"). The result is re-typed below, where `I` is what callers read.
  const args: Prisma.LodgingCreateArgs = {
    data: await buildLodgingCreateData(userId, input, opts),
    include: opts.include,
  };
  return prisma.lodging.create(args) as unknown as Promise<
    Prisma.LodgingGetPayload<{ include: I }>
  >;
}

/**
 * The row `createLodgingRecord` writes, for a caller that writes it inside its
 * own transaction (the package-tour commit). Checks the chain reference and
 * resolves the OSM reference, both reads, so it runs before the transaction.
 */
export async function buildLodgingCreateData(
  userId: string,
  input: LodgingInput & { visited?: boolean },
  opts: { dataSource: string; location?: LodgingLocationPatch }
): Promise<Prisma.LodgingUncheckedCreateInput> {
  const { osmRef, ...fields } = input;
  // A chain id is a reference to a row the caller may not own: another
  // account's chain is refused like one that does not exist.
  if (fields.chainId != null) await assertChainsVisible(userId, [fields.chainId]);
  const created = { ...fields, ...(opts.location ?? {}) };
  const externalRef = await osmRefToStore(userId, osmRef);
  return {
    ...created,
    isoCountryCode: resolveCountryCode(created.country ?? null),
    ...(externalRef !== undefined && { externalRef }),
    userId,
    dataSource: opts.dataSource,
  };
}
