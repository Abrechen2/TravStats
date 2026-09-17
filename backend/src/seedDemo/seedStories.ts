import { prisma } from "../db";
import type { AirportRow } from "../seedDemoAccount";
import { calculateCo2Kg } from "../services/co2Calculator";
import { linkRowsFor, resolveCompanions } from "../services/companionService";
import { getBaseCurrency } from "../services/fx/snapshot";
import { stopTimesForDay } from "./cruiseTiming";
import { seedFxColumns } from "./stayFx";
import { airportByIata, curatedIdIfPresent, portIdByLocode, shipByName } from "./lookup";
import { seedTour } from "./seedTours";
import { STORIES, type Story } from "./stories";

const nightsBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

async function seedStory(userId: string, story: Story, airports: Map<string, AirportRow>): Promise<void> {
  const planned = story.status === "planned";
  const trip = await prisma.trip.create({
    data: {
      userId, name: story.name, description: story.description, color: story.color, icon: story.icon,
      status: story.status, category: story.category, startDate: new Date(story.start), endDate: new Date(story.end),
      originLabel: story.origin, destinationLabel: story.destination, countries: story.countries,
      tags: story.tags, companions: story.companions,
    },
  });
  const companions = await resolveCompanions(userId, story.companions);
  if (companions.length > 0) {
    await prisma.tripCompanion.createMany({
      data: linkRowsFor(companions.map((c) => c.id)).map((l) => ({ tripId: trip.id, companionId: l.companionId, position: l.position })),
      skipDuplicates: true,
    });
  }

  for (const f of story.flights) {
    const dep = airportByIata(airports, f.from);
    const arr = airportByIata(airports, f.to);
    const flight = await prisma.flight.create({
      data: {
        userId, tripId: trip.id, airline: f.airline, flightNumber: f.flightNumber,
        depIcao: dep.icao, depIata: dep.iata, depName: dep.name, depLat: dep.lat, depLon: dep.lon,
        arrIcao: arr.icao, arrIata: arr.iata, arrName: arr.name, arrLat: arr.lat, arrLon: arr.lon,
        departureTime: new Date(f.departure), arrivalTime: new Date(f.arrival),
        status: planned ? "scheduled" : "flown", seatClass: "economy", category: "vacation",
        companions: story.companions, tags: story.tags, dataSource: "manual", lastModifiedBy: "user",
        co2Kg: calculateCo2Kg({ depLat: dep.lat, depLon: dep.lon, arrLat: arr.lat, arrLon: arr.lon, seatClass: "economy" }),
      },
    });
    // Dual write, same as seedDemoAccount.ts's linkFlightCompanions: without
    // the join rows a seeded instance shows companion chips (from the
    // denormalized array above) but an empty suggestion list.
    if (companions.length > 0) {
      await prisma.flightCompanion.createMany({
        data: linkRowsFor(companions.map((c) => c.id)).map((l) => ({ flightId: flight.id, companionId: l.companionId, position: l.position })),
        skipDuplicates: true,
      });
    }
  }

  // See seedBulk: a priced stay with no snapshot into the base currency is a
  // stay the money statistics report as "not converted" (finding B4).
  const baseCurrency = story.stays.length > 0 ? await getBaseCurrency(userId) : "EUR";
  for (const s of story.stays) {
    const lodging = await prisma.lodging.create({
      data: {
        userId, type: s.type, name: s.name, city: s.city, country: s.country, isoCountryCode: s.iso,
        // `visited: true` for every booked stay, planned or past. The flag
        // separates a house the user BOOKED from one they merely bookmarked;
        // whether the stay has happened is the DATES' answer, and
        // `classifyStay`/`classifyLodging` read them. Writing `!planned` here
        // made the planned Portugal hotels bookmarks, which count nowhere at
        // all (finding B3, independent review 2026-09-17).
        lat: s.lat, lon: s.lon, stars: s.stars, visited: true, dataSource: "manual",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id, userId, tripId: trip.id, checkIn: new Date(s.checkIn), checkOut: new Date(s.checkOut),
        nights: nightsBetween(s.checkIn, s.checkOut), status: planned ? "scheduled" : "completed", board: s.board,
        guests: 1 + story.companions.length, currency: s.currency, totalPrice: s.price,
        ...seedFxColumns({ totalPrice: s.price, currency: s.currency, checkIn: new Date(s.checkIn) }, baseCurrency),
        ratingOverall: s.rating, companions: story.companions, dataSource: "manual",
      },
    });
  }

  for (const [orderIdx, p] of story.places.entries()) {
    const curatedItemId = p.curatedId ? await curatedIdIfPresent(p.curatedId) : null;
    const place = await prisma.place.create({
      data: {
        userId, name: p.name, category: p.category, lat: p.lat, lon: p.lon, city: p.city, country: p.country,
        isoCountryCode: p.iso, visited: p.visitedAt !== null, curatedItemId, dataSource: curatedItemId ? "curated" : "manual",
      },
    });
    if (p.visitedAt) {
      await prisma.placeVisit.create({
        data: { placeId: place.id, userId, tripId: trip.id, visitedAt: new Date(p.visitedAt), orderIdx, rating: p.rating },
      });
    }
  }

  if (story.cruise) {
    const c = story.cruise;
    const ship = await shipByName(c.ship);
    const portIds: Array<number | null> = [];
    for (const stop of c.stops) portIds.push("locode" in stop ? await portIdByLocode(stop.locode) : null);
    const firstPort = portIds.find((id) => id !== null) ?? null;
    const lastPort = [...portIds].reverse().find((id) => id !== null) ?? null;
    const cruise = await prisma.cruise.create({
      data: {
        userId, tripId: trip.id, shipId: ship.id, cruiseLine: ship.cruiseLine, departurePortId: firstPort, arrivalPortId: lastPort,
        startDate: new Date(c.start), endDate: new Date(c.end), status: planned ? "scheduled" : "flown",
        cabinType: c.cabinType, price: c.price, currency: "EUR", companions: story.companions, tags: story.tags, dataSource: "manual",
      },
    });
    // Same dual write as seedCruises's per-cruise cruiseCompanion.createMany.
    if (companions.length > 0) {
      await prisma.cruiseCompanion.createMany({
        data: linkRowsFor(companions.map((c) => c.id)).map((l) => ({ cruiseId: cruise.id, companionId: l.companionId, position: l.position })),
        skipDuplicates: true,
      });
    }
    const cruiseStart = new Date(c.start);
    const cruiseEnd = new Date(c.end);
    for (const [i, portId] of portIds.entries()) {
      // Times come from the stop's OWN day and are clamped to the cruise —
      // deriving them from the embarkation hour put the last stop after the
      // cruise had ended (finding B5, independent review 2026-09-17).
      const { arrivalTime, departureTime } = stopTimesForDay(cruiseStart, cruiseEnd, i);
      await prisma.cruiseStop.create({
        data: {
          cruiseId: cruise.id, dayNumber: i + 1, portId, isAtSea: portId === null,
          arrivalTime: portId === null ? null : arrivalTime,
          departureTime: portId === null ? null : departureTime,
        },
      });
    }
  }

  if (story.tour) await seedTour(trip.id, story.tour, 0);

  for (const j of story.journal) {
    await prisma.tripJournalEntry.create({
      data: { tripId: trip.id, date: new Date(j.date), title: j.title, body: j.body, mood: j.mood, weather: j.weather },
    });
  }
}

/** The narrated trips — each one coherent across flights, stays, places, tour and journal. */
export async function seedStories(userId: string, airports: Map<string, AirportRow>): Promise<number> {
  for (const story of STORIES) await seedStory(userId, story, airports);
  return STORIES.length;
}
