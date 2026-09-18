/**
 * Evidence measures — Gesamt (cross-domain overview) tab: the KPI strip
 * (`CrossDomainKpis`) and the travel account (`TravelAccountSection`). See
 * `evidenceMeasures.ts` for what this file is part of and why it is split
 * out.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresCrossDomain.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const TRAVEL_ACCOUNT_CALCULATOR =
  "GET /stats/travel-account (services/stats/travelAccount.ts buildTravelAccount)";

export const CROSS_DOMAIN_MEASURES: Record<string, MeasureSpec> = {
  // ── CrossDomainKpis ──
  // Scope is recorded as `domainFiltered` for the whole tab: every number
  // here also depends on which domain chips are toggled on — the property
  // the design doc calls out by name for this surface specifically.
  crossDomainEventCount: {
    aggregation: "sum",
    unit: "events",
    scopes: ["domainFiltered"],
    surface: "OverviewTab, CrossDomainKpis",
    calculator:
      "frontend Overview/aggregate.ts aggregate() over lib/stats/domain-stats/*Adapter.ts",
    servedIn: 1,
  },
  crossDomainCountryCount: {
    aggregation: "distinct",
    unit: "countries",
    scopes: ["domainFiltered"],
    surface: "CrossDomainKpis",
    calculator:
      "frontend Overview/aggregate.ts aggregate() over lib/stats/domain-stats/*Adapter.ts",
    servedIn: 1,
  },
  crossDomainActiveDayCount: {
    aggregation: "distinct",
    unit: "days",
    scopes: ["domainFiltered"],
    surface: "CrossDomainKpis",
    calculator:
      "frontend Overview/aggregate.ts aggregate() over lib/stats/domain-stats/*Adapter.ts",
    servedIn: 1,
  },
  crossDomainUnlockedAchievementCount: {
    aggregation: "sum",
    unit: "achievements",
    scopes: ["domainFiltered"],
    surface: "CrossDomainKpis",
    calculator: "GET /achievements (utils/achievementWrites.ts)",
    // Achievement kind — release 2 regardless of its sum aggregation.
    servedIn: 2,
  },

  // ── TravelAccountSection ──
  travelAccountHotelNights: {
    aggregation: "sum",
    unit: "nights",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountSeaNights: {
    aggregation: "sum",
    unit: "nights",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountAirNights: {
    aggregation: "sum",
    unit: "nights",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountHomeNights: {
    aggregation: "sum",
    unit: "nights",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountContestedNights: {
    aggregation: "sum",
    unit: "nights",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountFullyCoveredTripCount: {
    aggregation: "sum",
    unit: "trips",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountTripsWithDatesCount: {
    aggregation: "sum",
    unit: "trips",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountUncoveredDayCount: {
    aggregation: "sum",
    unit: "days",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
  travelAccountAvgTripDays: {
    aggregation: "ratio",
    unit: "days",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 2,
  },
  travelAccountLongestTripDays: {
    aggregation: "extremum",
    unit: "days",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 2,
  },
  travelAccountJournalEntryCount: {
    aggregation: "sum",
    unit: "entries",
    scopes: ["allTime"],
    surface: "TravelAccountSection",
    calculator: TRAVEL_ACCOUNT_CALCULATOR,
    servedIn: 1,
  },
};
