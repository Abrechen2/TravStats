import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { applyFxSnapshot, getBaseCurrency, resolveFxFields } from "../../routes/lodging";
import type {
  CommitRowInput,
  LodgingCandidateFields,
  LodgingImportSource,
  StayCandidateFields,
} from "../../schemas/lodgingImport";
import { normalizeLodgingName } from "./lodgingImportPreview";

export interface CommitResult {
  batchId: string;
  createdLodgings: number;
  createdStays: number;
  skipped: number;
  failed: { sourceRowIndex: number; error: string }[];
}

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
}

/** A hotel-local calendar day widened to the UTC-midnight instant the column stores. */
function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Find-or-create a chain by name, case-insensitively. Mirrors the pattern
 * `routes/lodgingChains.ts` POST already ships: `LodgingChain.name` carries a
 * case-SENSITIVE Postgres unique index, so a plain `findUnique` would let
 * "hilton" and "Hilton" both exist as separate rows. A case-insensitive
 * pre-check closes that for the common case; the P2002 catch is the
 * race-safe backstop for two concurrent creates of the exact same name (the
 * residual case-variant race is the same accepted gap documented there).
 */
async function resolveChainId(chainName: string | null | undefined): Promise<number | null> {
  const name = chainName?.trim();
  if (!name) return null;

  const existing = await prisma.lodgingChain.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.lodgingChain.create({ data: { name, isUserAdded: true } });
    return created.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await prisma.lodgingChain.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (!raced) throw err; // shouldn't happen — never swallow silently
    return raced.id;
  }
}

async function createLodging(
  userId: string,
  batchId: string,
  fields: LodgingCandidateFields,
): Promise<string> {
  const chainId = await resolveChainId(fields.chainName);
  const lodging = await prisma.lodging.create({
    data: {
      userId,
      batchId,
      name: fields.name,
      type: fields.type ?? "hotel",
      chainId,
      stars: fields.stars ?? null,
      address: fields.address ?? null,
      city: fields.city ?? null,
      country: fields.country ?? null,
      // NO geocoding here (spec §3.1). Coordinates the source carried are used
      // as-is; missing ones are filled later by the throttled background pass.
      lat: fields.lat ?? null,
      lon: fields.lon ?? null,
      notes: fields.notes ?? null,
      externalRef: fields.externalRef ?? null,
      dataSource: "import",
    },
  });
  return lodging.id;
}

async function createStay(
  userId: string,
  batchId: string,
  lodgingId: string,
  fields: StayCandidateFields,
  baseCurrency: string,
): Promise<void> {
  const checkIn = toDate(fields.checkIn);
  const currency = fields.currency ?? "EUR";

  // A stay with no price simply has no FX snapshot — `applyFxSnapshot` treats
  // a null price as `status: "priceRemoved"` (short-circuits before any
  // network call), and `resolveFxFields` collapses that to an all-null
  // snapshot. A common real import (stays joined by hotel name, no price
  // column at all) is correct data this way, not an error. Reusing
  // `resolveFxFields` (routes/lodging.ts) instead of re-implementing its
  // fallback here keeps this in lockstep if `FxSnapshotFields` ever grows a
  // field.
  const fxOutcome = await applyFxSnapshot(
    { totalPrice: fields.totalPrice, currency, checkIn },
    baseCurrency,
  );
  const fx = resolveFxFields(fxOutcome);

  await prisma.lodgingStay.create({
    data: {
      userId,
      batchId,
      lodgingId,
      checkIn,
      checkOut: toDate(fields.checkOut),
      status: "completed",
      roomCategory: fields.roomCategory ?? null,
      board: fields.board ?? null,
      totalPrice: fields.totalPrice ?? null,
      currency,
      ...fx,
      ratingRoom: fields.ratingRoom ?? null,
      ratingBreakfast: fields.ratingBreakfast ?? null,
      ratingOverall: fields.ratingOverall ?? null,
      bookingReference: fields.bookingReference ?? null,
      externalRef: fields.externalRef ?? null,
      notes: fields.notes ?? null,
      dataSource: "import",
    },
  });
}

/**
 * Commit an import as one revertible batch.
 *
 * - Every row is written in its own try/catch: **a failed row never fails the
 *   batch** (spec §5). Failures come back with their source row index.
 * - A unique-constraint hit on `externalRef` is a SKIP, not a failure — that is
 *   exactly what makes re-importing the same file a no-op.
 * - No geocoding runs here — that is a throttled background pass
 *   (`geocodeBackfill.ts`, Task 9).
 */
export async function commitLodgingImport(
  userId: string,
  source: LodgingImportSource,
  fileName: string | null,
  rows: CommitRowInput[],
): Promise<CommitResult> {
  const batch = await prisma.lodgingImportBatch.create({ data: { userId, source, fileName } });
  const baseCurrency = await getBaseCurrency(userId);

  // Lodgings created by THIS run, so a later row naming the same hotel attaches
  // to it instead of creating a second copy.
  const createdByName = new Map<string, string>();

  let createdLodgings = 0;
  let createdStays = 0;
  let skipped = 0;
  const failed: { sourceRowIndex: number; error: string }[] = [];

  for (const row of rows) {
    if (row.action === "skip") {
      skipped++;
      continue;
    }

    try {
      // `action: "create"` does NOT imply a new Lodging row — a row can be a
      // new stay against an ALREADY-matched lodging (`matchedLodgingId` set,
      // `lodging` null). Branch on `matchedLodgingId`, never on `action`.
      let lodgingId = row.matchedLodgingId ?? null;

      // IDOR guard: `matchedLodgingId` is client-supplied (it comes back from
      // the preview step the client controls) and `Lodging`/`LodgingStay`
      // carry independent `userId` columns with no compound FK — a plain
      // Prisma FK check only proves the row EXISTS, not that it belongs to
      // this user. Verify ownership before it's used for anything. A row
      // that fails this check must NOT fall through to creating a fresh
      // lodging (that would silently duplicate a hotel the row never asked
      // for) — it belongs in `failed`, same as any other per-row failure.
      if (lodgingId) {
        const owned = await prisma.lodging.findFirst({
          where: { id: lodgingId, userId },
          select: { id: true },
        });
        if (!owned) {
          throw new Error("matchedLodgingId does not belong to this user");
        }
      }

      if (!lodgingId && row.lodging) {
        const nameKey = normalizeLodgingName(row.lodging.name);
        const already = createdByName.get(nameKey);
        if (already) {
          lodgingId = already;
        } else {
          try {
            lodgingId = await createLodging(userId, batch.id, row.lodging);
            createdByName.set(nameKey, lodgingId);
            createdLodgings++;
          } catch (err) {
            if (!isUniqueViolation(err) || !row.lodging.externalRef) throw err;
            // Someone (or an earlier run) already owns this externalRef: the row
            // is a duplicate, which is a skip, not a failure.
            const existing = await prisma.lodging.findFirst({
              where: { userId, externalRef: row.lodging.externalRef },
              select: { id: true },
            });
            if (!existing) throw err;
            lodgingId = existing.id;
            createdByName.set(nameKey, existing.id);
            skipped++;
            if (!row.stay) continue;
          }
        }
      }

      if (!lodgingId) {
        throw new Error("Row has neither a lodging to create nor a lodging to attach to");
      }

      if (row.stay) {
        try {
          await createStay(userId, batch.id, lodgingId, row.stay, baseCurrency);
          createdStays++;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          skipped++;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          operation: "lodging_import_row_failed",
          userId,
          sourceRowIndex: row.sourceRowIndex,
          message,
        },
        "Lodging import row failed — batch continues",
      );
      failed.push({ sourceRowIndex: row.sourceRowIndex, error: message });
    }
  }

  logger.info(
    {
      operation: "lodging_import_commit",
      userId,
      batchId: batch.id,
      source,
      createdLodgings,
      createdStays,
      skipped,
      failedCount: failed.length,
    },
    "Lodging import committed",
  );

  return { batchId: batch.id, createdLodgings, createdStays, skipped, failed };
}
