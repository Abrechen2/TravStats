import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import {
  applyFxSnapshot,
  getBaseCurrency,
  resolveFxFields,
  type FxSnapshotOutcome,
} from "../../routes/lodging";
import type {
  CommitRowInput,
  LodgingCandidateFields,
  LodgingImportSource,
  StayCandidateFields,
} from "../../schemas/lodgingImport";
import { normalizeLodgingName } from "./lodgingImportPreview";
import { deriveStayOverallRating } from "../../shared/ratingDerivation";

/**
 * A small, STABLE set of client-safe failure codes (finding: raw exception
 * messages — including Prisma's, which embed the model name, the failing
 * column, and a rendered snippet of the query invocation — were being
 * returned verbatim in `failed[].error` on a 201 SUCCESS response, where
 * the error handler's leak protections never run). Only the two failure
 * modes this function deliberately throws for get their own code; anything
 * else — a Prisma error, a driver hiccup, literally any unanticipated
 * exception — collapses to `unexpected_error`. The full untouched detail
 * still reaches Pino via `logger.warn` below; only the CLIENT-visible
 * string is generic.
 */
export type LodgingImportRowFailureCode =
  "ownership_mismatch" | "missing_lodging_reference" | "unexpected_error";

const FAILURE_MESSAGES: Record<LodgingImportRowFailureCode, string> = {
  ownership_mismatch: "This lodging does not belong to your account.",
  missing_lodging_reference: "This row has no lodging to create or attach to.",
  unexpected_error:
    "This row could not be imported due to an unexpected error.",
};

/** Thrown when a client-supplied `matchedLodgingId` fails the ownership check. */
class OwnershipMismatchError extends Error {
  constructor() {
    super("matchedLodgingId does not belong to this user");
    this.name = "OwnershipMismatchError";
  }
}

/** Thrown when a row has neither `lodging` fields nor a `matchedLodgingId`. */
class MissingLodgingReferenceError extends Error {
  constructor() {
    super("Row has neither a lodging to create nor a lodging to attach to");
    this.name = "MissingLodgingReferenceError";
  }
}

function classifyFailure(err: unknown): LodgingImportRowFailureCode {
  if (err instanceof OwnershipMismatchError) return "ownership_mismatch";
  if (err instanceof MissingLodgingReferenceError)
    return "missing_lodging_reference";
  return "unexpected_error";
}

export interface CommitResult {
  batchId: string;
  createdLodgings: number;
  createdStays: number;
  skipped: number;
  failed: {
    sourceRowIndex: number;
    code: LodgingImportRowFailureCode;
    error: string;
  }[];
}

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === UNIQUE_VIOLATION
  );
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
async function resolveChainId(
  chainName: string | null | undefined,
): Promise<number | null> {
  const name = chainName?.trim();
  if (!name) return null;

  const existing = await prisma.lodgingChain.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.lodgingChain.create({
      data: { name, isUserAdded: true },
    });
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

/** Dedupe key for the FX pre-resolve pass: one lookup per distinct
 *  (currency, check-in calendar day) pair, not one per row. */
function fxOutcomeKey(currency: string, checkInDay: string): string {
  return `${currency}|${checkInDay}`;
}

/**
 * Pre-resolve every distinct (currency, check-in day) FX outcome ONCE,
 * before the row loop runs (finding: `POST /commit` fanned out up to
 * `MAX_LODGING_IMPORT_ROWS` sequential outbound FX calls inside one HTTP
 * request — a real import with 1000 distinct check-in dates meant 1000
 * uncached Frankfurter/ECB calls held open in a single request, exactly the
 * abuse `fxPreviewLimiter` exists to prevent, reintroduced with 1000x
 * per-request amplification). A row whose stay carries no price never
 * reaches `applyFxSnapshot`'s network path at all (it short-circuits on
 * `totalPrice == null`), so those rows are intentionally excluded here and
 * resolved inline (synchronously) at write time instead.
 */
async function resolveFxOutcomes(
  rows: readonly CommitRowInput[],
  baseCurrency: string,
): Promise<Map<string, FxSnapshotOutcome>> {
  const outcomes = new Map<string, FxSnapshotOutcome>();
  for (const row of rows) {
    if (row.action === "skip" || !row.stay || row.stay.totalPrice == null)
      continue;
    // A priced row with no currency has nothing to look up — `applyFxSnapshot`
    // would answer `missingCurrency` anyway, and defaulting to EUR here would
    // burn a real lookup on a guess.
    const currency = row.stay.currency;
    if (!currency) continue;
    const key = fxOutcomeKey(currency, row.stay.checkIn);
    if (outcomes.has(key)) continue;
    // `applyFxSnapshot` documents itself as never throwing — but that
    // guarantee now lives two modules away (`fx/frankfurter.ts`), and this
    // loop runs BEFORE the row loop, after the batch row has already been
    // created. If that guarantee is ever violated, an uncaught throw here
    // would escape `commitLodgingImport` entirely and fail the WHOLE batch
    // with a 500, leaving an orphaned empty `LodgingImportBatch` behind.
    // Contain it locally: one bad pair degrades to `lookupFailed` — the
    // same outcome a null rate already produces — and never costs the batch.
    try {
      const outcome = await applyFxSnapshot(
        {
          totalPrice: row.stay.totalPrice,
          currency,
          checkIn: toDate(row.stay.checkIn),
        },
        baseCurrency,
      );
      outcomes.set(key, outcome);
    } catch (err) {
      logger.warn(
        {
          operation: "lodging_import_fx_lookup_failed",
          currency,
          checkInDay: row.stay.checkIn,
          message: err instanceof Error ? err.message : String(err),
        },
        "FX pre-resolve lookup threw unexpectedly — degrading this pair to lookupFailed",
      );
      outcomes.set(key, { status: "lookupFailed" });
    }
  }
  return outcomes;
}

/** Look up the pre-resolved outcome for one row's stay. A priceless stay
 *  never had a key to begin with — resolve it to `priceRemoved` directly,
 *  matching exactly what `applyFxSnapshot` itself would have returned. */
function fxOutcomeForStay(
  fields: StayCandidateFields,
  outcomes: ReadonlyMap<string, FxSnapshotOutcome>,
): FxSnapshotOutcome {
  if (fields.totalPrice == null) return { status: "priceRemoved" };
  if (!fields.currency) return { status: "missingCurrency" };
  const currency = fields.currency;
  // Absent from the map only if the pre-resolve pass's lookup for this exact
  // pair itself failed — same non-blocking contract as a live failed lookup:
  // never fail the row, just omit the snapshot.
  return (
    outcomes.get(fxOutcomeKey(currency, fields.checkIn)) ?? {
      status: "lookupFailed",
    }
  );
}

async function createStay(
  userId: string,
  batchId: string,
  lodgingId: string,
  fields: StayCandidateFields,
  fxOutcome: FxSnapshotOutcome,
  sourceRowIndex: number,
): Promise<void> {
  const checkIn = toDate(fields.checkIn);

  // An amount whose unit the sheet never carried is not a price. Writing it
  // against the column default ('EUR') would state a currency the source never
  // said — the same invention the LLM parser's `asCurrency` guard refuses one
  // layer up. The stay imports; only the unusable number stays out, and the
  // user can type it in with its currency.
  const priceHasNoCurrency = fields.totalPrice != null && !fields.currency;
  if (priceHasNoCurrency) {
    // The row index is the only handle an operator has back to the
    // spreadsheet — without it the warning names no row. The amount itself
    // stays out of the log; it is the user's money, not diagnostic data.
    logger.warn(
      {
        operation: "lodging_import_price_without_currency",
        sourceRowIndex,
        checkInDay: fields.checkIn,
      },
      "[Lodging Import] Price without a currency — importing the stay without it"
    );
  }

  // A stay with no price simply has no FX snapshot — `resolveFxFields`
  // collapses any non-"snapshotted" outcome to an all-null snapshot. A
  // common real import (stays joined by hotel name, no price column at all)
  // is correct data this way, not an error.
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
      totalPrice: priceHasNoCurrency ? null : (fields.totalPrice ?? null),
      // Omitted, so the NOT-NULL column applies its own 'EUR' default. The
      // stored row is indistinguishable from an explicit EUR either way — the
      // column cannot hold "unknown" — but the accompanying price is null, so
      // nothing is labelled with a currency the source never gave.
      currency: fields.currency ?? undefined,
      ...fx,
      ratingRoom: fields.ratingRoom ?? null,
      ratingBreakfast: fields.ratingBreakfast ?? null,
      ratingService: fields.ratingService ?? null,
      // Derived, exactly as the two stay routes do it — a real sheet scores
      // the parts ("Bew. Zimmer", "Bew. Frühstück") and has no overall column,
      // so taking `fields.ratingOverall` at face value imported every such
      // stay unrated and made each hotel and chain average read "—".
      ratingOverall: deriveStayOverallRating({
        room: fields.ratingRoom ?? null,
        breakfast: fields.ratingBreakfast ?? null,
        service: fields.ratingService ?? null,
        current: fields.ratingOverall ?? null,
      }),
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
  const batch = await prisma.lodgingImportBatch.create({
    data: { userId, source, fileName },
  });
  const baseCurrency = await getBaseCurrency(userId);
  // See `resolveFxOutcomes` — one lookup per distinct (currency, day) pair
  // across the WHOLE batch, resolved before any row is written.
  const fxOutcomes = await resolveFxOutcomes(rows, baseCurrency);

  // Lodgings created by THIS run, so a later row naming the same hotel attaches
  // to it instead of creating a second copy.
  const createdByName = new Map<string, string>();

  let createdLodgings = 0;
  let createdStays = 0;
  let skipped = 0;
  const failed: {
    sourceRowIndex: number;
    code: LodgingImportRowFailureCode;
    error: string;
  }[] = [];

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
          throw new OwnershipMismatchError();
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

      // Preview→commit contract for the payload-name join: a stays-only
      // candidate can match by free-text name against a lodging ANOTHER
      // candidate in this same payload will create (`lodgingImportPreview.ts`'s
      // `payloadNames` branch never sets `matchedLodgingId` for that case,
      // since the lodging doesn't exist yet at preview time). If this row
      // never got a `lodging` object of its own either, its only remaining
      // handle is `lodgingName` — resolve it against the lodgings created
      // earlier in THIS run, same normalization as the `createdByName` keys
      // above. Order-dependent by design (mirrors the same-batch dedupe a
      // few lines up): the creating row must come before this one.
      if (!lodgingId && !row.lodging && row.lodgingName) {
        lodgingId =
          createdByName.get(normalizeLodgingName(row.lodgingName)) ?? null;
      }

      if (!lodgingId) {
        throw new MissingLodgingReferenceError();
      }

      if (row.stay) {
        try {
          const fxOutcome = fxOutcomeForStay(row.stay, fxOutcomes);
          await createStay(userId, batch.id, lodgingId, row.stay, fxOutcome, row.sourceRowIndex);
          createdStays++;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          skipped++;
        }
      }
    } catch (err) {
      // The FULL detail (including any Prisma internals — model name,
      // column, a rendered query snippet) is logged server-side ONLY.
      const detail = err instanceof Error ? err.message : String(err);
      const code = classifyFailure(err);
      logger.warn(
        {
          operation: "lodging_import_row_failed",
          userId,
          sourceRowIndex: row.sourceRowIndex,
          code,
          message: detail,
        },
        "Lodging import row failed — batch continues",
      );
      // The client only ever sees the stable, generic message for `code` —
      // this response is a 201 success body, so the error handler's leak
      // protections never run on it.
      failed.push({
        sourceRowIndex: row.sourceRowIndex,
        code,
        error: FAILURE_MESSAGES[code],
      });
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
