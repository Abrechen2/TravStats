/** Explicit acyclic travel graph. No User/Settings/auth/operational tables are traversed. */
export interface NodeSpec {
  model: string;
  domain?: string;
  category?: "personal" | "photos" | "documents" | "costs";
  date?: string;
  zone?: string;
  /** Column values a row must carry to leave its owner at all, whatever the grant says. */
  only?: Record<string, string>;
  relations?: Record<string, NodeSpec>;
}
const companion: NodeSpec = { model: "Companion", category: "personal" };
const links = (model: string): NodeSpec => ({
  model,
  category: "personal",
  relations: { companion },
});
const place: NodeSpec = { model: "Place" };
const port: NodeSpec = { model: "Port" };
const lodging: NodeSpec = {
  model: "Lodging",
  relations: {
    chain: { model: "LodgingChain" },
    photos: { model: "LodgingPhoto", category: "photos" },
  },
};
export const TRAVEL_GRAPH: Record<string, NodeSpec> = {
  flights: {
    model: "Flight",
    domain: "flight",
    date: "departureTime",
    zone: "depTimezone",
    relations: { track: { model: "FlightTrack" }, companionLinks: links("FlightCompanion") },
  },
  cruises: {
    model: "Cruise",
    domain: "cruise",
    date: "startDate",
    relations: {
      ship: { model: "Ship" },
      departurePort: port,
      arrivalPort: port,
      stops: { model: "CruiseStop", relations: { port } },
      legs: { model: "CruiseLeg", relations: { fromPort: port, toPort: port } },
      tracks: { model: "CruiseTrack" },
      legRoutes: { model: "CruiseLegRoute" },
      companionLinks: links("CruiseCompanion"),
    },
  },
  railJourneys: {
    model: "RailJourney",
    domain: "rail",
    date: "departureTime",
    zone: "depTimezone",
    relations: {
      depStation: { model: "RailStation" },
      arrStation: { model: "RailStation" },
      companionLinks: links("RailJourneyCompanion"),
    },
  },
  busJourneys: {
    model: "BusJourney",
    domain: "bus",
    date: "departureTime",
    zone: "depTimezone",
    relations: { companionLinks: links("BusJourneyCompanion") },
  },
  ferryJourneys: {
    model: "FerryJourney",
    domain: "ferry",
    date: "departureTime",
    zone: "depTimezone",
    relations: { companionLinks: links("FerryJourneyCompanion") },
  },
  rentalBookings: {
    model: "RentalBooking",
    domain: "rental",
    date: "pickupTime",
    zone: "pickupTimezone",
    relations: {
      pickupAirport: { model: "Airport" },
      returnAirport: { model: "Airport" },
      companionLinks: links("RentalBookingCompanion"),
    },
  },
  lodgingStays: {
    model: "LodgingStay",
    domain: "lodging",
    date: "checkInDate",
    relations: { lodging },
  },
  lodgings: { ...lodging, domain: "lodging" },
  lodgingChains: { model: "LodgingChain", domain: "lodging" },
  places: { ...place, domain: "poi" },
  placeExternalRefs: { model: "PlaceExternalRef", domain: "poi" },
  placeVisits: {
    model: "PlaceVisit",
    domain: "poi",
    date: "visitedAt",
    zone: "visitedZone",
    relations: { place, photos: { model: "PlaceVisitPhoto", category: "photos" } },
  },
  placeLists: {
    model: "PlaceList",
    domain: "poi",
    relations: { entries: { model: "PlaceListEntry", relations: { place } } },
  },
  tourRoutes: {
    model: "TripRoute",
    domain: "roadtrip",
    date: "tourDate",
    relations: {
      stops: { model: "TripStop", relations: { place } },
      legs: { model: "TripRouteLeg" },
      tracks: { model: "TripRouteTrack" },
    },
  },
  trips: {
    model: "Trip",
    date: "startDay",
    relations: {
      stops: { model: "TripStop", relations: { place } },
      journalEntries: {
        model: "TripJournalEntry",
        category: "personal",
        relations: {
          photos: {
            model: "JournalEntryPhoto",
            category: "photos",
            relations: { tripPhoto: { model: "TripPhoto", category: "photos" } },
          },
        },
      },
      photos: { model: "TripPhoto", category: "photos" },
      immichAlbums: { model: "TripImmichAlbum", category: "photos" },
      companionLinks: links("TripCompanion"),
    },
  },
  bookings: { model: "Booking" },
  tripExpenses: { model: "TripExpense", category: "costs", date: "date" },
  companions: companion,
  loyaltyMemberships: {
    model: "LoyaltyMembership",
    category: "personal",
    relations: {
      chains: { model: "LodgingMembershipChain", relations: { chain: { model: "LodgingChain" } } },
      lodgings: { model: "LodgingMembershipLodging", relations: { lodging } },
    },
  },
  documents: { model: "Document", category: "documents", date: "issuedOn" },
  // A private note never leaves its owner (forgejo#146); only a shareable one may be compared.
  notes: {
    model: "Note",
    category: "personal",
    date: "occurredAt",
    zone: "occurredZone",
    only: { visibility: "shareable" },
  },
  receiptUploads: { model: "ReceiptUpload", category: "documents" },
  countryDays: { model: "CountryDay", date: "date" },
  photoJourneys: { model: "PhotoJourney", date: "startDate" },
  dawarichStays: { model: "DawarichStay", date: "startAt", zone: "zone" },
  userAchievements: {
    model: "UserAchievement",
    relations: { achievement: { model: "Achievement" } },
  },
};

/** Non-travel User relations: credentials, configuration, workflow and delivery bookkeeping. */
export const NON_TRAVEL_RELATIONS = [
  "comparisonDevices",
  "comparisonPublications",
  "comparisonLinks",
  "comparisonAudits",
  "comparisonInvites",
  "comparisonGroups",
  "comparisonCircles",
  "devicePushes",
  "clientWriteRefs",
  // Per-day AI/weather limits are operational counters, not shared travel data.
  "travelPlanUsage",
  "twoFactorRecoveryCodes",
  "webauthnCredentials",
  "settings",
  "analyticsEvents",
  "createdInvitations",
  "usedInvitations",
  "trainingData",
  "parserTemplates",
  "pendingFlightUpdates",
  "pendingUpdateStats",
  "parseLogs",
  "apiTokens",
  "pairingCodes",
  "publicShareLinks",
  "visitPhotoRefusals",
  "importBatches",
  "linkedAsCompanion",
  "shareConsentsAsked",
  "shareConsentsGiven",
  "shareGroupsCreated",
  "shareNotices",
  "shareNoticesActed",
  "tripSuggestionAnswers",
  "dataQualityFlags",
  "dawarichStayScan",
  "dawarichSweepState",
  "passwordResetRequest",
] as const;
