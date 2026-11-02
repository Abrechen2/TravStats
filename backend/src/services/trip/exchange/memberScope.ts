import type { TripFile } from "./format";

/**
 * What a remote guest may take from the plan's trip (spec §6.6, §6.7): the roadtrip with its
 * stations and legs, and only the stays and crossings those stations and legs name. Everything
 * else of the owner's trip — other flights, rides, cruises, rentals, places, visits, timeline
 * stops, journal, documents, photos — is left out, and so is every booking link: no PNR, no
 * booking reference, no price and no cost reaches a guest, because the `bookings` list is empty
 * and a kept entry carries no `bookingKey`, `externalRef` or `private` part.
 */
export function scopeFileForRemoteMember(file: TripFile): TripFile {
  const stayKeys = new Set(
    file.roadtrips.flatMap((r) => r.stations.flatMap((s) => (s.stayKey ? [s.stayKey] : [])))
  );
  const ferryKeys = new Set(
    file.roadtrips.flatMap((r) => r.legs.flatMap((l) => (l.ferryKey ? [l.ferryKey] : [])))
  );
  const { private: _tripPrivate, ...trip } = file.trip;
  return {
    trip: { ...trip, tags: [], description: null },
    bookings: [],
    flights: [],
    stays: file.stays
      .filter((s) => stayKeys.has(s.key))
      .map(({ private: _p, ...s }) => ({
        ...s,
        bookingKey: null,
        externalRef: null,
        lodging: { ...s.lodging, externalRef: null },
      })),
    cruises: [],
    rail: [],
    bus: [],
    ferry: file.ferry
      .filter((f) => ferryKeys.has(f.key))
      .map(({ private: _p, ...f }) => ({ ...f, bookingKey: null, externalRef: null })),
    rentals: [],
    places: [],
    visits: [],
    stops: [],
    roadtrips: file.roadtrips.map(({ private: _p, ...r }) => ({
      ...r,
      stations: r.stations.map(({ private: _s, ...s }) => s),
    })),
    documents: [],
    photos: [],
  };
}
