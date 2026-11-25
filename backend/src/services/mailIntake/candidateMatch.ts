/**
 * Is a booking mail already in TravStats? Answered from its headers alone, for
 * the "Postfach durchsuchen" scan: the mail itself is never opened here.
 *
 * Three signals, strongest first:
 * 1. a booking reference / PNR in the subject that an entry already carries;
 * 2. its Message-ID was already taken by the intake;
 * 3. the sender's brand plus a travel date near an existing entry of the same
 *    domain. This one is a hint only ("likely_present"): a frequent flyer has a
 *    Lufthansa flight near almost every Lufthansa mail, so it never hides a mail.
 */
import { prisma } from "../../db";
import { normalizeText, type BookingKind, type HeaderInfo, type Verdict } from "./prefilter";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A booking mail arrives up to half a year before the trip and a few days after it starts. */
const BRAND_WINDOW = { beforeMs: 3 * DAY_MS, afterMs: 180 * DAY_MS };
const REFERENCE_RE = /[A-Za-z0-9]{5,12}/g;

interface KnownEntry {
  kind: BookingKind;
  key: string;
  at: number;
}

export interface Known {
  references: Set<string>;
  messageIds: Set<string>;
  entries: KnownEntry[];
}

export type MatchResult = "reference" | "message" | "likely_present" | null;

const refKey = (value: string | null | undefined): string | null => {
  const key = (value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return key.length >= 5 ? key : null;
};

const brandKey = (value: string | null | undefined): string =>
  normalizeText(value ?? "").replace(/[^a-z0-9]/g, "");

/** Everything of the user's the scan compares against, read once per scan. */
export async function loadKnown(userId: string): Promise<Known> {
  const [flights, stays, rail, cruises, rentals, messages] = await Promise.all([
    prisma.flight.findMany({
      where: { userId },
      select: {
        bookingReference: true,
        airline: true,
        operatingAirline: true,
        departureTime: true,
      },
    }),
    prisma.lodgingStay.findMany({
      where: { userId },
      select: {
        bookingReference: true,
        checkIn: true,
        lodging: { select: { name: true, chain: { select: { name: true } } } },
      },
    }),
    prisma.railJourney.findMany({
      where: { userId },
      select: { bookingReference: true, operator: true, departureTime: true },
    }),
    prisma.cruise.findMany({
      where: { userId },
      select: { bookingReference: true, cruiseLine: true, startDate: true },
    }),
    prisma.rentalBooking.findMany({
      where: { userId },
      select: { confirmationNumber: true, brokerReference: true, provider: true, pickupTime: true },
    }),
    prisma.mailIntakeMessage.findMany({ where: { userId }, select: { messageId: true } }),
  ]);
  const references = new Set<string>();
  const add = (v: string | null | undefined) => {
    const key = refKey(v);
    if (key) references.add(key);
  };
  const entries: KnownEntry[] = [];
  const entry = (kind: BookingKind, text: Array<string | null | undefined>, at: Date | null) => {
    if (!at) return;
    for (const t of text) {
      const key = brandKey(t);
      if (key.length >= 3) entries.push({ kind, key, at: at.getTime() });
    }
  };
  for (const f of flights) {
    add(f.bookingReference);
    entry("flight", [f.airline, f.operatingAirline], f.departureTime);
  }
  for (const s of stays) {
    add(s.bookingReference);
    entry("lodging", [s.lodging?.name, s.lodging?.chain?.name], s.checkIn);
  }
  for (const r of rail) {
    add(r.bookingReference);
    entry("rail", [r.operator], r.departureTime);
  }
  for (const c of cruises) {
    add(c.bookingReference);
    entry("cruise", [c.cruiseLine], c.startDate);
  }
  for (const r of rentals) {
    add(r.confirmationNumber);
    add(r.brokerReference);
    entry("rental", [r.provider], r.pickupTime);
  }
  return {
    references,
    messageIds: new Set(messages.map((m) => m.messageId)),
    entries,
  };
}

/** The subject's tokens that could be a booking reference (5–12 letters/digits). */
export function referenceTokens(subject: string | null): string[] {
  return (subject?.match(REFERENCE_RE) ?? []).map((t) => t.toUpperCase());
}

export function matchCandidate(header: HeaderInfo, verdict: Verdict, known: Known): MatchResult {
  if (referenceTokens(header.subject).some((t) => known.references.has(t))) return "reference";
  if (header.messageId && known.messageIds.has(header.messageId)) return "message";
  const brand = brandKey(verdict.brand);
  const at = header.date?.getTime();
  if (brand.length >= 3 && at !== undefined) {
    const near = known.entries.some(
      (e) =>
        (verdict.kind === null || e.kind === verdict.kind) &&
        (e.key.includes(brand) || brand.includes(e.key)) &&
        e.at >= at - BRAND_WINDOW.beforeMs &&
        e.at <= at + BRAND_WINDOW.afterMs
    );
    if (near) return "likely_present";
  }
  return null;
}
