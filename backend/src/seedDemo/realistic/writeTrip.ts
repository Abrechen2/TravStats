import { prisma } from "../../db";
import { linkRowsFor } from "../../services/companionService";
import { recomputeTripStatus } from "../../services/tripStatusService";
import { LODGINGS } from "./data/lodgings";
import { STATIONS } from "./data/stations";
import type { TripSpec } from "./data/types";
import { companionIds, type SeedContext } from "./context";
import { anchorDay, addDays } from "./time";
import { writeCruise } from "./writeCruise";
import { writePlaces, writeStays } from "./writeGround";
import { writeFlights, writeRail } from "./writeJourneys";
import { writeRoadtrip, writeTour } from "./writeRoutes";

export interface TripCounts {
  flights: number;
  rail: number;
  stays: number;
  visits: number;
  cruises: number;
  roadtrips: number;
  tours: number;
  tracks: number;
  journal: number;
}

/** The countries a trip touched, from what it knows for certain: beds, sights and stations. */
function countriesOf(spec: TripSpec): string[] {
  const iso = new Set<string>();
  for (const s of spec.stays ?? []) iso.add(LODGINGS[s.lodging].iso);
  for (const p of spec.places ?? []) if (p.d !== null) iso.add(p.iso);
  for (const r of spec.rail ?? []) iso.add(STATIONS[r.from].country).add(STATIONS[r.to].country);
  return [...iso].sort();
}

async function createTrip(ctx: SeedContext, spec: TripSpec, day: Date): Promise<string> {
  const trip = await prisma.trip.create({
    data: {
      userId: ctx.userId,
      name: spec.name,
      description: spec.description ?? null,
      color: spec.color,
      icon: spec.icon,
      category: spec.category,
      startDate: day,
      endDate: addDays(day, spec.days - 1),
      originLabel: spec.origin,
      destinationLabel: spec.destination,
      countries: countriesOf(spec),
      tags: [...(spec.tags ?? [])],
      companions: [...(spec.companions ?? [])],
      notes: spec.notes ?? null,
    },
  });
  const ids = companionIds(ctx, spec.companions);
  if (ids.length > 0) {
    await prisma.tripCompanion.createMany({
      data: linkRowsFor(ids).map((l) => ({ tripId: trip.id, ...l })),
      skipDuplicates: true,
    });
  }
  return trip.id;
}

/**
 * One trip and everything in it. An `ungrouped` spec writes its journeys and
 * stays without a trip row — the one gap the inbox is meant to find.
 */
export async function writeTrip(ctx: SeedContext, spec: TripSpec): Promise<TripCounts> {
  const day = anchorDay(spec.anchor, ctx.now);
  const tripId = spec.ungrouped ? null : await createTrip(ctx, spec, day);
  const companions = spec.companions ?? [];

  const flights = await writeFlights(
    ctx,
    tripId,
    day,
    spec.flights ?? [],
    companions,
    spec.category
  );
  const rail = await writeRail(ctx, tripId, day, spec.rail ?? [], companions);
  const stayIndex = await writeStays(ctx, tripId, day, spec.stays ?? [], companions);
  const visits = await writePlaces(ctx, tripId, day, spec.places ?? []);
  const cruises = spec.cruise
    ? (await writeCruise(ctx, tripId, day, spec.cruise, companions), 1)
    : 0;

  let roadtrips = 0;
  let tours = 0;
  let tracks = 0;
  if (tripId && spec.roadtrip) {
    await writeRoadtrip(ctx, spec.roadtrip, tripId, day, stayIndex);
    roadtrips++;
  }
  for (const ref of tripId ? (spec.tours ?? []) : []) {
    const stations = spec.roadtrip ? ctx.stationIdsByRoadtrip.get(spec.roadtrip) : undefined;
    const anchor = ref.anchorStation !== undefined ? (stations?.[ref.anchorStation] ?? null) : null;
    const written = await writeTour(ctx, ref.tour, tripId as string, day, anchor);
    tours++;
    tracks += written.tracks;
  }

  let journal = 0;
  if (tripId) {
    for (const entry of spec.journal ?? []) {
      await prisma.tripJournalEntry.create({
        data: {
          tripId,
          date: addDays(day, entry.d),
          title: entry.title,
          body: entry.body,
          mood: entry.mood ?? null,
          weather: entry.weather ?? null,
        },
      });
      journal++;
    }
    // The trip's own status from what it holds, by the service every write
    // path calls — never a status typed into the seed.
    await recomputeTripStatus(tripId);
  }
  return {
    flights,
    rail,
    stays: stayIndex.size,
    visits,
    cruises,
    roadtrips,
    tours,
    tracks,
    journal,
  };
}
