import type { DataQualityFlag } from "../../../../types/dataQuality";
import type { TripSuggestion } from "../../../../types/tripSuggestion";
import type { PhotoJourney } from "../../../../types/photoJourney";
import type { PendingUpdate } from "../../../../lib/api/types";
import type { Trip } from "../../../../types";

export const flag: DataQualityFlag = {
  id: "flag1",
  entityType: "trip",
  entityId: "trip1",
  status: "open",
  kind: "trip_entries_outside",
  createdAt: "2026-10-13T00:00:00Z",
  resolvedAt: null,
  subject: {
    entityType: "trip",
    entityId: "trip1",
    label: "Lissabon",
    parentId: null,
    parentType: null,
    tripId: "trip1",
  },
  details: {
    startDay: "2026-09-12",
    endDay: "2026-09-16",
    entries: [
      {
        entityType: "flight",
        entityId: "flight1",
        parentId: null,
        label: "LIS → FRA",
        firstDay: "2026-09-17",
        lastDay: "2026-09-17",
      },
    ],
  },
};
export const suggestion: TripSuggestion = {
  id: "suggestion1",
  kind: "new_trip",
  startDay: "2026-10-01",
  endDay: "2026-10-04",
  nights: 3,
  planned: false,
  destination: "Wien",
  zoneUnknown: 0,
  signals: ["continuity"],
  members: [
    {
      key: "flight:flight2",
      domain: "flight",
      id: "flight2",
      label: "FRA → VIE",
      startDay: "2026-10-01",
      endDay: "2026-10-01",
      planned: false,
    },
  ],
};
export const trip = {
  id: "trip1",
  name: "Lissabon",
  startDate: "2026-09-12",
  endDate: "2026-09-16",
  flights: [{ id: "flight1" }],
  lodgingStays: [],
  stops: [],
} as unknown as Trip;
export const update: PendingUpdate = {
  id: "update1",
  flightId: "flight1",
  userId: "user",
  status: "pending",
  originalData: { gate: "A1", aircraft: "A320", terminal: "1", airline: "Lufthansa" },
  proposedData: { gate: "B2", aircraft: "A321", terminal: "2", airline: "Lufthansa City" },
  changes: ["gate", "aircraft", "terminal", "airline"].map((field) => ({
    field,
    type: "changed",
    oldValue: "old",
    newValue: "new",
  })),
  apiSource: "airlabs",
  fetchedAt: "2026-10-13T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
  flight: {
    id: "flight1",
    flightNumber: "LH1171",
    airline: "Lufthansa",
    depIata: "LIS",
    arrIata: "FRA",
    departureTime: "2026-09-17T17:40:00Z",
    arrivalTime: "2026-09-17T20:40:00Z",
  },
};
export const photo: PhotoJourney = {
  id: "photo1",
  kind: "trip",
  status: "pending",
  startDate: "2026-08-01T10:00:00Z",
  endDate: "2026-08-04T10:00:00Z",
  startDay: "2026-08-01",
  endDay: "2026-08-04",
  photoCount: 12,
  locatedCount: 10,
  lat: 48.2,
  lon: 16.3,
  countryCode: "AT",
  countryName: "Österreich",
  city: "Wien",
  previewAssetIds: [],
  placeId: null,
  distanceKm: null,
  nights: 3,
  airportIata: "VIE",
  spreadKm: null,
  createdTripId: null,
  createdPlaceVisitId: null,
  createdLodgingStayId: null,
  resolvedAt: null,
  createdAt: "2026-10-13T00:00:00Z",
};
