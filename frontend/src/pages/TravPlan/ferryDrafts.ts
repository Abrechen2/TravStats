/**
 * A ferry reading, shaped for `bookingDrafts` (spec 2026-10-17 §7).
 *
 * Two readers exist and both land here: the parse pipeline with `domain: "ferry"` answers
 * `tickets` (a template read the document: one ticket, several rides), and
 * `POST /ferry/ticket-preview` answers `crossings` (the templates first, then labelled facts and
 * the verified model, each value with its evidence). Either becomes one candidate per crossing,
 * which the booking review treats like any other domain's: placeholder matching included.
 */
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const value = (field: unknown): string | number | null => {
  const v = record(field).value;
  return typeof v === "string" || typeof v === "number" ? v : null;
};
const num = (field: unknown): number | null => {
  const v = value(field);
  const n = typeof v === "number" ? v : v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

function fromProposal(crossing: Record<string, unknown>): Record<string, unknown> {
  return {
    depStationName: value(crossing.departurePort),
    arrStationName: value(crossing.arrivalPort),
    departurePort: value(crossing.departurePort),
    arrivalPort: value(crossing.arrivalPort),
    departureLocal: value(crossing.departureLocal),
    arrivalLocal: value(crossing.arrivalLocal),
    operator: value(crossing.operator),
    bookingReference: value(crossing.bookingReference),
    vesselName: value(crossing.vesselName),
    vehicleRegistration: value(crossing.vehicleRegistration),
    price: num(crossing.price),
    currency: value(crossing.currency),
  };
}

function fromTicket(ticket: Record<string, unknown>, ride: unknown): Record<string, unknown> {
  const r = record(ride);
  return {
    depStationName: r.depName,
    arrStationName: r.arrName,
    departurePort: r.depName,
    arrivalPort: r.arrName,
    departureLocal: r.departureLocal,
    arrivalLocal: r.arrivalLocal,
    operator: ticket.operator,
    bookingReference: ticket.bookingReference,
    vesselName: r.carrier ?? r.vesselName,
    // The printed price is the ticket's total: it belongs to a crossing only on a single one.
    ...(Array.isArray(ticket.rides) && ticket.rides.length === 1
      ? { price: ticket.price, currency: ticket.currency }
      : {}),
  };
}

export type FerryReading = { crossings: unknown[] } | { tickets: unknown[] };

/** `{domain, candidates}`, the shape `bookingDrafts` reads; empty when nothing was read. */
export function ferryCandidates(reading: unknown): { domain: "ferry"; candidates: unknown[] } {
  const body = record(reading);
  const candidates = Array.isArray(body.crossings)
    ? body.crossings.map((c) => fromProposal(record(c)))
    : Array.isArray(body.tickets)
      ? body.tickets.flatMap((t) => {
          const ticket = record(t);
          return Array.isArray(ticket.rides) ? ticket.rides.map((r) => fromTicket(ticket, r)) : [];
        })
      : [];
  return {
    domain: "ferry",
    candidates: candidates.map((c) =>
      Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined))
    ),
  };
}
