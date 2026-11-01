/**
 * Published emission factors for the ground and sea modes (forgejo#395). Flights
 * keep their own model in `services/co2Calculator.ts`.
 *
 * ONE publication, read from its machine-readable table and not from memory:
 * UK Department for Energy Security and Net Zero (DESNZ, formerly BEIS/DEFRA),
 * "Greenhouse gas reporting: conversion factors 2025", flat-format workbook
 * (published 2025-06; https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025).
 * Every figure below is the sheet's column "kg CO2e" (CO2 + CH4 + N2O as CO2e,
 * direct/tank-to-wheel emissions, WITHOUT the well-to-tank upstream rows) per
 * the unit named in each block. Using direct figures throughout keeps the modes
 * comparable with the flight calculator, which also counts burnt fuel only.
 *
 * No value here is a TravStats invention. Where the publication has no figure
 * for a case, the code abstains (null) rather than borrowing one — see the
 * "no factor" notes per block and `services/co2/transportCo2.ts`.
 */

export const EMISSION_FACTOR_SOURCE = {
  publisher: "UK DESNZ",
  title: "Greenhouse gas reporting: conversion factors",
  year: 2025,
  url: "https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025",
} as const;

/**
 * Rail, kg CO2e per passenger-km — sheet "Business travel- land", Rail.
 * The publication does not split high-speed from regional trains, so every
 * `rail` ride (the counted mode) uses "National rail"; "International rail"
 * (0.00446) is Eurostar-specific and is deliberately NOT applied to other
 * cross-border trains. `tram` = "Light rail and tram"; `metro` = "London
 * Underground", the only metro figure published.
 */
export const RAIL_KG_PER_PKM = {
  rail: 0.03546,
  tram: 0.0286,
  metro: 0.0278,
} as const;

/**
 * Bus, kg CO2e per passenger-km — "Business travel- land", Bus. `coach` for
 * intercity services, `local` ("Average local bus") for airport shuttles and
 * the like.
 */
export const BUS_KG_PER_PKM = {
  coach: 0.02776,
  local: 0.10385,
} as const;

/**
 * Ferry, kg CO2e per passenger-km — "Business travel- sea", Ferry. `car` is
 * the "Car passenger" figure (a passenger who brings a vehicle), `foot` the
 * "Foot passenger" one; `average` is "Average (all passenger)" and serves a
 * crossing whose vehicle is not recorded.
 */
export const FERRY_KG_PER_PKM = {
  foot: 0.01871,
  car: 0.12933,
  average: 0.1127,
} as const;

/**
 * Cruise. The publication has no cruise-ship figure (nor a per-passenger-night
 * one), so the closest published sea-passenger factor is used over the voyage's
 * leg distance: "Ferry — Average (all passenger)". It EXCLUDES hotel load and
 * understates a cruise ship's real intensity; the API and the UI call the
 * result a lower bound and name this proxy.
 */
export const CRUISE_PROXY_KG_PER_PKM = FERRY_KG_PER_PKM.average;

export type CarSize = "small" | "medium" | "large" | "average";
export type CarFuel = "diesel" | "petrol" | "hybrid" | "unknown";

/**
 * Passenger vehicles, kg CO2e per VEHICLE-km — "Passenger vehicles", Cars (by
 * size). Per vehicle, not per passenger: the rental record holds no occupancy,
 * so the figure is the car's, whoever rode in it. Battery-electric rows are 0
 * in the publication because it counts tailpipe only; TravStats abstains for an
 * electric car instead of showing a flattering zero.
 */
export const CAR_KG_PER_VKM: Record<CarSize, Record<CarFuel, number>> = {
  small: { diesel: 0.1434, petrol: 0.14308, hybrid: 0.11413, unknown: 0.14322 },
  medium: { diesel: 0.17174, petrol: 0.17474, hybrid: 0.11724, unknown: 0.17322 },
  large: { diesel: 0.21007, petrol: 0.26828, hybrid: 0.1565, unknown: 0.22678 },
  average: { diesel: 0.17304, petrol: 0.16272, hybrid: 0.12825, unknown: 0.16725 },
};

/**
 * A flight is only offered as the alternative to a ride at least this long. Our
 * own judgement, not a published figure: nobody flies 30 km, and "saved 8 kg
 * versus a plane" on a commuter hop would be noise.
 */
export const MIN_COMPARABLE_FLIGHT_KM = 100;
