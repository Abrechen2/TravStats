import {
  busCo2,
  cruiseCo2,
  ferryCo2,
  railCo2,
  type BusCo2Row,
  type FerryCo2Row,
  type RailCo2Row,
} from "./transportCo2";

/**
 * A ride as the API serves it, plus its `co2` estimate (forgejo#395): additive,
 * computed on read and never stored, `null` where the mode abstains (no known
 * distance). Compose AFTER the `times` reader, on a full row.
 */
export const withRailCo2 = <T extends RailCo2Row>(ride: T) => ({ ...ride, co2: railCo2(ride) });
export const withBusCo2 = <T extends BusCo2Row>(ride: T) => ({ ...ride, co2: busCo2(ride) });
export const withFerryCo2 = <T extends FerryCo2Row>(ride: T) => ({ ...ride, co2: ferryCo2(ride) });

/** A cruise with its leg distances loaded (`CRUISE_INCLUDE`); a cruise without legs abstains. */
export const withCruiseCo2 = <T extends { legs: Array<{ distanceKm: number }> }>(cruise: T) => ({
  ...cruise,
  co2: cruiseCo2(cruise.legs.map((leg) => leg.distanceKm)),
});
