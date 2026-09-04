import { namesCouldBeOneHouse } from "./nameSimilarity";
import { prisma } from "../../db";
import { findNearbyLodgings } from "./proximityMatch";
import logger from "../../utils/logger";
import type {
  LodgingDedupeHint,
  LodgingImportAction,
  LodgingImportCandidate,
  LodgingImportFlag,
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../schemas/lodgingImport";

/** Case/punctuation-insensitive key for name matching. */
export function normalizeLodgingName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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

interface ExistingStay {
  id: string;
  lodgingId: string;
  externalRef: string | null;
  /** Nullable since 2.7 — an undated stay is still a stay a re-import could duplicate. */
  checkIn: Date | null;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface RowVerdict {
  flags: LodgingImportFlag[];
  dedupeHint: LodgingDedupeHint;
  matchedLodgingId: string | null;
  matchedStayId: string | null;
  action: LodgingImportAction;
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

  if (!matchedLodgingId && lodging) {
    const nameKey = normalizeLodgingName(lodging.name);
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
    const hits = idx.byName.get(normalizeLodgingName(joinName)) ?? [];
    if (hits.length === 1) {
      matchedLodgingId = hits[0].id;
    } else if (hits.length > 1) {
      flags = [...flags, "ambiguous_lodging_name"];
    } else if (!idx.payloadNames.has(normalizeLodgingName(joinName))) {
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
      }
    }

    if (!matchedStayId && matchedLodgingId) {
      const existing = idx.staysByLodging.get(matchedLodgingId) ?? [];
      // An undated existing stay has no day to compare, so it can never be the
      // same-day match — it falls through to being treated as a new row rather
      // than silently absorbing an incoming dated one.
      const sameDay = existing.find(
        (s) => s.checkIn !== null && dayKey(s.checkIn) === stay.checkIn,
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
    action = "skip";
  } else if (dedupeHint === "lodging_exact_ref" && !stay) {
    action = "skip";
  } else {
    action = "create";
  }

  return { flags, dedupeHint, matchedLodgingId, matchedStayId, action };
}

const ACTION_RANK: Record<LodgingImportAction, number> = {
  needs_input: 0,
  create: 1,
  skip: 2,
};

export async function buildLodgingPreviewRows(
  userId: string,
  candidates: LodgingImportCandidate[],
): Promise<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }> {
  const [lodgings, stays, chains] = await Promise.all([
    prisma.lodging.findMany({
      where: { userId },
      select: { id: true, name: true, city: true, externalRef: true, lat: true, lon: true },
    }),
    prisma.lodgingStay.findMany({
      where: { userId },
      select: { id: true, lodgingId: true, externalRef: true, checkIn: true },
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
  for (const s of stays) {
    if (s.externalRef) staysByExternalRef.set(s.externalRef, s);
    staysByLodging.set(s.lodgingId, [
      ...(staysByLodging.get(s.lodgingId) ?? []),
      s,
    ]);
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
  };

  logger.info(
    { operation: "lodging_import_preview", userId, ...summary },
    "Lodging import preview built",
  );

  return { rows: sorted, summary };
}
