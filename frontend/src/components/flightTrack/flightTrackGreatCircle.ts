import { greatCirclePath } from "../layers/greatCircle";
import { knownAirportPosition, type AirportPosition } from "./flownVsGreatCircle";

type LonLat = [number, number];

/**
 * The great circle between the two airports, for the flight page's map to
 * draw beneath the recording — or null when an end has no position.
 *
 * Its longitudes are shifted by whole turns to sit next to the recording's
 * first fix, which `flightTrackPieces` leaves unshifted: a recording and its
 * great circle must land in the same world copy, or one of them is drawn a
 * full map-width away.
 */
export function flightTrackGreatCircle(
  departure: AirportPosition | null | undefined,
  arrival: AirportPosition | null | undefined,
  firstFix: LonLat | undefined
): LonLat[] | null {
  if (!knownAirportPosition(departure) || !knownAirportPosition(arrival)) return null;
  const { points } = greatCirclePath([departure.lon, departure.lat], [arrival.lon, arrival.lat]);
  if (!firstFix) return points;
  let shift = 0;
  while (points[0][0] + shift - firstFix[0] > 180) shift -= 360;
  while (points[0][0] + shift - firstFix[0] < -180) shift += 360;
  return shift === 0 ? points : points.map(([lon, lat]): LonLat => [lon + shift, lat]);
}
