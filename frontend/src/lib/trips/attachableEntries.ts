import axios from "axios";

import { busApi } from "../api/bus";
import { cruiseApi } from "../api/cruise";
import { flightsApi } from "../api/flights";
import { listLodgings, updateStay } from "../api/lodging";
import { listPlaces, updateVisit } from "../api/places";
import { railApi } from "../api/rail";
import { rentalApi } from "../api/rental";
import { roadtripsApi } from "../api/roadtrips";
import { toursApi } from "../api/tours";
import { tripsApi } from "../api/trips";
import { apiErrorCode, apiErrorMachineCode, DEMO_FORBIDDEN_CODE } from "../apiError";
import {
  cruiseEnd,
  cruiseStart,
  flightDeparture,
  railDeparture,
  stayCheckIn,
  stayCheckOut,
  visitTime,
} from "../entityTimes";
import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";
import { dayOf } from "../../shared/time";

/**
 * Existing logbook entries a trip can take in (forgejo#188).
 *
 * Until now an existing entry reached a trip only from its own side: open the
 * domain's logbook, find the entry, edit it, pick the trip. This is the other
 * direction — the trip asks each domain for its entries and files one.
 *
 * No endpoint was added for it. Every domain already accepts `tripId` on the
 * write its own form uses, with the ownership check in front
 * (`assertReferencesOwned`), so `attachEntry` below sends exactly what the
 * domain's own trip picker sends and nothing else.
 *
 * The rows are the ENTITIES a trip links to, complete: every flight, cruise,
 * rail journey, rental and roadtrip, every stay of every lodging, every visit
 * of every place. A house without a stay or a place without a visit has
 * nothing that could carry a trip; the loader counts those (`unlinkable`) so
 * the picker can say they are missing rather than look complete.
 */

/** The order the picker offers the domains in — `DOMAIN_KEYS`, all of them. */
export const ATTACHABLE_DOMAINS: readonly DomainKey[] = DOMAIN_KEYS;

export interface AttachableEntry {
  domain: DomainKey;
  /** The row that carries `tripId`: a stay for lodging, a visit for a place. */
  id: string;
  /** Lodging and place only: the parent the write path is nested under. */
  parentId?: string;
  title: string;
  subtitle: string | null;
  /** `YYYY-MM-DD` at the place, null when the entry cannot be dated. */
  day: string | null;
  /** Last day of a span (stay, cruise, rental, roadtrip); null otherwise. */
  endDay: string | null;
  tripId: string | null;
}

export interface AttachableLoad {
  entries: AttachableEntry[];
  /** Parents with no linkable row (a lodging without a stay, a place without a visit). */
  unlinkable: number;
}

const joined = (parts: Array<string | null | undefined>, separator: string): string | null => {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(separator) : null;
};

const dayPart = (value: string | null | undefined): string | null =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

async function loadFlights(): Promise<AttachableLoad> {
  const flights = await flightsApi.getEvery();
  return {
    unlinkable: 0,
    entries: flights.map((f) => {
      const departure = flightDeparture(f);
      return {
        domain: "flight" as const,
        id: f.id,
        title:
          joined(
            [f.depIata ?? f.depIcao ?? f.depName, f.arrIata ?? f.arrIcao ?? f.arrName],
            " → "
          ) ?? f.flightNumber,
        subtitle: joined([f.airline, f.flightNumber], " · "),
        day: departure ? dayOf(departure) : null,
        endDay: null,
        tripId: f.tripId ?? null,
      };
    }),
  };
}

async function loadCruises(): Promise<AttachableLoad> {
  const cruises = await cruiseApi.list();
  return {
    unlinkable: 0,
    entries: cruises.map((c) => {
      const ship = c.ship?.name ?? c.shipNameOverride;
      const ports = joined([c.departurePort?.name, c.arrivalPort?.name], " → ");
      return {
        domain: "cruise" as const,
        id: c.id,
        title: joined([ship, c.routeName], " · ") ?? ports ?? c.cruiseLine ?? c.id,
        subtitle: ship || c.routeName ? ports : c.cruiseLine,
        day: cruiseStart(c)?.date ?? null,
        endDay: cruiseEnd(c)?.date ?? null,
        tripId: c.tripId,
      };
    }),
  };
}

async function loadStays(): Promise<AttachableLoad> {
  const lodgings = await listLodgings();
  return {
    unlinkable: lodgings.filter((l) => l.stays.length === 0).length,
    entries: lodgings.flatMap((l) =>
      l.stays.map((s) => ({
        domain: "lodging" as const,
        id: s.id,
        parentId: l.id,
        title: l.name,
        subtitle: joined([l.city, l.country], ", "),
        day: stayCheckIn(s)?.date ?? null,
        endDay: stayCheckOut(s)?.date ?? null,
        tripId: s.tripId,
      }))
    ),
  };
}

async function loadVisits(): Promise<AttachableLoad> {
  const places = await listPlaces();
  return {
    unlinkable: places.filter((p) => p.visits.length === 0).length,
    entries: places.flatMap((p) =>
      p.visits.map((v) => {
        const at = visitTime(v);
        return {
          domain: "poi" as const,
          id: v.id,
          parentId: p.id,
          title: p.name,
          subtitle: joined([p.city, p.country], ", "),
          day: at ? dayOf(at) : null,
          endDay: null,
          tripId: v.tripId,
        };
      })
    ),
  };
}

async function loadRail(): Promise<AttachableLoad> {
  const journeys = await railApi.listAll();
  return {
    unlinkable: 0,
    entries: journeys.map((j) => {
      const departure = railDeparture(j);
      return {
        domain: "rail" as const,
        id: j.id,
        title: `${j.depStationName} → ${j.arrStationName}`,
        subtitle: joined([j.operator, joined([j.trainCategory, j.trainNumber], " ")], " · "),
        day: departure ? dayOf(departure) : null,
        endDay: null,
        tripId: j.tripId,
      };
    }),
  };
}

async function loadRentals(): Promise<AttachableLoad> {
  const rentals = await rentalApi.listAll();
  return {
    unlinkable: 0,
    entries: rentals.map((r) => ({
      domain: "rental" as const,
      id: r.id,
      title: joined([r.provider, r.vehicleClass], " · ") ?? r.pickupStationName,
      subtitle:
        r.pickupStationName === r.returnStationName
          ? r.pickupStationName
          : `${r.pickupStationName} → ${r.returnStationName}`,
      day: r.times.pickup ? dayOf(r.times.pickup) : null,
      endDay: r.times.return ? dayOf(r.times.return) : null,
      tripId: r.tripId,
    })),
  };
}

async function loadRoadtrips(): Promise<AttachableLoad> {
  const roadtrips = await roadtripsApi.list();
  return {
    unlinkable: 0,
    entries: roadtrips.map((r) => ({
      domain: "roadtrip" as const,
      id: r.id,
      title: r.name,
      subtitle: r.vehicleName,
      day: dayPart(r.startDate),
      endDay: dayPart(r.endDate),
      tripId: r.tripId,
    })),
  };
}

async function loadBus(): Promise<AttachableLoad> {
  const rides = await busApi.listAll();
  return {
    unlinkable: 0,
    entries: rides.map((r) => {
      const departure = railDeparture(r);
      return {
        domain: "bus" as const,
        id: r.id,
        title: `${r.depStationName} → ${r.arrStationName}`,
        subtitle: joined([r.operator, r.lineName], " · "),
        day: departure ? dayOf(departure) : null,
        endDay: null,
        tripId: r.tripId,
      };
    }),
  };
}

const LOADERS: Record<DomainKey, () => Promise<AttachableLoad>> = {
  flight: loadFlights,
  cruise: loadCruises,
  lodging: loadStays,
  poi: loadVisits,
  rail: loadRail,
  rental: loadRentals,
  roadtrip: loadRoadtrips,
  bus: loadBus,
};

/** Every linkable entry of one domain, newest first, undated ones last. */
export async function loadAttachableEntries(domain: DomainKey): Promise<AttachableLoad> {
  const load = await LOADERS[domain]();
  return {
    ...load,
    entries: [...load.entries].sort((a, b) => {
      if (a.day === b.day) return a.title.localeCompare(b.title);
      if (a.day === null) return 1;
      if (b.day === null) return -1;
      return a.day < b.day ? 1 : -1;
    }),
  };
}

/**
 * File one entry in a trip, through the write its own domain form uses.
 * An entry that sat in another trip moves: `tripId` holds one trip.
 */
export async function attachEntry(tripId: string, entry: AttachableEntry): Promise<void> {
  switch (entry.domain) {
    case "flight":
      await tripsApi.assignFlights(tripId, { flightIds: [entry.id], action: "add" });
      return;
    case "cruise":
      await cruiseApi.update(entry.id, { tripId });
      return;
    case "lodging":
      await updateStay(entry.parentId ?? "", entry.id, { tripId });
      return;
    case "poi":
      await updateVisit(entry.id, { tripId });
      return;
    case "rail":
      await railApi.update(entry.id, { tripId });
      return;
    case "rental":
      await rentalApi.update(entry.id, { tripId });
      return;
    case "roadtrip":
      // The standalone path: a roadtrip is addressed by its own id, whichever
      // trip (or none) it sits in now.
      await toursApi.update(undefined, entry.id, { tripId });
      return;
    case "bus":
      await busApi.update(entry.id, { tripId });
      return;
  }
}

/**
 * Why an attach (or a domain's list) failed — a closed vocabulary the picker
 * maps to DE/EN copy under `trips:addExisting.failure.*`. The server's own
 * sentence is English and is never shown.
 */
export const ATTACH_FAILURES = [
  "network",
  "timeout",
  "notFound",
  "demo",
  "readOnly",
  "roadtripPhotos",
  "conflict",
  "invalid",
  "rateLimited",
  "server",
] as const;
export type AttachFailure = (typeof ATTACH_FAILURES)[number];

export function attachFailureReason(error: unknown): AttachFailure {
  if (!axios.isAxiosError(error)) return "server";
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "timeout";
  const status = error.response?.status;
  if (status === undefined) return "network";
  if (status === 404) return "notFound";
  if (status === 403) return apiErrorCode(error) === DEMO_FORBIDDEN_CODE ? "demo" : "readOnly";
  if (status === 409) {
    return apiErrorMachineCode(error) === "ROADTRIP_HAS_TRIP_PHOTOS"
      ? "roadtripPhotos"
      : "conflict";
  }
  if (status === 429) return "rateLimited";
  if (status === 400 || status === 422) return "invalid";
  return "server";
}
