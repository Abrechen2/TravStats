import fs from "fs/promises";
import { z } from "zod";
import { prisma } from "../../db";
import type { ComparisonLink } from "../../prisma";
import { collectTrip } from "../trip/exchange/collect";
import { tripFileSchema } from "../trip/exchange/format";
import { loadVisibleDomains } from "../domainVisibility";
import { currentGrant, storedScope, assertUnchanged, audit } from "./snapshots";
import { refused } from "./security";

const scalar = z.union([z.string().max(50_000), z.number().finite(), z.boolean(), z.null()]);
export const detailSchema = z.strictObject({
  tripId: z.string().uuid(),
  attachments: z
    .array(
      z.strictObject({
        key: z.string().max(150),
        name: z.string().max(200),
        kind: z.enum(["photos", "documents"]),
      })
    )
    .max(2000),
  sections: z
    .array(
      z.strictObject({
        name: z.string().max(30),
        rows: z
          .array(
            z.strictObject({
              key: z.string().max(100),
              fields: z
                .array(z.strictObject({ name: z.string().max(100), value: scalar }))
                .max(150),
            })
          )
          .max(2000),
      })
    )
    .max(20),
});
export type Detail = z.infer<typeof detailSchema>;
/** A positive field inventory: a new export column never inherits an existing permission. */
const FACTS = new Set(
  "name color icon category status startDate endDate startDay endDay startZone endZone originLabel destinationLabel flightNumber airline airlineIata airlineIcao operatingAirline operatingAirlineIata operatingAirlineIcao aircraft aircraftRegistration depIata depIcao depName depLat depLon arrIata arrIcao arrName arrLat arrLon departureTime arrivalTime depTimezone arrTimezone depTimeSemantics arrTimeSemantics depPrecision arrPrecision specialType type address city country isoCountryCode lat lon stars website wikidataId checkIn checkOut checkInTime checkOutTime checkInDate checkOutDate checkInAt checkOutAt stayZone datePrecision nights board roomType dayNumber arrival departure isAtSea unresolvedPortName shipName shipImo shipType cruiseLine departurePort arrivalPort trainNumber operator product lineName depStation arrStation depStationName arrStationName depCountry arrCountry depLat depLon arrLat arrLon arrivalDate departureDate provider vehicleClass vehicleModel pickupTime returnTime pickupZone returnZone pickupPrecision returnPrecision pickupStation returnStation pickupAddress returnAddress pickupLat pickupLon returnLat returnLon actualPickupTime actualReturnTime startOdometer endOdometer distanceKm visitedAt visitedAtUtc visitedZone visitedPrecision localName orderIdx date title time datePrecision".split(
    " "
  )
);
const PERSONAL = new Set(
  "description tags notes summary companions seatNumber seatClass boardingGroup bookingClassLetter roomNumber cabinNumber cabinType ratingRoom ratingBreakfast ratingService ratingOverall rating journal text content".split(
    " "
  )
);
const COSTS = new Set(
  "price currency totalPrice pricePerNight totalCost amount deposit depositAmount depositCurrency invoiceAmount invoiceCurrency finalAmount finalCurrency".split(
    " "
  )
);
const DOCUMENTS = new Set(
  "pnr bookingReference ticketNumber frequentFlyerNumber confirmationNumber contractNumber".split(
    " "
  )
);
const SECTION_DOMAIN: Record<string, string | undefined> = {
  flights: "flight",
  stays: "lodging",
  cruises: "cruise",
  rail: "rail",
  bus: "bus",
  rentals: "rental",
  places: "poi",
  visits: "poi",
};

export async function sourceDetails(
  link: ComparisonLink,
  audience: string,
  tripId: string
): Promise<Detail> {
  const grant = await currentGrant(link, audience);
  const scope = storedScope(grant.scope);
  if (
    !scope.details ||
    ((!scope.futureTrips || scope.tripIds.length > 0) && !scope.tripIds.includes(tripId))
  )
    throw refused();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: link.userId },
    select: { createdAt: true, startDate: true, endDate: true },
  });
  if (!trip || (!scope.futureTrips && trip.createdAt > new Date(scope.acceptedAt))) throw refused();
  // Trip packages and files can include undated entries. Year-limited grants use the
  // per-record view instead, where each entry's own calendar determines eligibility.
  if (scope.year !== null) throw refused();
  const domains = (await loadVisibleDomains(link.userId)).filter((d) => scope.domains.includes(d));
  const collected = await collectTrip(link.userId, tripId, {
    private: true,
    photos: scope.photos,
    documents: scope.documents,
  });
  const file = tripFileSchema.parse(collected.file);
  const allowed = (name: string) =>
    FACTS.has(name) ||
    (scope.personal && PERSONAL.has(name)) ||
    (scope.costs && COSTS.has(name)) ||
    (scope.documents && DOCUMENTS.has(name));
  function fields(
    value: unknown,
    prefix = ""
  ): Array<{ name: string; value: z.infer<typeof scalar> }> {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([name, v]) => {
      if (name === "key" || name === "bookingKey" || name === "externalRef") return [];
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        // Container names are explicit too: unknown nested structures remain private.
        if (
          ![
            "private",
            "lodging",
            "depStation",
            "arrStation",
            "departurePort",
            "arrivalPort",
            "ship",
          ].includes(name)
        )
          return [];
        return fields(v, name === "private" ? prefix : prefix + name + ".");
      }
      if (!allowed(name)) return [];
      if (Array.isArray(v))
        return v.every((e) => typeof e === "string")
          ? [{ name: prefix + name, value: v.join(", ") }]
          : [];
      const parsed = scalar.safeParse(v);
      return parsed.success ? [{ name: prefix + name, value: parsed.data }] : [];
    });
  }
  const sections: Detail["sections"] = [];
  for (const [name, value] of Object.entries(file)) {
    if (["photos", "documents", "stops"].includes(name)) continue;
    if (name === "journal" && !scope.personal) continue;
    if (name === "bookings" && !scope.costs && !scope.documents) continue;
    if (SECTION_DOMAIN[name] && !domains.includes(SECTION_DOMAIN[name] as never)) continue;
    // Trip-wide labels may describe excluded domains. Reveal them only with the full domain set.
    if (name === "trip" && domains.length !== (await loadVisibleDomains(link.userId)).length)
      continue;
    const rows = (Array.isArray(value) ? value : [value])
      .map((row, index) => ({ key: String(index), fields: fields(row) }))
      .filter((row) => row.fields.length > 0);
    if (rows.length) sections.push({ name, rows });
  }
  const allVisible = domains.length === (await loadVisibleDomains(link.userId)).length;
  // Trip-wide files can contain any domain. A narrow domain grant must not disclose them.
  const attachments = allVisible
    ? [
        ...file.photos.map((p) => ({ key: p.file, name: p.file, kind: "photos" as const })),
        ...file.documents.map((d) => ({
          key: d.file,
          name: d.originalName ?? d.file,
          kind: "documents" as const,
        })),
      ]
    : [];
  const result = detailSchema.parse({ tripId, sections, attachments });
  await assertUnchanged(link, grant);
  await audit(link, grant, "trip-details");
  return result;
}

export const attachmentSchema = z.strictObject({
  name: z.string().max(200),
  bytes: z
    .string()
    .max(7_000_000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((v) => v.length % 4 === 0),
  mime: z.literal("application/octet-stream"),
});
/** Files are downloaded, never injected into HTML or auto-fetched by the receiving peer. */
export async function sourceAttachment(
  link: ComparisonLink,
  audience: string,
  tripId: string,
  key: string
) {
  const grant = await currentGrant(link, audience);
  const detail = await sourceDetails(link, audience, tripId);
  const metadata = detail.attachments.find((a) => a.key === key);
  if (!metadata) throw refused();
  const collected = await collectTrip(link.userId, tripId, {
    private: false,
    photos: metadata.kind === "photos",
    documents: metadata.kind === "documents",
  });
  const file = collected.files.find((f) => f.name === key);
  if (!file) throw refused();
  const handle = await fs.open(file.source, "r");
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw refused();
    bytes = await handle.readFile();
    if (bytes.length > 5 * 1024 * 1024) throw refused();
  } finally {
    await handle.close();
  }
  await assertUnchanged(link, grant);
  await audit(link, grant, "attachment");
  return attachmentSchema.parse({
    name: metadata.name,
    bytes: bytes.toString("base64"),
    mime: "application/octet-stream",
  });
}
