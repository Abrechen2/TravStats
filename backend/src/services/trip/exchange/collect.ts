/**
 * The trip → `trip.json` half of the `.travstats` writer. Reads the owner's
 * trip and everything filed on it; writes columns exactly as stored (ADR
 * 0002) and the private fields only when asked. Returns the files to pack
 * beside it, so the archive writer streams bytes it never has to look up.
 */
import path from "path";
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { getTripPhotoDir } from "../../../middleware/upload";
import { documentPath } from "../../documents/documentStore";
import type { EntityKind, ExportOptions, TripFile, TripFilePortRef } from "./format";

export interface PackedFile {
  /** The name inside the archive (`documents/d1.pdf`). */
  name: string;
  /** Where the bytes are on disk. */
  source: string;
}

export interface CollectedTrip {
  tripName: string;
  file: TripFile;
  files: PackedFile[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoDay = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** File-local keys per kind: the first flight is `f1`, whatever its id. */
function keyer(prefix: string): (id: string) => string {
  const keys = new Map<string, string>();
  return (id) => {
    let k = keys.get(id);
    if (!k) {
      k = `${prefix}${keys.size + 1}`;
      keys.set(id, k);
    }
    return k;
  };
}

const extensionOf = (name: string, fallback: string): string => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : fallback;
};

function portRef(
  port: {
    unlocode: string | null;
    name: string;
    country: string | null;
    lat: number;
    lon: number;
  } | null
): TripFilePortRef | null {
  return port
    ? {
        unlocode: port.unlocode,
        name: port.name,
        country: port.country,
        lat: port.lat,
        lon: port.lon,
      }
    : null;
}

const companionNames = (links: { companion: { displayName: string } }[], legacy: string[]) =>
  links.length > 0 ? links.map((l) => l.companion.displayName) : legacy;

const byPosition = { orderBy: { position: "asc" as const }, include: { companion: true } };

async function loadTrip(userId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      companionLinks: byPosition,
      bookings: { orderBy: { createdAt: "asc" } },
      flights: { orderBy: { departureTime: "asc" }, include: { companionLinks: byPosition } },
      lodgingStays: { orderBy: { checkIn: "asc" }, include: { lodging: true } },
      cruises: {
        orderBy: { startDate: "asc" },
        include: {
          ship: true,
          departurePort: true,
          arrivalPort: true,
          stops: { orderBy: { dayNumber: "asc" }, include: { port: true } },
          companionLinks: byPosition,
        },
      },
      railJourneys: {
        orderBy: { departureTime: "asc" },
        include: { depStation: true, arrStation: true, companionLinks: byPosition },
      },
      rentalBookings: {
        orderBy: { pickupTime: "asc" },
        include: { pickupAirport: true, returnAirport: true, companionLinks: byPosition },
      },
      placeVisits: { orderBy: { orderIdx: "asc" }, include: { place: true } },
      // Tour and roadtrip stations belong to their route, which this file does
      // not carry; mirrored entries (`sourceId`) are written as the entry itself.
      stops: { where: { routeId: null, sourceId: null }, orderBy: { orderIdx: "asc" } },
      journalEntries: { orderBy: { date: "asc" } },
      photos: { where: { immichAlbumLinkId: null }, orderBy: { sortIdx: "asc" } },
    },
  });
  // A stranger's trip is not a trip — the same 404 as an unknown id.
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  return trip;
}

type LoadedTrip = Awaited<ReturnType<typeof loadTrip>>;

function placesAndVisits(trip: LoadedTrip, priv: boolean) {
  const placeKey = keyer("p");
  const visitKey = keyer("v");
  const places = new Map<string, TripFile["places"][number]>();
  const addPlace = (p: NonNullable<LoadedTrip["placeVisits"][number]["place"]>): string => {
    const k = placeKey(p.id);
    if (!places.has(p.id)) {
      places.set(p.id, {
        key: k,
        name: p.name,
        localName: p.localName,
        category: p.category,
        lat: p.lat,
        lon: p.lon,
        address: p.address,
        city: p.city,
        country: p.country,
        isoCountryCode: p.isoCountryCode,
        externalRef: p.externalRef,
        wikidataId: p.wikidataId,
      });
    }
    return k;
  };
  const visits = trip.placeVisits.map((v) => ({
    key: visitKey(v.id),
    placeKey: addPlace(v.place),
    visitedAt: iso(v.visitedAt),
    visitedAtUtc: iso(v.visitedAtUtc),
    visitedZone: v.visitedZone,
    visitedPrecision: v.visitedPrecision,
    orderIdx: v.orderIdx,
    ...(priv ? { private: { notes: v.notes, rating: v.rating } } : {}),
  }));
  return { places, visits, visitKey, addPlace };
}

export async function collectTrip(
  userId: string,
  tripId: string,
  options: ExportOptions
): Promise<CollectedTrip> {
  const trip = await loadTrip(userId, tripId);
  const priv = options.private;
  const bookingKey = keyer("b");
  const flightKey = keyer("f");
  const stayKey = keyer("s");
  const cruiseKey = keyer("c");
  const railKey = keyer("r");
  const rentalKey = keyer("rt");
  const stopKey = keyer("st");
  const bk = (id: string | null) =>
    id && trip.bookings.some((b) => b.id === id) ? bookingKey(id) : null;

  const { places, visits, visitKey, addPlace } = placesAndVisits(trip, priv);
  const stopPlaces = await prisma.place.findMany({
    where: { id: { in: trip.stops.flatMap((s) => (s.placeId ? [s.placeId] : [])) }, userId },
  });

  const file: TripFile = {
    trip: {
      name: trip.name,
      description: trip.description,
      color: trip.color,
      icon: trip.icon,
      category: trip.category,
      tags: trip.tags,
      status: trip.status,
      startDate: iso(trip.startDate),
      endDate: iso(trip.endDate),
      startDay: isoDay(trip.startDay),
      endDay: isoDay(trip.endDay),
      startZone: trip.startZone,
      endZone: trip.endZone,
      originLabel: trip.originLabel,
      destinationLabel: trip.destinationLabel,
      countries: trip.countries,
      ...(priv
        ? {
            private: {
              notes: trip.notes,
              summary: trip.summary,
              companions: companionNames(trip.companionLinks, trip.companions),
            },
          }
        : {}),
    },
    // The booking's total is a fact of the booking, shown to everyone on it
    // (decision 2); an entry's OWN price share is private, below.
    bookings: trip.bookings.map((b) => ({
      key: bookingKey(b.id),
      pnr: b.pnr,
      price: b.price,
      currency: b.currency,
    })),
    flights: trip.flights.map((f) => ({
      key: flightKey(f.id),
      bookingKey: bk(f.bookingId),
      externalRef: f.externalRef,
      flightNumber: f.flightNumber,
      airline: f.airline,
      airlineIata: f.airlineIata,
      airlineIcao: f.airlineIcao,
      operatingAirline: f.operatingAirline,
      operatingAirlineIata: f.operatingAirlineIata,
      operatingAirlineIcao: f.operatingAirlineIcao,
      aircraft: f.aircraft,
      aircraftRegistration: f.aircraftRegistration,
      depIata: f.depIata,
      depIcao: f.depIcao,
      depName: f.depName,
      depLat: f.depLat,
      depLon: f.depLon,
      arrIata: f.arrIata,
      arrIcao: f.arrIcao,
      arrName: f.arrName,
      arrLat: f.arrLat,
      arrLon: f.arrLon,
      departureTime: iso(f.departureTime),
      arrivalTime: iso(f.arrivalTime),
      depTimezone: f.depTimezone,
      arrTimezone: f.arrTimezone,
      depTimeSemantics: f.depTimeSemantics,
      arrTimeSemantics: f.arrTimeSemantics,
      depPrecision: f.depPrecision,
      arrPrecision: f.arrPrecision,
      status: f.status,
      specialType: f.specialType,
      ...(priv
        ? {
            private: {
              seatNumber: f.seatNumber,
              seatClass: f.seatClass,
              boardingGroup: f.boardingGroup,
              ticketNumber: f.ticketNumber,
              frequentFlyerNumber: f.frequentFlyerNumber,
              bookingClassLetter: f.bookingClassLetter,
              notes: f.notes,
              price: f.price,
              currency: f.currency,
              companions: companionNames(f.companionLinks, f.companions),
            },
          }
        : {}),
    })),
    stays: trip.lodgingStays.map((s) => ({
      key: stayKey(s.id),
      bookingKey: bk(s.bookingId),
      externalRef: s.externalRef,
      lodging: {
        type: s.lodging.type,
        name: s.lodging.name,
        address: s.lodging.address,
        city: s.lodging.city,
        country: s.lodging.country,
        isoCountryCode: s.lodging.isoCountryCode,
        lat: s.lodging.lat,
        lon: s.lodging.lon,
        stars: s.lodging.stars,
        website: s.lodging.website,
        wikidataId: s.lodging.wikidataId,
        externalRef: s.lodging.externalRef,
      },
      checkIn: iso(s.checkIn),
      checkOut: iso(s.checkOut),
      checkInTime: s.checkInTime,
      checkOutTime: s.checkOutTime,
      checkInDate: isoDay(s.checkInDate),
      checkOutDate: isoDay(s.checkOutDate),
      checkInAt: iso(s.checkInAt),
      checkOutAt: iso(s.checkOutAt),
      stayZone: s.stayZone,
      datePrecision: s.datePrecision,
      nights: s.nights,
      status: s.status,
      board: s.board,
      roomCategory: s.roomCategory,
      guests: s.guests,
      ...(priv
        ? {
            private: {
              roomNumber: s.roomNumber,
              ratingRoom: s.ratingRoom,
              ratingBreakfast: s.ratingBreakfast,
              ratingService: s.ratingService,
              ratingOverall: s.ratingOverall,
              pricePerNight: s.pricePerNight,
              totalPrice: s.totalPrice,
              currency: s.currency,
              notes: s.notes,
              companions: s.companions,
            },
          }
        : {}),
    })),
    cruises: trip.cruises.map((c) => ({
      key: cruiseKey(c.id),
      bookingKey: bk(c.bookingId),
      externalRef: c.externalRef,
      bookingReference: c.bookingReference,
      ship: c.ship ? { name: c.ship.name, imo: c.ship.imo, cruiseLine: c.ship.cruiseLine } : null,
      shipNameOverride: c.shipNameOverride,
      cruiseLine: c.cruiseLine,
      routeName: c.routeName,
      departurePort: portRef(c.departurePort),
      arrivalPort: portRef(c.arrivalPort),
      startDate: iso(c.startDate),
      endDate: iso(c.endDate),
      startDay: isoDay(c.startDay),
      endDay: isoDay(c.endDay),
      startZone: c.startZone,
      endZone: c.endZone,
      status: c.status,
      stops: c.stops.map((s) => ({
        dayNumber: s.dayNumber,
        date: iso(s.date),
        isAtSea: s.isAtSea,
        port: portRef(s.port),
        unresolvedPortName: s.unresolvedPortName,
        arrivalTime: iso(s.arrivalTime),
        departureTime: iso(s.departureTime),
        arrivalUtc: iso(s.arrivalUtc),
        departureUtc: iso(s.departureUtc),
        stopZone: s.stopZone,
        stopDate: isoDay(s.stopDate),
        timePrecision: s.timePrecision,
      })),
      ...(priv
        ? {
            private: {
              cabinNumber: c.cabinNumber,
              cabinType: c.cabinType,
              deck: c.deck,
              price: c.price,
              currency: c.currency,
              notes: c.notes,
              companions: companionNames(c.companionLinks, c.companions),
            },
          }
        : {}),
    })),
    rail: trip.railJourneys.map((r) => ({
      key: railKey(r.id),
      bookingKey: bk(r.bookingId),
      externalRef: r.externalRef,
      operator: r.operator,
      trainCategory: r.trainCategory,
      trainNumber: r.trainNumber,
      bookingReference: r.bookingReference,
      dep: {
        name: r.depStationName,
        code: r.depStationCode,
        sourceId: r.depStation?.sourceId ?? null,
        lat: r.depLat,
        lon: r.depLon,
        country: r.depCountry,
        timezone: r.depTimezone,
      },
      arr: {
        name: r.arrStationName,
        code: r.arrStationCode,
        sourceId: r.arrStation?.sourceId ?? null,
        lat: r.arrLat,
        lon: r.arrLon,
        country: r.arrCountry,
        timezone: r.arrTimezone,
      },
      departureTime: r.departureTime.toISOString(),
      arrivalTime: iso(r.arrivalTime),
      depPrecision: r.depPrecision,
      arrPrecision: r.arrPrecision,
      distanceKm: r.distanceKm,
      distanceSource: r.distanceSource,
      status: r.status,
      ...(priv
        ? {
            private: {
              travelClass: r.travelClass,
              coach: r.coach,
              seat: r.seat,
              price: r.price,
              currency: r.currency,
              notes: r.notes,
              companions: companionNames(r.companionLinks, r.companions),
            },
          }
        : {}),
    })),
    rentals: trip.rentalBookings.map((r) => ({
      key: rentalKey(r.id),
      externalRef: r.externalRef,
      provider: r.provider,
      operatedBy: r.operatedBy,
      broker: r.broker,
      confirmationNumber: r.confirmationNumber,
      pickup: {
        stationName: r.pickupStationName,
        address: r.pickupAddress,
        airportIata: r.pickupAirport?.iata ?? null,
        lat: r.pickupLat,
        lon: r.pickupLon,
        country: r.pickupCountry,
        timezone: r.pickupTimezone,
      },
      return: {
        stationName: r.returnStationName,
        address: r.returnAddress,
        airportIata: r.returnAirport?.iata ?? null,
        lat: r.returnLat,
        lon: r.returnLon,
        country: r.returnCountry,
        timezone: r.returnTimezone,
      },
      pickupTime: r.pickupTime.toISOString(),
      returnTime: r.returnTime.toISOString(),
      pickupPrecision: r.pickupPrecision,
      returnPrecision: r.returnPrecision,
      vehicleClass: r.vehicleClass,
      acrissCode: r.acrissCode,
      vehicleExample: r.vehicleExample,
      mileagePolicy: r.mileagePolicy,
      mileageCapKm: r.mileageCapKm,
      fuelPolicy: r.fuelPolicy,
      paymentTiming: r.paymentTiming,
      inclusions: r.inclusions,
      arrivalFlightNumber: r.arrivalFlightNumber,
      status: r.status,
      ...(priv
        ? {
            private: {
              brokerReference: r.brokerReference,
              agreementNumber: r.agreementNumber,
              invoiceNumber: r.invoiceNumber,
              vehicleDriven: r.vehicleDriven,
              licensePlate: r.licensePlate,
              odometerOutKm: r.odometerOutKm,
              odometerInKm: r.odometerInKm,
              price: r.price,
              currency: r.currency,
              finalAmount: r.finalAmount,
              finalCurrency: r.finalCurrency,
              notes: r.notes,
              companions: companionNames(r.companionLinks, r.companions),
            },
          }
        : {}),
    })),
    places: [],
    visits,
    stops: [],
    documents: [],
    photos: [],
  };

  const stopPlaceById = new Map(stopPlaces.map((p) => [p.id, p]));
  file.stops = trip.stops.map((s) => {
    const place = s.placeId ? stopPlaceById.get(s.placeId) : undefined;
    return {
      key: stopKey(s.id),
      orderIdx: s.orderIdx,
      title: s.title,
      description: s.description,
      startDate: iso(s.startDate),
      endDate: iso(s.endDate),
      startUtc: iso(s.startUtc),
      endUtc: iso(s.endUtc),
      stopZone: s.stopZone,
      precision: s.precision,
      lat: s.lat,
      lon: s.lon,
      overnight: s.overnight,
      placeKey: place ? addPlace(place) : null,
      stayKey:
        s.lodgingStayId && trip.lodgingStays.some((st) => st.id === s.lodgingStayId)
          ? stayKey(s.lodgingStayId)
          : null,
      ...(priv ? { private: { notes: s.notes } } : {}),
    };
  });
  file.places = [...places.values()];
  if (priv) {
    file.journal = trip.journalEntries.map((j) => ({
      date: j.date.toISOString(),
      day: isoDay(j.day),
      title: j.title,
      body: j.body,
      mood: j.mood,
      weather: j.weather,
    }));
  }

  const files: PackedFile[] = [];
  if (options.photos) {
    trip.photos.forEach((p, i) => {
      const name = `photos/p${i + 1}.${extensionOf(p.filename, "jpg")}`;
      files.push({ name, source: path.join(getTripPhotoDir(), path.basename(p.filename)) });
      file.photos.push({
        file: name,
        caption: p.caption,
        takenAt: iso(p.takenAt),
        lat: p.lat,
        lon: p.lon,
        sortIdx: p.sortIdx,
        stopKey: p.stopId && trip.stops.some((s) => s.id === p.stopId) ? stopKey(p.stopId) : null,
      });
    });
  }
  if (options.documents) {
    await collectDocuments(userId, trip, file, files, {
      flight: flightKey,
      stay: stayKey,
      cruise: cruiseKey,
      rail: railKey,
      rental: rentalKey,
      visit: visitKey,
    });
  }
  return { tripName: trip.name, file, files };
}

async function collectDocuments(
  userId: string,
  trip: LoadedTrip,
  file: TripFile,
  files: PackedFile[],
  keys: Record<Exclude<EntityKind, "trip">, (id: string) => string>
): Promise<void> {
  const ids = <T extends { id: string }>(list: T[]) => list.map((e) => e.id);
  const documents = await prisma.document.findMany({
    where: {
      userId,
      OR: [
        { tripId: trip.id },
        { flightId: { in: ids(trip.flights) } },
        { lodgingStayId: { in: ids(trip.lodgingStays) } },
        { cruiseId: { in: ids(trip.cruises) } },
        { railJourneyId: { in: ids(trip.railJourneys) } },
        { rentalBookingId: { in: ids(trip.rentalBookings) } },
        { placeVisitId: { in: ids(trip.placeVisits) } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  documents.forEach((d, i) => {
    const entity: TripFile["documents"][number]["entity"] = d.flightId
      ? { kind: "flight", key: keys.flight(d.flightId) }
      : d.lodgingStayId
        ? { kind: "stay", key: keys.stay(d.lodgingStayId) }
        : d.cruiseId
          ? { kind: "cruise", key: keys.cruise(d.cruiseId) }
          : d.railJourneyId
            ? { kind: "rail", key: keys.rail(d.railJourneyId) }
            : d.rentalBookingId
              ? { kind: "rental", key: keys.rental(d.rentalBookingId) }
              : d.placeVisitId
                ? { kind: "visit", key: keys.visit(d.placeVisitId) }
                : { kind: "trip", key: null };
    const name = `documents/d${i + 1}.${extensionOf(d.storedName, "bin")}`;
    files.push({ name, source: documentPath(d.storedName) });
    file.documents.push({
      file: name,
      entity,
      kind: d.kind,
      issuedOn: isoDay(d.issuedOn),
      originalName: d.originalName,
    });
  });
}
