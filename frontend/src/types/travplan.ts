/**
 * Travel planning contract v2. No planned record is travel evidence.
 *
 * Mirrored byte for byte at `frontend/src/types/travplan.ts` (and back):
 * change both together. The frontend used to import this file across the
 * tree boundary, which the Docker build had to copy into the frontend stage;
 * `travplanTypesMirror.test.ts` holds the two copies equal instead.
 */
export type PlanKind =
  | "activity"
  | "flight"
  | "hotel"
  | "rail"
  | "bus"
  | "ferry"
  | "cruise"
  | "rental"
  | "transfer"
  | "free";
export interface PlanItem {
  id: string;
  title: string;
  kind: PlanKind;
  day: string | null;
  time: string | null;
  duration: number | null;
  timezone: string | null;
  place: string;
  note: string;
  booked: boolean;
  bookingId: string | null;
  stationId: string | null;
  execution: "unconfirmed" | "confirmed" | "skipped" | "cancelled";
  source: {
    kind: string;
    id: string;
    version?: string;
    bookingVersion?: string;
    auxId?: string;
    auxVersion?: string;
    createdAux?: boolean;
  } | null;
}
export interface PlanIdea {
  id: string;
  title: string;
  category: string;
  priority: "must" | "optional" | "maybe";
  note: string;
  itemId: string | null;
}
export interface PlanBooking {
  actualBookingId?: string | null;
  priceGroupId?: string | null;
  id: string;
  kind: PlanKind;
  title: string;
  reference: string | null;
  provider: string;
  day: string | null;
  endDay: string | null;
  time: string | null;
  timezone: string | null;
  arrivalDay?: string | null;
  arrivalTime?: string | null;
  arrivalTimezone?: string | null;
  originPlace?: string;
  overnight?: boolean;
  amount: number | null;
  paid: number;
  currency: string;
  place: string;
  city?: string;
  country?: string;
  address?: string;
  documentIds: string[];
  source: string;
  details: Record<string, unknown>;
  placeholder: boolean;
  estimate: { amount: number; currency: string } | null;
  stageId: string | null;
}
export interface PlanTransfer {
  id: string;
  fromId: string;
  toId: string;
  status: "open" | "organized" | "conscious";
  mode: string;
  note: string;
  duration: number | null;
  buffer: number;
  fingerprint: string | null;
}
export interface PlanPacking {
  id: string;
  label: string;
  category: string;
  quantity: number;
  packed: boolean;
  scope: "personal" | "shared";
  note: string;
  manual: boolean;
}
export interface PlanTask {
  id: string;
  title: string;
  due: string | null;
  done: boolean;
}
export interface PlanCost {
  id: string;
  title: string;
  amount: number | null;
  currency: string;
  paid: number;
  kind: "estimate" | "booked";
}
export interface PlanDecision {
  id: string;
  fingerprint: string;
  choice: "conscious" | "dismissed";
  decidedAt: string;
}
export interface PlanForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  source: string;
  fetchedAt: string;
  days: {
    day: string;
    min: number | null;
    max: number | null;
    rainProbability: number | null;
    wind: number | null;
  }[];
}
export interface PlanPlace {
  name: string;
  lat: number;
  lon: number;
  country: string | null;
  zone: string | null;
  ref: { kind: "port" | "geo" | "place"; id: string } | null;
}
export interface PlanNightCandidate {
  id: string;
  title: string;
  place: PlanPlace | null;
  url: string | null;
  note: string;
}
export type PlanNight =
  | { kind: "booked"; bookingId: string }
  | { kind: "idea"; candidates: PlanNightCandidate[] }
  | { kind: "pitch" }
  | { kind: "spontaneous" }
  | { kind: "onboard" };
/** Array order is route order. */
export interface PlanStation {
  id: string;
  title: string;
  place: PlanPlace;
  nights: number;
  pinnedDay: string | null;
  night: PlanNight;
  note: string;
}
export interface PlanStage {
  id: string;
  fromStationId: string;
  toStationId: string;
  mode: "drive" | "ferry" | "rail" | "flight" | "other";
  departDay: string | null;
  departTime: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  metricsSource: "routed" | "straight" | "user" | "booking" | null;
  fallbackReason: string | null;
  bookingId: string | null;
  overnight: boolean;
  note: string;
}
export interface PlanVariant {
  id: string;
  name: string;
  stations: PlanStation[];
  stages: PlanStage[];
}
export interface PlanVehicle {
  kind: "motorhome" | "campervan" | "caravan" | "car" | "motorcycle" | "bicycle" | "other";
  lengthM: number | null;
  consumptionPer100: number | null;
  fuelPrice: number | null;
  fuelCurrency: string | null;
}
export interface PlanStationWeather {
  stationId: string;
  kind: "forecast" | "climate";
  source: string;
  fetchedAt: string;
  window: string | null;
  days: {
    day: string;
    min: number | null;
    max: number | null;
    rainProbability: number | null;
    precipitationMm: number | null;
  }[];
}
export interface PlanState {
  version: 2;
  shape: "stay" | "route";
  creationHash?: string | null;
  destination: string;
  startDay: string | null;
  endDay: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  travelers: number;
  pace: "relaxed" | "balanced" | "busy";
  budget: number | null;
  currency: string;
  freeDays: string[];
  openNights: string[];
  status: "planning" | "ready" | "archived";
  handoverRevision: number | null;
  ai: { enabled: boolean; policy: "local_only" | "cloud_allowed" };
  packingProfile: { washing: "unknown" | "yes" | "no"; luggage: "unknown" | "cabin" | "checked" };
  items: PlanItem[];
  ideas: PlanIdea[];
  bookings: PlanBooking[];
  transfers: PlanTransfer[];
  packing: PlanPacking[];
  tasks: PlanTask[];
  costs: PlanCost[];
  decisions: PlanDecision[];
  forecast: PlanForecast | null;
  stations: PlanStation[];
  stages: PlanStage[];
  variants: PlanVariant[];
  activeVariantName: string;
  vehicle: PlanVehicle | null;
  roadtripId: string | null;
  stationLinks: { stationId: string; tripStopId: string }[];
  stationWeather: PlanStationWeather[];
}
export interface PlanFinding {
  id: string;
  fingerprint: string;
  code: string;
  severity: "info" | "attention";
  section: string;
  params: Record<string, string | number>;
}
export interface PlanBudget {
  currency: string;
  booked: number;
  estimates: number;
  paid: number;
  due: number | null;
  total: number;
  remaining: number | null;
  unknown: number;
  otherCurrencies: string[];
}
export interface PlanProposal {
  id: string;
  baseRevision: number;
  status: string;
  provider: string;
  model: string;
  expiresAt: string;
  content: {
    summary: string;
    ideas?: { title: string; note: string; category: string }[];
    assumptions: string[];
    changes: { id: string; day: string | null; time: string | null; reason: string }[];
  };
}
export interface PlanView {
  id: string;
  tripId: string;
  name: string;
  revision: number;
  state: PlanState;
  findings: PlanFinding[];
  budget: PlanBudget;
  lastMutationId?: string;
}
export type PlanCollection =
  | "items"
  | "ideas"
  | "bookings"
  | "transfers"
  | "packing"
  | "tasks"
  | "costs"
  | "stations"
  | "stages";
export type PlanOperation =
  | { type: "refresh_existing" }
  | { type: "link_actual"; id: string; sourceId: string }
  | {
      type: "settings";
      values: Partial<
        Pick<
          PlanState,
          | "destination"
          | "startDay"
          | "endDay"
          | "timezone"
          | "latitude"
          | "longitude"
          | "travelers"
          | "pace"
          | "budget"
          | "currency"
          | "freeDays"
          | "openNights"
          | "ai"
          | "packingProfile"
        >
      >;
      name?: string;
    }
  | { type: "upsert"; collection: PlanCollection; value: Record<string, unknown> }
  | { type: "remove"; collection: PlanCollection; id: string }
  | { type: "decision"; value: PlanDecision }
  | {
      type: "assign_idea";
      ideaId: string;
      day: string | null;
      time: string | null;
      duration: number | null;
    }
  | { type: "handover" }
  | { type: "execution"; id: string; execution: PlanItem["execution"] }
  | { type: "undo"; mutationId: string }
  | { type: "proposal"; proposalId: string };
export interface PlanWrite {
  clientRef: string;
  baseRevision: number;
  operation: PlanOperation;
}

/** The plan list carries no notes, documents or full itinerary payload. */
export interface PlanSummary {
  id: string;
  tripId: string;
  name: string;
  revision: number;
  destination: string;
  startDay: string | null;
  endDay: string | null;
  status: PlanState["status"];
  ideasCount: number;
  bookingsCount: number;
}
