/**
 * The documents of a `.travstats` export: every kept original with a link
 * inside the trip, and only the links inside it (document-links D3).
 */
import { prisma } from "../../../db";
import type { Document } from "../../../prisma";
import { documentPath } from "../../documents/documentStore";
import type { LinkProvenance, LinkRole } from "../../documents/documentLinks";
import type { LoadedTrip, PackedFile } from "./collect";
import { extensionOf, isoDay } from "./collectShared";
import type { EntityKind, TripFile } from "./format";

type DocumentTargets = Pick<
  Document,
  | "tripId"
  | "flightId"
  | "lodgingStayId"
  | "cruiseId"
  | "railJourneyId"
  | "busJourneyId"
  | "ferryJourneyId"
  | "rentalBookingId"
  | "placeVisitId"
>;

export async function collectDocuments(
  userId: string,
  trip: LoadedTrip,
  file: TripFile,
  files: PackedFile[],
  keys: Record<Exclude<EntityKind, "trip">, (id: string) => string>
): Promise<void> {
  const ids = <T extends { id: string }>(list: T[]) => list.map((e) => e.id);
  const scope = [
    { tripId: trip.id },
    { flightId: { in: ids(trip.flights) } },
    { lodgingStayId: { in: ids(trip.lodgingStays) } },
    { cruiseId: { in: ids(trip.cruises) } },
    { railJourneyId: { in: ids(trip.railJourneys) } },
    { busJourneyId: { in: ids(trip.busJourneys) } },
    { ferryJourneyId: { in: ids(trip.ferryJourneys) } },
    { rentalBookingId: { in: ids(trip.rentalBookings) } },
    { placeVisitId: { in: ids(trip.placeVisits) } },
  ];
  // A document is in the file when ANY of its links lands inside the trip (a
  // booking filed on another entry but covering one of these), and the file
  // carries only the links inside the trip — never an entry outside the export.
  const documents = await prisma.document.findMany({
    where: { userId, OR: [...scope, { links: { some: { OR: scope } } }] },
    orderBy: { createdAt: "asc" },
    include: { links: { where: { OR: scope }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  const entityOf = (d: DocumentTargets): TripFile["documents"][number]["entity"] | null =>
    d.flightId
      ? { kind: "flight", key: keys.flight(d.flightId) }
      : d.lodgingStayId
        ? { kind: "stay", key: keys.stay(d.lodgingStayId) }
        : d.cruiseId
          ? { kind: "cruise", key: keys.cruise(d.cruiseId) }
          : d.railJourneyId
            ? { kind: "rail", key: keys.rail(d.railJourneyId) }
            : d.busJourneyId
              ? { kind: "bus", key: keys.bus(d.busJourneyId) }
              : d.ferryJourneyId
                ? { kind: "ferry", key: keys.ferry(d.ferryJourneyId) }
                : d.rentalBookingId
                  ? { kind: "rental", key: keys.rental(d.rentalBookingId) }
                  : d.placeVisitId
                    ? { kind: "visit", key: keys.visit(d.placeVisitId) }
                    : d.tripId
                      ? { kind: "trip", key: null }
                      : null;
  documents.forEach((d, i) => {
    const links = d.links.flatMap((l) => {
      const entity = entityOf(l);
      return entity
        ? [{ entity, role: l.role as LinkRole, provenance: l.provenance as LinkProvenance }]
        : [];
    });
    // Where the document is filed inside the file: its in-scope primary, else its
    // first in-scope link, else (no link rows yet) the old owner column that
    // selected it.
    const entity = links.find((l) => l.role === "primary")?.entity ??
      links[0]?.entity ??
      entityOf(d) ?? { kind: "trip", key: null };
    const name = `documents/d${i + 1}.${extensionOf(d.storedName, "bin")}`;
    files.push({ name, source: documentPath(d.storedName) });
    file.documents.push({
      file: name,
      entity,
      // One link is the entity itself; only several make a version-5 document.
      links: links.length > 1 ? links : [],
      kind: d.kind,
      issuedOn: isoDay(d.issuedOn),
      originalName: d.originalName,
    });
  });
}
