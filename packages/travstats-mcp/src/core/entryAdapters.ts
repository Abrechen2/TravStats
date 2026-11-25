import { ToolFailure } from "./errors";
import type { ApiClient } from "./client";

type Rec = Record<string, unknown>;

/** One create request an entry becomes (a train booking with three legs is three). */
export interface PlannedRequest {
  path: string;
  body: Rec;
  /** Web path segment of the created entry, e.g. `flights`. */
  segment: string;
  label: string;
}

export interface Plan {
  requests: PlannedRequest[];
  /** Parts of the draft that were NOT added, each with the reason. */
  skipped: string[];
  warnings: string[];
}

/** The domains an entry can be added for. The rest need the web review and say so. */
export const ADDABLE_DOMAINS = ["flight", "cruise", "rail", "rental", "bus", "ferry"] as const;
export type AddableDomain = (typeof ADDABLE_DOMAINS)[number];

const WEB_ONLY: Record<string, string> = {
  lodging:
    "A stay needs the hotel matched and its dates reviewed. Use the web import (Unterkünfte > Import); the document stays in the inbox.",
  package: "A package tour becomes a whole trip. Use the web preview (Reisen > Pauschalreise).",
  place: "A place document is confirmed in the place import on the web.",
};

export function assertAddable(domain: string): asserts domain is AddableDomain {
  if ((ADDABLE_DOMAINS as readonly string[]).includes(domain)) return;
  throw new ToolFailure(
    "invalid_input",
    WEB_ONLY[domain] ?? `Entries of domain "${domain}" cannot be added through this tool.`
  );
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+(?:[.,]\d{1,2})?$/.test(v.trim()))
    return Number(v.trim().replace(",", "."));
  return undefined;
};
const wallClock = (v: unknown): string | undefined => {
  const m = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(v) : null;
  return m ? `${m[1]}T${m[2]}` : undefined;
};
const withoutDomain = (entry: Rec | undefined): Rec =>
  Object.fromEntries(Object.entries(entry ?? {}).filter(([k]) => k !== "domain"));
const drop = (o: Rec): Rec =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const need = (what: string, missing: string[]): never => {
  throw new ToolFailure(
    "invalid_input",
    `${what} is incomplete: ${missing.join(", ")}. Ask the user, then pass the values in \`entry\`.`
  );
};

const SEAT_CLASSES = ["economy", "premium_economy", "business", "first"] as const;
function seatClass(v: unknown): string | undefined {
  const t = str(v)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!t) return undefined;
  if ((SEAT_CLASSES as readonly string[]).includes(t)) return t;
  if (t.startsWith("premium")) return "premium_economy";
  if (t.startsWith("business")) return "business";
  if (t.startsWith("first")) return "first";
  if (t.startsWith("economy") || t.startsWith("eco")) return "economy";
  return undefined;
}

/** What a flight form is filled from: the parser's reading, then the explicit fields on top. */
export function flightFieldsFrom(item: Rec, entry?: Rec): Rec {
  const parsed = drop({
    airline: str(item.airline),
    flightNumber: str(item.flightNumber),
    departureAirport: str(item.departureCode),
    arrivalAirport: str(item.arrivalCode),
    departureLocal: wallClock(item.departureTime),
    arrivalLocal: wallClock(item.arrivalTime),
    bookingReference: str(item.bookingReference) ?? str(item.pnr),
    ticketNumber: str(item.ticketNumber),
    seatNumber: str(item.seat),
    seatClass: seatClass(item.seatClass),
    gate: str(item.gate),
    terminal: str(item.terminal),
    price: num(item.price),
    currency: str(item.currency)?.toUpperCase(),
    aircraft: str(item.aircraft),
    boardingGroup: str(item.boardingGroup),
    taxes: num(item.taxes),
    fees: num(item.fees),
  });
  return { ...parsed, ...drop(withoutDomain(entry)) };
}

interface AirportRow {
  iata?: string | null;
  icao?: string | null;
  name?: string | null;
  lat?: number;
  lon?: number;
  timezone?: string | null;
}

async function airport(client: ApiClient, code: string, which: string): Promise<AirportRow> {
  const row = await client.get<AirportRow>(`/airports/${encodeURIComponent(code)}`);
  if (typeof row.lat !== "number" || typeof row.lon !== "number")
    need(`The ${which} airport ${code}`, ["no position in the catalogue"]);
  if (!row.timezone)
    need(`The ${which} airport ${code}`, [
      "no time zone in the catalogue (no UTC fallback is made)",
    ]);
  return row;
}

const pt = (a: AirportRow) =>
  drop({
    iata: a.iata ?? undefined,
    icao: a.icao ?? undefined,
    name: a.name ?? undefined,
    lat: a.lat,
    lon: a.lon,
  });

export async function planFlight(client: ApiClient, fields: Rec, now = new Date()): Promise<Plan> {
  const missing = ["departureAirport", "arrivalAirport", "departureLocal", "arrivalLocal"].filter(
    (k) => !str(fields[k])
  );
  if (missing.length) need("The flight", missing);
  const [dep, arr] = await Promise.all([
    airport(client, String(fields.departureAirport), "departure"),
    airport(client, String(fields.arrivalAirport), "arrival"),
  ]);
  const departureLocal = String(fields.departureLocal);
  // The same rule the review dialog applies: a departure in the past is a flown flight.
  const status =
    str(fields.status) ??
    (new Date(`${departureLocal}:00Z`).getTime() < now.getTime() ? "flown" : "scheduled");
  const body = drop({
    airline: fields.airline,
    flightNumber: fields.flightNumber,
    aircraft: fields.aircraft,
    departure: pt(dep),
    arrival: pt(arr),
    departureLocal,
    depTimezone: dep.timezone,
    arrivalLocal: fields.arrivalLocal,
    arrTimezone: arr.timezone,
    seatNumber: fields.seatNumber,
    seatClass: fields.seatClass,
    boardingGroup: fields.boardingGroup,
    gate: fields.gate,
    terminal: fields.terminal,
    bookingReference: fields.bookingReference,
    ticketNumber: fields.ticketNumber,
    price: fields.price,
    currency: fields.currency,
    taxes: fields.taxes,
    fees: fields.fees,
    notes: fields.notes,
    tripId: fields.tripId,
    status,
  });
  return {
    requests: [
      {
        path: "/flights",
        body,
        segment: "flights",
        label: `${String(fields.flightNumber ?? "flight")} ${String(fields.departureAirport)}-${String(fields.arrivalAirport)} ${departureLocal.slice(0, 10)}`,
      },
    ],
    skipped: [],
    warnings: [],
  };
}

export function planCruise(item: Rec): Plan {
  const input = item.input as Rec | undefined;
  if (!input || typeof input !== "object") need("The cruise", ["no `input` in the draft"]);
  const warnings: string[] = [];
  if (item.shipMatched === false) warnings.push("The ship was not matched to the catalogue.");
  const unmatched = item.unmatchedPorts;
  if (Array.isArray(unmatched) && unmatched.length)
    warnings.push(
      `${unmatched.length} port(s) are not matched; they are kept as unresolved stops.`
    );
  if (Array.isArray(item.flights) && item.flights.length)
    warnings.push(`The booking also holds ${item.flights.length} flight(s); they were NOT added.`);
  return {
    requests: [
      {
        path: "/cruises",
        body: { ...(input as Rec) },
        segment: "cruises",
        label: String((input as Rec).shipName ?? (input as Rec).name ?? "cruise"),
      },
    ],
    skipped: [],
    warnings,
  };
}

export function planRental(item: Rec): Plan {
  if (item.kind !== "confirmation" || item.action !== "create" || !item.input)
    need("The rental document", [
      `it is a ${String(item.kind)} (${String(item.action)}), not a new booking; changes to a rental are reviewed on the web`,
    ]);
  const stations = item.stations as { pickup?: Rec; return?: Rec } | null | undefined;
  const unresolved = (["pickup", "return"] as const).filter(
    (k) => stations?.[k] && stations[k]!.status !== "resolved" && stations[k]!.status !== "geocoded"
  );
  const input = item.input as Rec;
  if (unresolved.length && !(unresolved.includes("return") && input.returnStation === null))
    need(
      "The rental",
      unresolved.map(
        (k) => `${k} station is ${String(stations?.[k]?.status)} (pick it on the web review)`
      )
    );
  return {
    requests: [
      {
        path: "/rentals/import",
        body: drop({ kind: "confirmation", input, mailSentAt: item.mailSentAt ?? undefined }),
        segment: "rentals",
        label:
          `${String(item.provider ?? "rental")} ${String(item.confirmationNumber ?? "")}`.trim(),
      },
    ],
    skipped: [],
    warnings: [],
  };
}

interface RailStation {
  name?: string;
  stationId?: number | null;
  code?: string | null;
  lat?: number | null;
  lon?: number | null;
  country?: string | null;
  resolved?: boolean;
  positionSource?: string | null;
}

const placed = (
  s: RailStation | undefined
): s is RailStation & { lat: number; lon: number; name: string } =>
  !!s &&
  !!str(s.name) &&
  typeof s.lat === "number" &&
  typeof s.lon === "number" &&
  (s.resolved === true || s.positionSource === "provider");

const stationBody = (s: RailStation & { lat: number; lon: number; name: string }) =>
  drop({
    stationId: s.stationId ?? undefined,
    name: s.name.trim(),
    code: s.code ?? undefined,
    lat: s.lat,
    lon: s.lon,
    country: s.country ?? undefined,
  });

export function planRail(item: Rec): Plan {
  if (item.documentKind === "reservation")
    need("The rail document", [
      "it is a seat reservation for rides already logged; attach it on the web review",
    ]);
  const legs = Array.isArray(item.legs) ? (item.legs as Rec[]) : [];
  if (!legs.length) need("The rail booking", ["no legs"]);
  const requests: PlannedRequest[] = [];
  const skipped: string[] = [];
  const flightBooking = item.source === "flight-booking";
  let carriedTotal = false;
  // A leg already logged carries the total; writing it again would count the ticket twice.
  const totalAlready = legs.some((l) => l.duplicateOf);
  legs.forEach((leg, i) => {
    const name = `${String(leg.depStationName)} to ${String(leg.arrStationName)}`;
    const transit = leg.transit as { mode?: string } | undefined;
    if (leg.duplicateOf) return void skipped.push(`Leg ${i + 1} (${name}) is already logged.`);
    if (transit?.mode === "bus" || transit?.mode === "ferry" || transit?.mode === "unknown")
      return void skipped.push(`Leg ${i + 1} (${name}) is a ${transit.mode} ride, not a train.`);
    const dep = leg.departureStation as RailStation | undefined;
    const arr = leg.arrivalStation as RailStation | undefined;
    if (!placed(dep) || !placed(arr))
      return void skipped.push(
        `Leg ${i + 1} (${name}): a station has no position yet; pick it on the web review.`
      );
    const carries = !carriedTotal && !totalAlready;
    if (carries) carriedTotal = true;
    requests.push({
      path: "/rail",
      segment: "rail",
      label: name,
      body: drop({
        operator: item.operator ?? undefined,
        trainCategory: leg.trainCategory ?? undefined,
        trainNumber: leg.trainNumber ?? undefined,
        departureStation: stationBody(dep),
        arrivalStation: stationBody(arr),
        departureLocal: leg.departureLocal,
        arrivalLocal: leg.arrivalLocal ?? undefined,
        travelClass: item.travelClass ?? undefined,
        coach: leg.coach ?? undefined,
        seat: leg.seat ?? undefined,
        bookingReference: item.bookingReference ?? undefined,
        price: carries ? (item.price ?? undefined) : undefined,
        currency: (item.currency as string | null) ?? "EUR",
        status: "scheduled",
        notes: item.tariff ?? undefined,
        transitMode: transit?.mode === "metro" || transit?.mode === "tram" ? transit.mode : "rail",
        ...(flightBooking ? { railAndFly: false } : {}),
      }),
    });
  });
  if (!requests.length) need("The rail booking", ["no leg can be added: " + skipped.join(" ")]);
  return { requests, skipped, warnings: [] };
}

/** A coach or ferry ticket: the template reads names and times only, never positions. */
export function planRide(domain: "bus" | "ferry", item: Rec, entry?: Rec): Plan {
  const rides = Array.isArray(item.rides) ? (item.rides as Rec[]) : [];
  const ride = rides[0] ?? {};
  const fields = {
    ...drop({
      operator: str(item.operator),
      bookingReference: str(item.bookingReference),
      price: num(item.price),
      currency: str(item.currency),
      departureLocal: wallClock(ride.departureLocal),
      arrivalLocal: wallClock(ride.arrivalLocal),
      ...(domain === "bus"
        ? { lineName: str(ride.lineName) }
        : { vesselName: str(ride.vesselName) }),
    }),
    ...drop(withoutDomain(entry)),
  } as Rec;
  const dep = fields.departureStation as Rec | undefined;
  const arr = fields.arrivalStation as Rec | undefined;
  const missing: string[] = [];
  if (!str(fields.departureLocal)) missing.push("departureLocal");
  for (const [k, s, printed] of [
    ["departureStation", dep, ride.depName],
    ["arrivalStation", arr, ride.arrName],
  ] as const) {
    if (!s || typeof s.lat !== "number" || typeof s.lon !== "number")
      missing.push(
        `${k} {name, lat, lon}${printed ? ` (the ticket prints "${String(printed)}")` : ""}`
      );
  }
  if (missing.length) need(`The ${domain} ride`, missing);
  const body = drop({
    ...fields,
    departureStation: dep,
    arrivalStation: arr,
    status: fields.status ?? "scheduled",
  });
  const more =
    rides.length > 1
      ? [`The ticket holds ${rides.length} rides; only the first was prepared.`]
      : [];
  return {
    requests: [
      {
        path: `/${domain}`,
        body,
        segment: domain,
        label: `${String((dep as Rec).name)} to ${String((arr as Rec).name)}`,
      },
    ],
    skipped: [],
    warnings: more,
  };
}
