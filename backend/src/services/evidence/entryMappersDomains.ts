import type { EvidenceEntry } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { sortEntries, sliceEntries } from "./paging";

/**
 * Row → `EvidenceEntry` for the four NON-flight domains, plus the sort →
 * slice tail they share.
 *
 * A sibling of `entryMappers.ts` rather than an extension of it: that file
 * is the flight mapper and the two flight-shaped hydration helpers, and
 * growing it to cover five domains would make one module every resolver
 * imports and none of them reads in full. The split is by DOMAIN because
 * that is what differs — `href`, what the title says, which id is the
 * evidence and which is the link target.
 *
 * These mappers take rows that are ALREADY hydrated. The flight helpers
 * page first and hydrate the page, because a flight measure's population is
 * the whole account and only the page's flight numbers are needed. Every
 * measure served from here works over a set the resolver has loaded in full
 * anyway (the travel account walks every stay, cruise and flight to attribute
 * one night), so a second query for the page would be work with nothing to
 * save.
 */

export type EvidenceDate = EvidenceEntry["date"];

/** `Date | null` → the contract's day-precision shape. Undated rows sort last. */
export function dayPrecisionDate(date: Date | null): EvidenceDate {
  return date ? { value: date.toISOString().slice(0, 10), precision: "day" } : null;
}

export interface CruiseEvidenceRow {
  id: string;
  /** Route name, ship name, or whatever the loader could resolve — never translated. */
  label: string;
  startDate: Date | null;
}

/**
 * A cruise as evidence. `title` is `{ text }` because a route name and a
 * ship's name are the traveller's own data, not a phrase to translate.
 */
export function cruiseEvidenceEntry(
  row: CruiseEvidenceRow,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "subtitle">
): EvidenceEntry {
  return {
    domain: "cruise",
    id: row.id,
    href: `/cruises/${row.id}`,
    title: { text: row.label },
    subtitle: fields.subtitle ?? null,
    date: dayPrecisionDate(row.startDate),
    ...(fields.contribution === undefined ? {} : { contribution: fields.contribution }),
    ...(fields.credits === undefined ? {} : { credits: fields.credits }),
  };
}

export interface StayEvidenceRow {
  /** The STAY's id — the evidence — which is not what `href` targets. */
  id: string;
  lodgingId: string;
  lodgingName: string;
  checkIn: Date | null;
}

/**
 * A lodging stay as evidence. The contract is explicit that `id` identifies
 * the EVIDENCE and `href` the place the user goes: a stay has no page of its
 * own, so the link targets its lodging while the id stays the stay's. A
 * resolver that used the lodging id for both would collapse two stays at the
 * same hotel into one row.
 */
export function stayEvidenceEntry(
  row: StayEvidenceRow,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "subtitle">
): EvidenceEntry {
  return {
    domain: "lodging",
    id: row.id,
    href: `/lodging/${row.lodgingId}`,
    title: { text: row.lodgingName },
    subtitle: fields.subtitle ?? null,
    date: dayPrecisionDate(row.checkIn),
    ...(fields.contribution === undefined ? {} : { contribution: fields.contribution }),
    ...(fields.credits === undefined ? {} : { credits: fields.credits }),
  };
}

export interface TripEvidenceRow {
  id: string;
  name: string;
  startDate: Date | null;
}

export function tripEvidenceEntry(
  row: TripEvidenceRow,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "subtitle">
): EvidenceEntry {
  return {
    domain: "trip",
    id: row.id,
    href: `/trips/${row.id}`,
    title: { text: row.name },
    subtitle: fields.subtitle ?? null,
    date: dayPrecisionDate(row.startDate),
    ...(fields.contribution === undefined ? {} : { contribution: fields.contribution }),
    ...(fields.credits === undefined ? {} : { credits: fields.credits }),
  };
}

export interface PlaceEvidenceRow {
  /** The VISIT's id where a visit is the evidence; the place id otherwise. */
  id: string;
  placeId: string;
  placeName: string;
  visitedAt: Date | null;
}

/**
 * A place visit as evidence. Like a stay, the evidence and the link target
 * differ: a visit has no page, its place does, and three visits to one place
 * are three pieces of evidence.
 */
export function placeEvidenceEntry(
  row: PlaceEvidenceRow,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "subtitle">
): EvidenceEntry {
  return {
    domain: "place",
    id: row.id,
    href: `/places/${row.placeId}`,
    title: { text: row.placeName },
    subtitle: fields.subtitle ?? null,
    date: dayPrecisionDate(row.visitedAt),
    ...(fields.contribution === undefined ? {} : { contribution: fields.contribution }),
    ...(fields.credits === undefined ? {} : { credits: fields.credits }),
  };
}

/**
 * Sort → slice, for entries that are already built. The flight side does the
 * same two steps inside its hydration helpers; here the rows carry their own
 * titles, so the page is a pure slice of a total ordering (date descending,
 * id ascending, undated last — `paging.ts`).
 */
export function pageEntries(
  entries: EvidenceEntry[],
  page: PagingParams
): { entries: EvidenceEntry[]; omittedCount: number } {
  const sorted = sortEntries(entries);
  const paged = sliceEntries(sorted, page);
  return { entries: paged, omittedCount: entries.length - paged.length };
}

/** The `sum` tail: page the entries and report what the page left behind. */
export function pageSumEntries(
  entries: EvidenceEntry[],
  page: PagingParams
): { entries: EvidenceEntry[]; omittedCount: number; omittedContribution: number } {
  const { entries: paged, omittedCount } = pageEntries(entries, page);
  const total = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
  const returned = paged.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
  return { entries: paged, omittedCount, omittedContribution: total - returned };
}

/**
 * The `distinct` tail. `omittedCredits` is the size of the UNION gap between
 * the whole matched set and the returned page — never a per-row sum, which
 * would double-count a unit two rows both witness.
 */
export function pageDistinctEntries(
  entries: EvidenceEntry[],
  page: PagingParams
): { entries: EvidenceEntry[]; omittedCount: number; omittedCredits: number } {
  const { entries: paged, omittedCount } = pageEntries(entries, page);
  const all = new Set(entries.flatMap((e) => e.credits ?? []));
  const returned = new Set(paged.flatMap((e) => e.credits ?? []));
  return { entries: paged, omittedCount, omittedCredits: all.size - returned.size };
}
