/**
 * What proves you were in a country — one rule, one home.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md`.
 * Written after the owner looked at his own figures and said the count was too
 * high. It was too high AND too low at once, which is why it looked plausible:
 * a four-hour connection counted, while a country reached by car and slept in
 * for a week did not count at all.
 *
 * ## Why tiers and not an hour threshold
 *
 * We cannot know whether somebody left the airport. Six hours in Doha with a
 * trip into the city and six hours airside are the same rows. Any duration cut
 * is a proxy for a fact we do not hold — and measured on real data, **six hours
 * and twelve hours return the same set of countries**, because nobody sits
 * between them. A configurable number would promise precision the data lacks and
 * invite turning a dial until the total feels right.
 *
 * What IS in the data is structure: the local calendar day either changed or it
 * did not. So the tiers are derived, never configured, and the only setting is
 * which tier the headline counts from.
 *
 * ## The tiers, strongest first
 *
 * - `slept`   — a completed lodging stay; a lodging with NO stay at all; a
 *               flight arrival and departure on different local calendar days;
 *               a port call spanning a night.
 * - `visited` — arrival and departure the same local day; a recorded place; a
 *               same-day port call.
 * - `transit` — a connection and nothing else.
 *
 * Strongest wins, so a country both flown through and slept in reports `slept`
 * once, never twice. This mirrors `passport.ts` rule 5, which the tiers replace
 * rather than sit beside.
 *
 * ## Two figures stand BESIDE the tier, and never decide it
 *
 * Spec §3.4b: a duration is shown as evidence, it is never a threshold. The tier
 * still comes from structure — did the local day change, does a record exist —
 * while `daysPresent` and `groundTime` let a reader judge the tier rather than
 * take it on trust, which is the same obligation §3.4 puts on the records.
 *
 * `groundTime` has THREE states because two would lie: a country proved only by
 * a hotel has an *unknown* ground time, not a zero one. See `CountryGroundTime`.
 *
 * ## Two rules that look alike and are not
 *
 * 1. **A lodging with no stay counts as one night** (owner's decision,
 *    2026-09-02): somebody took the trouble to enter the house, so they were
 *    there — they simply no longer remember when. The price is that data quality
 *    now decides the count, which is why every country carries its evidence and
 *    the UI must show it.
 * 2. **A stay whose check-out is still in the future does NOT count.** That is a
 *    booking, not a visit — the rule `shared/lodgingCounting.ts` already states.
 *    Decision 1 is about the ABSENCE of a stay; it does not override a stay that
 *    says "not yet".
 * 3. **A house whose stays were ALL cancelled does NOT count.** It looks like
 *    decision 1 from the query's side — filter the cancellations away and what
 *    arrives is a house with no stay — and it is its opposite. An absent stay is
 *    a forgotten date; a cancelled stay is the record saying the visit did not
 *    happen. Reading them alike would mean that cancelling a booking PROVES a
 *    country.
 *
 * ## Joins on codes, never on names
 *
 * Everything here keys on ISO 3166-1 alpha-2. The achievements used to union
 * airport codes (`DE`) with the free-text `country` column (`Deutschland`,
 * `Germany`) and reported 88 countries where the passport reported 32. The text
 * column keeps whatever the source wrote; anything that counts joins on the code.
 *
 * Resolving takes BOTH resolvers because neither contains the other, and using
 * one alone loses countries rather than merging them:
 *
 * - `resolveCountryCode` (`shared/geo/countryCode.ts`) reads a name in ANY
 *   language via `Intl.DisplayNames` — the free-text `country` column holds
 *   `Deutschland`, `Österreich`, `Česko`, `Schweiz/Suisse/Svizzera/Svizra`, and
 *   the English-only table below resolves none of them. It is also what writes
 *   `Lodging.isoCountryCode`, so this joins on the same vocabulary.
 * - `isoCountryCode` (`utils/continents.ts`) knows the catalogue spellings
 *   `Intl` does not — `DR Congo`, `US Virgin Islands`, `Kosovo`, `Palestine`,
 *   `Macau`, `South Georgia` — and rejects the placeholder codes `ZZ` / `XZ`,
 *   which must never become a country here either.
 */

import { resolveCountryCode } from "./geo/countryCode";
import { classifyStay, type CountableStay } from "./lodgingCounting";
import { isoCountryCode } from "../utils/continents";

/**
 * The stay columns this module reads — `shared/lodgingCounting.ts`'s own shape,
 * imported rather than redeclared so the two cannot drift on what a stay is.
 */
export type { CountableStay };

/** The airport/port catalogues' "unknown country" codes. Never a country. */
const PLACEHOLDER_CODES: ReadonlySet<string> = new Set(["ZZ", "XZ"]);

/**
 * Free text or a bare code -> ISO 3166-1 alpha-2, or null when it cannot be known.
 *
 * Exported because a consumer that resolves country text ITS OWN way will
 * disagree with the count, and disagree invisibly. That already happened here:
 * `countryDetail.ts` resolved a port call with the English-only `isoCountryCode`
 * alone while this module used both resolvers, so a port catalogued as
 * "Deutschland" raised a country row whose drill-down could not name the record
 * that raised it — a row asserting evidence the panel behind it denied. Anything
 * that joins a country to a code calls THIS.
 */
export function toCountryCode(country: string | null): string | null {
  const code = resolveCountryCode(country) ?? isoCountryCode(country);
  return code && !PLACEHOLDER_CODES.has(code) ? code : null;
}

/** Strongest first. The order IS the ranking — do not reorder to taste. */
export const COUNTRY_TIERS = ["slept", "visited", "transit"] as const;
export type CountryTier = (typeof COUNTRY_TIERS)[number];

const RANK: Record<CountryTier, number> = { slept: 3, visited: 2, transit: 1 };

/**
 * The tier the headline counts from when nobody has chosen one — a connection
 * does not count, everything else does.
 *
 * Lives here rather than beside the setting because the setting stores a value
 * from THIS vocabulary and nothing else. §2 refuses an hours-based option on
 * principle (six hours and twelve hours returned the same set of countries on
 * real data), so there are exactly three values and this is one of them.
 */
export const DEFAULT_COUNTRY_TIER: CountryTier = "visited";

/**
 * A stored or submitted value read back as a tier, or null when it is not one.
 *
 * The columns behind the setting are plain TEXT — `CountryTier` owns the closed
 * set in TypeScript and a duplicate DB enum would be a second place for it to
 * drift. That makes this the boundary guard: a row written by an older build, a
 * hand-edited database, or a value from a vocabulary that no longer exists
 * (`transit` is renamed `connection` in spec §3.4c) must fall back to the
 * default rather than filter the headline against a rank that does not exist —
 * which would silently count zero countries.
 */
export function parseCountryTier(value: unknown): CountryTier | null {
  return typeof value === "string" && (COUNTRY_TIERS as readonly string[]).includes(value)
    ? (value as CountryTier)
    : null;
}

/** What kind of record proved the country. Kept beside the tier because a tier
 *  alone cannot answer "why is Romania in my passport". */
export type EvidenceKind = "flight" | "lodging" | "port" | "place";

/**
 * How long the traveller was on the ground in a country — spec §3.4b.
 *
 * THREE states, not two, and the third is the whole point. Czechia, Italy and
 * Slovenia are proved only by hotels: their ground time is not small, it is
 * *unknown*, and writing `0 h` there would be a fabrication that drags every
 * average down — the defect `shared/flightDuration.ts` was written to end.
 *
 * - `measured`      — a flight pair bounds a spell on the ground AND that spell
 *                     spans at most one night (see `measuredGroundMinutes`).
 *                     `minutes` is the LONGEST such spell, published raw: §3.4b
 *                     decided against buckets because the owner's connection
 *                     countries run 1.4 h–4.7 h and the next is 25 h, so fixed
 *                     bins would sit permanently empty and hide the gap, which
 *                     IS the finding.
 * - `unknown`       — a flight touched this country, but no pair of clocks
 *                     bounds a spell. A one-way arrival, a DATE_ONLY row whose
 *                     stored time is a placeholder, a legacy row whose airport
 *                     has no timezone — and, since 2026-09-02, a gap spanning
 *                     more than one night, which measures the absence of a
 *                     recorded departure rather than a stay. The value exists;
 *                     we cannot read it.
 * - `notApplicable` — no flight touched this country at all. A ground time is
 *                     not merely unmeasured here, it is not a thing this
 *                     evidence could ever carry: a house, a port call and a
 *                     recorded place bound no departure. Never synthesise one.
 *
 * The two lower states are kept apart because they ask the reader for different
 * things. `unknown` says "your flight data is thin here, and adding the return
 * leg would answer it". `notApplicable` says "there is nothing to add".
 */
export type CountryGroundTime =
  | { state: "measured"; minutes: number }
  | { state: "unknown" }
  | { state: "notApplicable" };

export interface CountryEvidence {
  /** ISO 3166-1 alpha-2. */
  code: string;
  tier: CountryTier;
  /** Every kind that contributed, sorted by NAME — the tier is the row's, not
   *  the kind's, so there is no "strongest kind" to sort by. Alphabetical keeps
   *  the order independent of the order rows arrived in. */
  kinds: EvidenceKind[];
  /** Earliest dated evidence, ISO day. Null when nothing carried a date. */
  firstDate: string | null;
  lastDate: string | null;
  /** True when at least one piece of evidence carried no date at all — an
   *  undated house, a place ticked without a day. The UI needs this to explain
   *  a country that cannot appear in any year's figures. */
  hasUndatedEvidence: boolean;
  /**
   * How many DISTINCT calendar days any record places the traveller here —
   * spec §3.4b, and the reason the design prefers days to hours: a day exists
   * for a house, a port call and a flight pair alike, while an hour exists only
   * for a flight pair.
   *
   * A plain count, never null: zero is derived, not abstained. It means every
   * piece of evidence was undated, which `hasUndatedEvidence` says in words —
   * the pair together is what tells a reader "Romania is here because of one
   * house nobody could date" rather than leaving them to guess.
   */
  daysPresent: number;
  /** See `CountryGroundTime`. Never zero for want of a measurement. */
  groundTime: CountryGroundTime;
}

/** One country touch, already reduced to what the rule cares about. */
export interface EvidenceInput {
  /** Free text or a code — resolved here, never trusted raw. */
  country: string | null;
  kind: EvidenceKind;
  tier: CountryTier;
  /** When it happened, if known. */
  at?: Date | null;
  /**
   * The calendar days this one record places the traveller in the country,
   * `YYYY-MM-DD`. Absent means "the day of `at`, if it has one" — which is what
   * a place visit is.
   *
   * These are the days the record ATTESTS, never the days it merely fails to
   * contradict. A stay hands over its whole span (`daysBetween`); a spell
   * between two flights hands over its two ends alone (`attestedGroundDays`).
   *
   * Given by the CALLER rather than derived from `at` here, because which clock
   * a day is read on differs by kind and only the caller knows: a flight's day
   * is the DEPARTURE airport's local day (a red-eye read in UTC lands on a day
   * the traveller never flew), while a port call and a stay carry no timezone
   * at all and are read as stored. Deriving one rule for all of them here would
   * quietly move a country into the wrong day.
   */
  days?: readonly string[];
  /**
   * Minutes on the ground this record measured, when it measured any.
   *
   * ONLY a flight pair may set this, and only through `measuredGroundMinutes` —
   * a raw interval is not a measurement once it spans more than a night. A
   * house, a port call and a place bound no departure, so they leave it absent
   * and the country reports `notApplicable` rather than a synthesised zero.
   */
  groundMinutes?: number | null;
}

const isoDay = (at: Date | null | undefined): string | null =>
  at ? at.toISOString().slice(0, 10) : null;

const MS_PER_DAY = 86_400_000;

/**
 * A span longer than this is not a long stay, it is a record contradicting
 * itself — a mis-parsed year, a check-out typed as 2033. Ten years is far past
 * anything a booking describes and far short of what would make the expansion
 * below expensive.
 */
const MAX_SPAN_DAYS = 3660;

/**
 * Every ISO day from `from` to `to` inclusive — the ONE expansion, so a stay, a
 * port call and a spell between two flights all count their days the same way.
 *
 * Two abstentions rather than a plausible number:
 *
 * - `to` before `from` yields only `from`. That is the check-out-precedes-
 *   check-in case §3.5 sends to the inbox; counting backwards would turn a typo
 *   into a negative span, and inventing the intervening days would turn it into
 *   evidence.
 * - a span past `MAX_SPAN_DAYS` yields only its two ends. A record claiming a
 *   decade of continuous presence has not measured 3661 days present; it is
 *   broken, and reporting the two days it actually names is the honest floor.
 */
export function daysBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  if (end < start) return [from];

  const span = Math.round((end - start) / MS_PER_DAY);
  if (span > MAX_SPAN_DAYS) return [from, to];

  const out: string[] = [];
  for (let i = 0; i <= span; i += 1) {
    out.push(new Date(start + i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Fold every touch into one row per country, keeping the strongest tier.
 *
 * A touch whose country cannot be resolved to a code contributes NOTHING rather
 * than a guess — the same cut `shared/placeCounting.ts` makes, and for the same
 * reason: a country nobody can check by looking is worse than a missing one.
 */
export function foldCountryEvidence(inputs: readonly EvidenceInput[]): CountryEvidence[] {
  const byCode = new Map<string, CountryEvidence>();
  /**
   * The two figures that cannot be folded in place: days are a UNION (the same
   * day proved twice is one day) and the ground time is a MAXIMUM whose absence
   * has to stay distinguishable from a zero. Kept beside the rows rather than
   * on them so `CountryEvidence` publishes only finished answers.
   */
  const measured = new Map<string, { days: Set<string>; groundMinutes: number | null }>();

  for (const input of inputs) {
    const code = toCountryCode(input.country);
    if (!code) continue;

    const day = isoDay(input.at);
    const existing = byCode.get(code);

    const acc = measured.get(code) ?? { days: new Set<string>(), groundMinutes: null };
    measured.set(code, acc);
    // Absent `days` means "the day of `at`" — a place visit, which happens on
    // exactly one day and has no span to read.
    for (const d of input.days ?? (day === null ? [] : [day])) acc.days.add(d);
    if (typeof input.groundMinutes === "number") {
      acc.groundMinutes =
        acc.groundMinutes === null
          ? input.groundMinutes
          : Math.max(acc.groundMinutes, input.groundMinutes);
    }

    if (!existing) {
      byCode.set(code, {
        code,
        tier: input.tier,
        kinds: [input.kind],
        firstDate: day,
        lastDate: day,
        hasUndatedEvidence: day === null,
        // Filled below, once every input has been seen.
        daysPresent: 0,
        groundTime: { state: "notApplicable" },
      });
      continue;
    }

    if (RANK[input.tier] > RANK[existing.tier]) existing.tier = input.tier;
    if (!existing.kinds.includes(input.kind)) existing.kinds.push(input.kind);
    if (day !== null) {
      existing.firstDate =
        existing.firstDate === null || day < existing.firstDate ? day : existing.firstDate;
      existing.lastDate =
        existing.lastDate === null || day > existing.lastDate ? day : existing.lastDate;
    } else {
      existing.hasUndatedEvidence = true;
    }
  }

  for (const entry of byCode.values()) {
    entry.kinds.sort();

    const acc = measured.get(entry.code);
    entry.daysPresent = acc?.days.size ?? 0;
    /**
     * The three states of §3.4b, decided here and nowhere else.
     *
     * `notApplicable` is read off the KINDS rather than off the absence of a
     * number: only a flight pair can bound a spell on the ground, so a country
     * no flight ever touched cannot have one — that is a different fact from a
     * flight country whose clocks could not be read, and collapsing the two
     * would tell a hotel-only country to go and fix its flight data.
     */
    if (!entry.kinds.includes("flight")) {
      entry.groundTime = { state: "notApplicable" };
    } else if (acc && acc.groundMinutes !== null) {
      entry.groundTime = { state: "measured", minutes: acc.groundMinutes };
    } else {
      entry.groundTime = { state: "unknown" };
    }
  }

  return [...byCode.values()].sort(
    (a, b) => RANK[b.tier] - RANK[a.tier] || a.code.localeCompare(b.code)
  );
}

/**
 * The headline count, from a threshold tier.
 *
 * `from: "visited"` is the default the design proposes: a connection does not
 * count, everything else does.
 */
export function countCountries(
  evidence: readonly CountryEvidence[],
  from: CountryTier = "visited"
): number {
  return evidence.filter((e) => RANK[e.tier] >= RANK[from]).length;
}

/**
 * Does a lodging count, and at which tier?
 *
 * Returns null when it does not count at all. The decisions of 2026-09-02 live
 * here and nowhere else:
 *
 * - no stays at all → counts, `slept`, undated
 * - a stay already checked out → counts, `slept`, dated
 * - only stays still to come → does NOT count; that is a booking
 * - only CANCELLED stays → does NOT count; that is a visit that did not happen
 *
 * ## Why the cancellation cut lives here and not in the caller
 *
 * Filtering cancelled stays out of the query would be silently wrong: a house
 * whose only stay was filtered away arrives here as a house with NO stay, and a
 * house with no stay counts as one night (decision 1.4). Cancelling a booking
 * would then PROVE a country — the exact opposite of what a cancellation says.
 * So the module needs the status, and the caller hands the stays over unfiltered.
 *
 * ## Where this and `shared/lodgingCounting.ts` disagree — deliberately, and it
 * is a question for that module's owner, not one settled here
 *
 * `classifyStay` is asked for the cancellation verdict rather than reading the
 * status column, because "does this stay count" has exactly one home and a
 * cancellation is the one lodging status that is a user STATEMENT rather than a
 * cache of the dates (`LODGING_PASSTHROUGH` in shared/statusDerivation.ts).
 *
 * `classifyLodging` in that same module, however, answers `visited` for a house
 * whose only stay was cancelled: its last line reads "no stay to judge by — the
 * user's own claim stands", and a list of nothing but `excluded` states falls
 * through to it. This module answers null instead. The two are asking different
 * questions — "is this house a visited house" against "does this house prove a
 * country" — but the fall-through looks like an oversight there too, and it
 * belongs to `lodgingCounting.ts` to decide. It is NOT re-decided here.
 */
export interface LodgingEvidence {
  tier: CountryTier;
  /**
   * The EARLIEST past check-out, which is what dates the country. Unchanged by
   * the days below on purpose: it feeds `firstYear`, and moving it would move a
   * number that is right today.
   */
  at: Date | null;
  /**
   * Every calendar day the house's completed stays place the traveller here —
   * check-in through check-out inclusive, unioned across the stays, `YYYY-MM-DD`.
   *
   * DAYS, not nights: a stay from the 1st to the 4th is three nights and four
   * days present, and this answers the second question. Empty for the two
   * dateless cases below, which is the honest count — an undated house proves a
   * country without proving a single day of it.
   */
  days: string[];
}

/** The days a completed stay covers. A stay with no check-in names only the day
 *  it ended: that is what the record says, and stretching it back would invent
 *  nights nobody recorded. */
function stayDays(stay: CountableStay, now: Date): string[] {
  const out = isoDay(stay.checkOut);
  if (out === null || (stay.checkOut as Date).getTime() > now.getTime()) return [];
  return daysBetween(isoDay(stay.checkIn) ?? out, out);
}

export function lodgingEvidence(
  stays: readonly CountableStay[],
  now: Date = new Date()
): LodgingEvidence | null {
  if (stays.length === 0) return { tier: "slept", at: null, days: [] };

  /**
   * `excluded` is reachable only through a stored "cancelled" — every other
   * status derives from the dates. So this drops cancellations and nothing else,
   * and in particular it does NOT drop the dateless stay below: an undated stay
   * classifies from its stored status, which defaults to "completed".
   */
  const recorded = stays.filter((s) => classifyStay(s, now) !== "excluded");

  /**
   * Every stay was cancelled. This is NOT the empty case above and must never
   * be folded into it. An ABSENT stay is a forgotten date — the user was there
   * and no longer remembers when (decision 1.4). A CANCELLED stay is the record
   * positively saying the visit did not happen, and a house that exists only
   * because a booking was entered and then called off proves nothing at all.
   */
  if (recorded.length === 0) return null;

  const days = [...new Set(recorded.flatMap((s) => stayDays(s, now)))].sort();

  const past = recorded
    .map((s) => s.checkOut)
    .filter((d): d is Date => d !== null && d.getTime() <= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  if (past.length > 0) return { tier: "slept", at: past[0], days };

  /**
   * A stay that carries no check-out AT ALL is the same situation as no stay:
   * somebody recorded having been here and did not record when. Decision 1
   * applies, and it must — otherwise adding a dateless stay row REMOVES the
   * country, which is the opposite of what recording a stay should ever do.
   *
   * This is deliberately NOT the future-booking case below. A null check-out
   * does not say "not yet"; it says "I don't remember".
   */
  if (recorded.some((s) => s.checkOut === null)) return { tier: "slept", at: null, days };

  // Every remaining stay has a check-out in the future: these are bookings.
  return null;
}

/**
 * A flight pair's tier for the country between them.
 *
 * `slept` when the local calendar day changed between landing and taking off
 * again, `visited` when it did not. Callers pass the airport-local days, because
 * this server reads every "when did I fly" figure at the departure airport's
 * clock — a UTC comparison would move a red-eye into the wrong day.
 */
export function groundTier(arrivalLocalDay: string, departureLocalDay: string): CountryTier {
  return departureLocalDay > arrivalLocalDay ? "slept" : "visited";
}

/*
 * ---------------------------------------------------------------------------
 * What a spell between two flights may CONTRIBUTE — owner's decision, 2026-09-02
 * ---------------------------------------------------------------------------
 *
 * **Ground time measures the absence of a recorded departure, not presence.**
 * That sentence is the whole of it. A spell on the ground is the interval
 * between a landing and the next recorded departure from the same country, and
 * for a four-hour connection reading that interval as presence is safe. Over
 * years it is not: the records attest the arrival day and the departure day and
 * attest NOTHING about the days between.
 *
 * Measured on the beta server, 2026-09-02: an account's HOME country reported
 * `daysPresent: 2200` and a ground time of 3,136,245 minutes — 5.5 years. Both
 * figures were literally correct and both were nonsense. The records held a
 * landing in Munich on 2020-01-26 and the next German departure on 2025-07-16,
 * with no flight in between, so the derivation concluded five and a half years
 * of continuous presence in Germany. This is structurally guaranteed to happen
 * for the ONE country every user has, because home is where the gaps are.
 *
 * Two rules follow, and they apply to EVERY spell rather than to long ones —
 * which makes the code smaller, not larger, and leaves no threshold to tune:
 *
 * 1. `attestedGroundDays` — a spell contributes its two ENDPOINT days and never
 *    the range between them.
 * 2. `measuredGroundMinutes` — a duration is `measured` only while the spell
 *    spans at most one night; beyond that it abstains, and the country reports
 *    `unknown`.
 *
 * Neither touches what a spell PROVES: `groundTier` is unchanged, so a day
 * change is still `slept` and a same day is still `visited`. This is about the
 * contribution, never about the tier.
 *
 * Lodging, port calls and place visits are UNCHANGED and still expand through
 * `daysBetween`: a stay from the 12th to the 15th attests four days because the
 * record says so. Only the INFERRED gap between two flights loses its middle.
 */

/**
 * The most nights a spell may span and still publish a duration.
 *
 * ONE, because the boundary is the night — the same structural cut the tiers
 * already make, and the only one this data holds. A 25-hour stopover therefore
 * keeps its measured value, which is the contrast §3.4b exists to draw: the
 * owner's connection countries run 1.4 h–4.7 h and the next is France at 25 h.
 * A spell spanning more nights is not a longer stopover; it is a gap in the
 * flight log, and `unknown` already means "a flight touched this country but no
 * pair of clocks bounds a stay" — whose UI copy, "add the missing flight", is
 * exactly the right instruction for it.
 *
 * NOT configurable, and there must be no fourth ground-time state. §2 refuses
 * dials on principle: a number the user can turn until the total feels right is
 * not a measurement any more.
 */
const MAX_MEASURED_NIGHTS = 1;

/** Nights between two ISO days, or null when either cannot be read. Negative
 *  when the record contradicts itself — the caller decides what that means. */
function nightsBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * The days a spell between two flights attests: the arrival day, the departure
 * day, and nothing in between.
 *
 * A same-day connection therefore contributes ONE day, an overnight two, and
 * the 5.5-year Munich gap two. The days it declines to name are not lost
 * evidence — no record ever held them.
 *
 * A departure day BEFORE the arrival day is a record contradicting itself, and
 * names only the arrival: the same abstention `daysBetween` makes, for the same
 * reason. Counting backwards would turn a typo into a span.
 */
export function attestedGroundDays(arrivalLocalDay: string, departureLocalDay: string): string[] {
  const nights = nightsBetween(arrivalLocalDay, departureLocalDay);
  return nights !== null && nights > 0 ? [arrivalLocalDay, departureLocalDay] : [arrivalLocalDay];
}

/**
 * The minutes a spell may publish, or null where the interval no longer says
 * anything about presence.
 *
 * `null` here becomes `unknown` in the fold, never a zero — the country still
 * carries flight evidence, so `notApplicable` would be the wrong fact and a
 * zero would be a fabrication.
 */
export function measuredGroundMinutes(
  arrivalLocalDay: string,
  departureLocalDay: string,
  minutes: number | null | undefined
): number | null {
  if (typeof minutes !== "number") return null;
  const nights = nightsBetween(arrivalLocalDay, departureLocalDay);
  if (nights === null || nights < 0 || nights > MAX_MEASURED_NIGHTS) return null;
  return minutes;
}
