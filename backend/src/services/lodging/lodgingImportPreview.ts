import { namesCouldBeOneHouse } from "./nameSimilarity";
import { prisma } from "../../db";
import { findNearbyLodgings } from "./proximityMatch";
import logger from "../../utils/logger";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import type {
  LodgingDedupeHint,
  LodgingImportAction,
  LodgingImportCandidate,
  LodgingImportFlag,
  LodgingImportMatchedStay,
  LodgingImportPreviewRow,
  LodgingImportSummary,
  LodgingStayChange,
  StayCandidateFields,
} from "../../schemas/lodgingImport";

/**
 * Case/punctuation-insensitive key for name matching.
 *
 * Letters of EVERY script count. The old `[^a-z0-9]` stripped everything
 * non-Latin, so "桜旅館" and "海の宿" both normalised to "" — and a stays-only
 * row naming the second was silently attached to the first, because one hit
 * on the empty key looked like one identity (AUD-054). NFKC first, so a
 * full-width digit or a ligature compares equal to its plain form.
 */
export function normalizeLodgingName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeCity(city: string | null | undefined): string {
  return city ? normalizeLodgingName(city) : "";
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How close two pins have to be to mean one building. Generous enough that a
 * saved-places pin and a geocoded address agree (they differed by tens of
 * metres in the real data), tight enough not to reach the hotel next door.
 */
const PROXIMITY_METRES = 150;

interface ExistingLodging {
  id: string;
  name: string;
  city: string | null;
  externalRef: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * The stored fields `stayChanges` compares against — "would this re-import
 * change anything?" (forgejo#122). A booking mail that restates the same
 * values is a re-upload and stays a silent skip; one that restates different
 * ones is the mail saying the booking moved.
 *
 * Its own type because the commit path reads exactly these columns and no
 * others: adding a field to `ExistingStay` below must not force a second
 * caller to select data it has no use for.
 */
export interface ComparableStay {
  externalRef: string | null;
  /** Nullable since 2.7 — an undated stay is still a stay a re-import could duplicate. */
  checkIn: Date | null;
  checkOut: Date | null;
  roomCategory: string | null;
  board: string | null;
  guests: number | null;
  totalPrice: number | null;
  pricePerNight: number | null;
  currency: string;
  bookingReference: string | null;
}

interface ExistingStay extends ComparableStay {
  id: string;
  lodgingId: string;
  // Read for the preview HINT, not for the comparison above: the two are what
  // `formatStayPeriod` needs to write a matched stay's period without
  // inventing a range the record does not have.
  datePrecision: string;
  nights: number | null;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface RowVerdict {
  flags: LodgingImportFlag[];
  dedupeHint: LodgingDedupeHint;
  matchedLodgingId: string | null;
  matchedLodgingName: string | null;
  matchedStayId: string | null;
  matchedStay: LodgingImportMatchedStay | null;
  action: LodgingImportAction;
  /** Non-empty only when the action is `update` — see `stayChanges`. */
  changes: LodgingStayChange[];
}

interface Indexes {
  byExternalRef: Map<string, ExistingLodging>;
  byNameCity: Map<string, ExistingLodging[]>;
  byName: Map<string, ExistingLodging[]>;
  payloadNames: Set<string>;
  /** Every stored lodging, for the coordinate fallback — a name can be decorated, a building cannot move. */
  allLodgings: ExistingLodging[];
  /** Catalogue chain names, lowercased. A name that is not in here is offered, never created silently. */
  chainNames: Set<string>;
  staysByExternalRef: Map<string, ExistingStay>;
  staysByLodging: Map<string, ExistingStay[]>;
  /** By id, so a verdict can describe the stay it matched instead of only naming its id. */
  staysById: Map<string, ExistingStay>;
}

/**
 * What a re-import of a PROVEN-identical stay would change.
 *
 * The rule that makes this safe is the one `stayPatchMerge.ts` states for a
 * PATCH: a value the source does not carry is not a value. A parsed mail sets
 * every field it did not find to `null`, so treating null as "clear this"
 * would let a sparse confirmation wipe a price the user typed in. Only a
 * field the incoming row actually carries can count as changed.
 *
 * Dates are compared as calendar days: the stored column is a UTC midnight and
 * the incoming value an ISO day, so `Date` equality would report a change on
 * every re-upload.
 *
 * Returns [] when nothing moved — which is the ordinary re-upload, and stays a
 * silent skip.
 */
export function stayChanges(
  incoming: StayCandidateFields,
  stored: ComparableStay
): LodgingStayChange[] {
  const changes: LodgingStayChange[] = [];
  const day = (d: Date | null): string | null => (d ? dayKey(d) : null);

  const text = (
    field: Extract<
      LodgingStayChange["field"],
      "roomCategory" | "board" | "currency" | "bookingReference"
    >,
    to: string | null | undefined,
    from: string | null
  ): void => {
    if (to == null || to === "") return;
    if (to !== from) changes.push({ field, from, to });
  };
  const number = (
    field: Extract<LodgingStayChange["field"], "guests" | "totalPrice" | "pricePerNight">,
    to: number | null | undefined,
    from: number | null
  ): void => {
    if (to == null) return;
    // Money is stored as a float; comparing 451.7 to 451.70000000000005 as a
    // change would offer an update that changes nothing.
    if (from == null || Math.abs(to - from) > 0.005) changes.push({ field, from, to });
  };

  if (incoming.checkIn && incoming.checkIn !== day(stored.checkIn)) {
    changes.push({ field: "checkIn", from: day(stored.checkIn), to: incoming.checkIn });
  }
  if (incoming.checkOut && incoming.checkOut !== day(stored.checkOut)) {
    changes.push({ field: "checkOut", from: day(stored.checkOut), to: incoming.checkOut });
  }
  text("roomCategory", incoming.roomCategory, stored.roomCategory);
  text("board", incoming.board, stored.board);
  number("guests", incoming.guests, stored.guests);
  // An amount whose unit the mail never stated is not a price — the same
  // guard `createStay` applies, and it matters MORE here: writing the new
  // number against the stored currency would relabel an unknown-currency
  // amount as euros because a previous mail happened to say euros. A price
  // the mail restates without its unit is therefore no change at all.
  if (incoming.currency) {
    number("totalPrice", incoming.totalPrice, stored.totalPrice);
    number("pricePerNight", incoming.pricePerNight, stored.pricePerNight);
    if (incoming.totalPrice != null || incoming.pricePerNight != null) {
      text("currency", incoming.currency, stored.currency);
    }
  }
  text("bookingReference", incoming.bookingReference, stored.bookingReference);
  return changes;
}

/**
 * How a matched stay is described to the reader.
 *
 * The dates go out as ISO days with their precision, never pre-formatted: the
 * user's date format and language live on the client, and `formatStayPeriod`
 * there is the one place that decides how a stay's period is written. `nights`
 * abstains (null) where the record cannot say — `resolveStayTiming` keeps that
 * apart from a genuine 0 (a same-day stay), and a "0 Nächte" in a hint the
 * user is asked to judge would be a measurement nobody took.
 *
 * `href` is the LODGING's page. A stay has no page of its own; the same
 * contract `stayEvidenceEntry` states, for the same reason.
 */
function describeStay(stay: ExistingStay): LodgingImportMatchedStay {
  const timing = resolveStayTiming(stay);
  return {
    checkIn: stay.checkIn ? dayKey(stay.checkIn) : null,
    checkOut: stay.checkOut ? dayKey(stay.checkOut) : null,
    // The RESOLVED precision, not the raw column: a row whose dates were
    // cleared without its precision being updated still says "DAY", and the
    // wire must not carry a claim the dates contradict.
    datePrecision: timing.precision,
    nights: timing.nightsKnown ? timing.nights : null,
    href: `/lodging/${stay.lodgingId}`,
  };
}

/**
 * Classify one candidate. The rules, in the order they bind:
 *
 * 1. `externalRef` is a PROVEN identity — an exact hit is a safe, silent skip.
 *    That is what makes re-importing the same file or e-mail a no-op instead of
 *    creating duplicates.
 * 2. A name+city hit is a GUESS. It is surfaced for confirmation
 *    (`needs_input`), never skipped behind the user's back.
 * 3. A stays-only row that resolves to no lodging is `needs_input` — never an
 *    orphan stay.
 * 4. Missing coordinates is informational ONLY. The row commits; it just has no
 *    map pin. Geocoding happens in the background afterwards, not on commit.
 */
function classify(candidate: LodgingImportCandidate, idx: Indexes): RowVerdict {
  let flags: LodgingImportFlag[] = [];
  let dedupeHint: LodgingDedupeHint = "none";
  let matchedLodgingId: string | null = null;
  let matchedStayId: string | null = null;
  let changes: LodgingStayChange[] = [];

  const lodging = candidate.lodging;
  const joinName = candidate.lodgingName ?? lodging?.name ?? null;

  if (!lodging && !joinName) flags = [...flags, "missing_name"];

  if (lodging?.externalRef) {
    const hit = idx.byExternalRef.get(lodging.externalRef);
    if (hit) {
      dedupeHint = "lodging_exact_ref";
      matchedLodgingId = hit.id;
    }
  }

  // A name that normalises to nothing identifies nothing. Matching on it
  // would make every such house "the same one" (AUD-054).
  const nameKey = lodging ? normalizeLodgingName(lodging.name) : "";
  if (!matchedLodgingId && lodging && nameKey) {
    const cityKey = normalizeCity(lodging.city);
    // A row that carries a city is matched on name AND city — two "Hotel Post"
    // in different towns are different houses. A row that carries NO city can
    // only be matched on the name: comparing its empty city against a stored
    // one can never succeed, so the strict key silently made every such row a
    // new hotel. That is how a saved-places export (name and a map link,
    // nothing else) re-created 38 houses the account already had.
    const hits = cityKey
      ? (idx.byNameCity.get(`${nameKey}|${cityKey}`) ?? [])
      : (idx.byName.get(nameKey) ?? []);
    if (hits.length === 1) {
      dedupeHint = "lodging_name_city";
      matchedLodgingId = hits[0].id;
    } else if (hits.length > 1) {
      dedupeHint = "lodging_name_city";
      flags = [...flags, "ambiguous_lodging_name"];
    }
  }

  // The same house under a decorated name. The exact key above reads "Hotel
  // Meteora" and "Hotel Restaurant Meteora" as two buildings, and the
  // coordinate rule below never fires for a booking mail or a saved-places
  // export — neither carries a pin at preview time — so five pairs on the
  // owner's account became ten houses (forgejo#84). nameSimilarity.ts was
  // written for exactly this and had no caller. A hit is a GUESS: surfaced
  // for confirmation, never a silent merge.
  if (!matchedLodgingId && lodging) {
    const cityKey = normalizeCity(lodging.city);
    const similar = idx.allLodgings.filter((stored) => {
      const storedCity = normalizeCity(stored.city);
      const sameCity = cityKey && storedCity ? cityKey === storedCity : null;
      return namesCouldBeOneHouse(lodging.name, stored.name, sameCity);
    });
    if (similar.length === 1) {
      dedupeHint = "lodging_name_similar";
      matchedLodgingId = similar[0].id;
    } else if (similar.length > 1) {
      dedupeHint = "lodging_name_similar";
      flags = [...flags, "ambiguous_lodging_name"];
    }
  }

  // Last resort before declaring a new house: the same SPOT. The matcher above
  // keys on the name, so "Hotel Fortuna" and "Hotel - Restaurant Fortuna" read
  // as two buildings — measured on a real library, 25 pairs among 293 houses,
  // 24 of them sharing a coordinate. A hit here is a GUESS like name+city, so
  // it is surfaced for confirmation and never skipped silently: two hotels can
  // genuinely share an address, and folding those together loses a house.
  if (!matchedLodgingId && lodging) {
    const nearby = findNearbyLodgings(idx.allLodgings, lodging.lat, lodging.lon, PROXIMITY_METRES);
    if (nearby.length === 1) {
      dedupeHint = "lodging_nearby";
      matchedLodgingId = nearby[0].id;
    } else if (nearby.length > 1) {
      dedupeHint = "lodging_nearby";
      flags = [...flags, "ambiguous_lodging_name"];
    }
  }

  // A chain the catalogue does not know is an OFFER, never a silent create:
  // the commit used to add any unknown name, which fills the catalogue with
  // whatever a parser took for a chain. Measured on real confirmations, the
  // parser now recognises groups the catalogue has never heard of — "KOA"
  // among them — and each of those deserves one decision, not an entry.
  if (lodging?.chainName && !idx.chainNames.has(lodging.chainName.trim().toLowerCase())) {
    flags = [...flags, "unknown_chain"];
  }

  if (!lodging && joinName) {
    const joinKey = normalizeLodgingName(joinName);
    const hits = joinKey ? (idx.byName.get(joinKey) ?? []) : [];
    if (hits.length === 1) {
      matchedLodgingId = hits[0].id;
    } else if (hits.length > 1) {
      flags = [...flags, "ambiguous_lodging_name"];
    } else if (!joinKey || !idx.payloadNames.has(joinKey)) {
      // Neither in the DB nor created by an earlier row of this same import.
      flags = [...flags, "unresolvable_lodging_name"];
    }
  }

  if (lodging && (lodging.lat == null || lodging.lon == null)) {
    flags = [...flags, "missing_coordinates"];
  }

  const stay = candidate.stay;
  if (stay) {
    if (!ISO_DAY_RE.test(stay.checkIn) || !ISO_DAY_RE.test(stay.checkOut)) {
      flags = [...flags, "malformed_date"];
    } else if (Date.parse(stay.checkOut) < Date.parse(stay.checkIn)) {
      flags = [...flags, "invalid_date_range"];
    }

    if (stay.externalRef) {
      const hit = idx.staysByExternalRef.get(stay.externalRef);
      if (hit) {
        // A proven exact stay-ref hit outranks any earlier heuristic guess
        // (name+city or stays-only by-name join) — it always wins.
        dedupeHint = "stay_exact_ref";
        matchedStayId = hit.id;
        matchedLodgingId = hit.lodgingId;
        // ...but "the same booking" is not "the same values". A changed
        // booking carries the same reference and different dates, and it was
        // skipped in silence until 2026-09-17 (forgejo#122).
        changes = stayChanges(stay, hit);
      }
    }

    if (!matchedStayId && matchedLodgingId) {
      const existing = idx.staysByLodging.get(matchedLodgingId) ?? [];
      // An undated existing stay has no day to compare, so it can never be the
      // same-day match — it falls through to being treated as a new row rather
      // than silently absorbing an incoming dated one.
      const sameDay = existing.find(
        (s) => s.checkIn !== null && dayKey(s.checkIn) === stay.checkIn
      );
      if (sameDay) {
        dedupeHint = "stay_same_dates";
        matchedStayId = sameDay.id;
      }
    }
  }

  // `missing_coordinates` never blocks — a pin-less lodging is valid data.
  const blocking = flags.filter((f) => f !== "missing_coordinates");
  let action: LodgingImportAction;
  if (blocking.length > 0) {
    action = "needs_input";
  } else if (
    dedupeHint === "lodging_name_city" ||
    dedupeHint === "lodging_name_similar" ||
    dedupeHint === "lodging_nearby" ||
    dedupeHint === "stay_same_dates"
  ) {
    action = "needs_input";
  } else if (dedupeHint === "stay_exact_ref") {
    // Proven identity: a re-upload is a skip, a changed booking is an offer.
    // Never a silent write — the fields are the user's data, and an import
    // that quietly moved a stay's dates would be indistinguishable from a
    // parser mistake.
    action = changes.length > 0 ? "update" : "skip";
  } else if (dedupeHint === "lodging_exact_ref" && !stay) {
    action = "skip";
  } else {
    action = "create";
  }

  // The name of the house a match points at, so the user can judge the
  // guess against something (AUD-056). Looked up rather than carried along
  // from each branch above: a stay-ref hit knows only the lodging's id.
  const matchedLodgingName = matchedLodgingId
    ? (idx.allLodgings.find((l) => l.id === matchedLodgingId)?.name ?? null)
    : null;

  // The stay the match points at, described rather than merely identified —
  // the hint could otherwise only say "vorhanden", never which one.
  const matchedStay = matchedStayId ? (idx.staysById.get(matchedStayId) ?? null) : null;

  return {
    flags,
    dedupeHint,
    matchedLodgingId,
    matchedLodgingName,
    matchedStayId,
    matchedStay: matchedStay ? describeStay(matchedStay) : null,
    action,
    changes,
  };
}

// Questionable first, settled last. An `update` sits between: it is a
// decision to take, but a smaller one than a row that cannot be placed at all.
const ACTION_RANK: Record<LodgingImportAction, number> = {
  needs_input: 0,
  update: 1,
  create: 2,
  skip: 3,
};

export async function buildLodgingPreviewRows(
  userId: string,
  candidates: LodgingImportCandidate[]
): Promise<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }> {
  const [lodgings, stays, chains] = await Promise.all([
    prisma.lodging.findMany({
      where: { userId },
      select: { id: true, name: true, city: true, externalRef: true, lat: true, lon: true },
    }),
    prisma.lodgingStay.findMany({
      where: { userId },
      select: {
        id: true,
        lodgingId: true,
        externalRef: true,
        checkIn: true,
        checkOut: true,
        datePrecision: true,
        nights: true,
        roomCategory: true,
        board: true,
        guests: true,
        totalPrice: true,
        pricePerNight: true,
        currency: true,
        bookingReference: true,
      },
    }),
    prisma.lodgingChain.findMany({ select: { name: true } }),
  ]);

  const byExternalRef = new Map<string, ExistingLodging>();
  const byNameCity = new Map<string, ExistingLodging[]>();
  const byName = new Map<string, ExistingLodging[]>();
  for (const l of lodgings) {
    if (l.externalRef) byExternalRef.set(l.externalRef, l);
    const nameKey = normalizeLodgingName(l.name);
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), l]);
    const cityKey = `${nameKey}|${normalizeCity(l.city)}`;
    byNameCity.set(cityKey, [...(byNameCity.get(cityKey) ?? []), l]);
  }

  const staysByExternalRef = new Map<string, ExistingStay>();
  const staysByLodging = new Map<string, ExistingStay[]>();
  const staysById = new Map<string, ExistingStay>();
  for (const s of stays) {
    if (s.externalRef) staysByExternalRef.set(s.externalRef, s);
    staysByLodging.set(s.lodgingId, [...(staysByLodging.get(s.lodgingId) ?? []), s]);
    staysById.set(s.id, s);
  }

  // Lodgings THIS payload will create — a stays-only row may legitimately point
  // at one of them (the "both" CSV shape).
  const payloadNames = new Set<string>();
  for (const c of candidates) {
    if (c.lodging) payloadNames.add(normalizeLodgingName(c.lodging.name));
  }

  const idx: Indexes = {
    byExternalRef,
    byNameCity,
    byName,
    payloadNames,
    allLodgings: lodgings,
    chainNames: new Set(chains.map((c) => c.name.trim().toLowerCase())),
    staysByExternalRef,
    staysByLodging,
    staysById,
  };

  const rows: LodgingImportPreviewRow[] = candidates.map((candidate) => ({
    ...candidate,
    ...classify(candidate, idx),
  }));

  // Questionable rows first (spec §3.1), stable within each group so the user
  // can still follow the source file's order.
  const sorted = [...rows].sort((a, b) => {
    const rank = ACTION_RANK[a.action] - ACTION_RANK[b.action];
    return rank !== 0 ? rank : a.sourceRowIndex - b.sourceRowIndex;
  });

  const summary: LodgingImportSummary = {
    newRows: sorted.filter((r) => r.action === "create").length,
    alreadyPresent: sorted.filter((r) => r.action === "skip").length,
    needsInput: sorted.filter((r) => r.action === "needs_input").length,
    changedRows: sorted.filter((r) => r.action === "update").length,
  };

  logger.info(
    { operation: "lodging_import_preview", userId, ...summary },
    "Lodging import preview built"
  );

  return { rows: sorted, summary };
}
