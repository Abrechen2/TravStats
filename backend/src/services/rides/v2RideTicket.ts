/**
 * Bus and ferry consumption of v2 templates (forgejo#309): the one place a
 * `bus` or `ferry` template's values become a ticket reading. Nothing about
 * an operator is compiled in — a coach company's or a ferry line's layout is
 * a template file (from the repository, or one the user derived in the
 * workshop), and this reads what every such file yields the same way.
 *
 * What a template yields:
 *  - `operator`, `bookingReference`, `price`, `currency` — once per ticket;
 *  - `rides` — a repeat, one item per ride or crossing, with `depName`,
 *    `arrName`, `departureLocal` and `arrivalLocal` (`YYYY-MM-DDTHH:mm` on the
 *    terminal's own printed clock), and the carrier: `lineName` for a bus,
 *    `vesselName` for a ferry;
 *  - the carrier once for the ticket too, which a ride without its own takes.
 *
 * Values are validated by Zod first (a template is community data). A ride
 * needs both ends and a departure; a currency is stated only beside a price; a
 * value the document does not print is null, never a guess.
 */
import { z } from "zod";
import logger from "../../utils/logger";
import type { TemplateEnvelope } from "../parsers/templates/v2/envelope";
import { applyTemplate } from "../parsers/templates/v2/runners";

export const RIDE_TICKET_DOMAINS = ["bus", "ferry"] as const;
export type RideTicketDomain = (typeof RIDE_TICKET_DOMAINS)[number];

/** The value name of each domain's carrier: a coach line, a ship. */
export const CARRIER_FIELD: Readonly<Record<RideTicketDomain, "lineName" | "vesselName">> = {
  bus: "lineName",
  ferry: "vesselName",
};

export interface ParsedRide {
  depName: string;
  arrName: string;
  departureLocal: string;
  arrivalLocal: string | null;
  /** The coach line ("N 123") or the vessel name — whichever the domain carries. */
  carrier: string | null;
}

export interface ParsedRideTicket {
  domain: RideTicketDomain;
  operator: string | null;
  bookingReference: string | null;
  price: number | null;
  currency: string | null;
  rides: ParsedRide[];
  /** The template that read it, e.g. `ferry:user-<id>`. */
  templateId: string;
  /** "workshop" for the user's own template, else the repository's. */
  source: "workshop" | "repository";
}

const text = z.string().min(1).nullish();
const localTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .nullish();

const rideSchema = z.object({
  depName: text,
  arrName: text,
  departureLocal: localTime,
  arrivalLocal: localTime,
  lineName: text,
  vesselName: text,
});

const valuesSchema = z.object({
  source: text,
  operator: text,
  bookingReference: text,
  lineName: text,
  vesselName: text,
  price: z.number().finite().nonnegative().nullish(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  rides: z.array(rideSchema).max(100).optional(),
});

function toRide(
  ride: z.infer<typeof rideSchema>,
  carrierField: "lineName" | "vesselName",
  ticketCarrier: string | null
): ParsedRide | null {
  if (!ride.depName || !ride.arrName || !ride.departureLocal) return null;
  return {
    depName: ride.depName,
    arrName: ride.arrName,
    departureLocal: ride.departureLocal,
    arrivalLocal: ride.arrivalLocal ?? null,
    carrier: ride[carrierField] ?? ticketCarrier,
  };
}

/** One document read by one bus or ferry template, or null when it reads no ride. */
export function applyV2RideTicketTemplate(
  template: TemplateEnvelope,
  document: string
): ParsedRideTicket | null {
  const domain = template.domain;
  if (domain !== "bus" && domain !== "ferry") return null;
  const application = applyTemplate(template, document);
  if (!application.matched) return null;
  const parsed = valuesSchema.safeParse(application.values);
  if (!parsed.success) {
    logger.warn(
      {
        template: template.id,
        version: template.version,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      `v2 ${domain} template produced values of the wrong shape — declined`
    );
    return null;
  }
  const values = parsed.data;
  const carrierField = CARRIER_FIELD[domain];
  const ticketCarrier = values[carrierField] ?? null;
  const rides = (values.rides ?? [])
    .map((ride) => toRide(ride, carrierField, ticketCarrier))
    .filter((ride): ride is ParsedRide => ride !== null);
  if (rides.length === 0) return null;
  const price = values.price ?? null;
  return {
    domain,
    operator: values.operator ?? null,
    bookingReference: values.bookingReference ?? null,
    price,
    currency: price !== null ? (values.currency ?? null) : null,
    rides,
    templateId: template.id,
    source: values.source === "workshop" ? "workshop" : "repository",
  };
}
