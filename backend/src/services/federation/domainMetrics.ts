import { loadRailStats } from "../rail/railStats";
import { loadBusStats } from "../bus/busStats";
import { rentalStatsFor } from "../rental/rentalStats";
import { loadCruiseStatsData } from "../stats/cruiseStatsData";
import { loadLodgingStatsData } from "../stats/lodgingStatsData";
import { calculateCruiseStats } from "../../utils/cruiseStats";
import { calculateLodgingStats } from "../../utils/lodgingStats";

/** Only named scalar metrics leave; the existing calculators' record IDs/rankings do not. */
export async function domainMetrics(
  userId: string,
  domains: string[],
  year: number | null,
  enabled: boolean
) {
  const out: {
    cruises: number | null;
    cruiseDistance: number | null;
    cruisePorts: number | null;
    stays: number | null;
    nights: number | null;
    railRides: number | null;
    railTicketKm: number | null;
    railTracedKm: number | null;
    railStraightKm: number | null;
    busRides: number | null;
    busTicketKm: number | null;
    busRouteKm: number | null;
    rentals: number | null;
    rentalDays: number | null;
    rentalKm: number | null;
  } = {
    cruises: null,
    cruiseDistance: null,
    cruisePorts: null,
    stays: null,
    nights: null,
    railRides: null,
    railTicketKm: null,
    railTracedKm: null,
    railStraightKm: null,
    busRides: null,
    busTicketKm: null,
    busRouteKm: null,
    rentals: null,
    rentalDays: null,
    rentalKm: null,
  };
  if (!enabled) return out;
  if (domains.includes("cruise")) {
    const loaded = await loadCruiseStatsData(userId, year ?? undefined);
    const stats = calculateCruiseStats(
      loaded.rows.map((r) => r.input),
      loaded.userBirthday
    );
    out.cruises = stats.cruisesCount;
    out.cruiseDistance = stats.totalDistanceKm;
    out.cruisePorts = stats.cruisePortsUnique;
  }
  if (domains.includes("lodging")) {
    const loaded = await loadLodgingStatsData(userId, year ?? undefined);
    const stats = calculateLodgingStats(loaded.stays, loaded.baseCurrency, loaded.lodgingRecords);
    out.stays = stats.staysCount;
    out.nights = stats.totalNights;
  }
  if (domains.includes("rail")) {
    const stats = await loadRailStats(userId, year);
    out.railRides = stats.journeys;
    out.railTicketKm = stats.distance.ticketKm;
    out.railTracedKm = stats.distance.tracedKm;
    out.railStraightKm = stats.distance.straightLineKm;
  }
  if (domains.includes("bus")) {
    const stats = await loadBusStats(userId, year);
    out.busRides = stats.rides;
    out.busTicketKm = stats.distance.ticketKm;
    out.busRouteKm = stats.distance.routeKm;
  }
  if (domains.includes("rental")) {
    const stats = await rentalStatsFor(userId, year);
    out.rentals = stats.rentals;
    out.rentalDays = stats.days;
    out.rentalKm = stats.km.total;
  }
  return out;
}
