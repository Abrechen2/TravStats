const SHORT_HAUL_THRESHOLD_KM = 1500;
const SHORT_HAUL_FACTOR = 0.255;
const LONG_HAUL_FACTOR  = 0.195;

export const CABIN_FACTORS = {
  economy:         1.0,
  premium_economy: 1.6,
  business:        2.9,
  first:           4.0,
} as const;

type SeatClass = keyof typeof CABIN_FACTORS | null | undefined;

export interface Co2Input {
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  seatClass: SeatClass;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateCo2Kg(input: Co2Input): number | null {
  const { depLat, depLon, arrLat, arrLon, seatClass } = input;
  if (depLat == null || depLon == null || arrLat == null || arrLon == null) {
    return null;
  }
  const distanceKm = haversineKm(depLat, depLon, arrLat, arrLon);
  const emissionFactor = distanceKm < SHORT_HAUL_THRESHOLD_KM ? SHORT_HAUL_FACTOR : LONG_HAUL_FACTOR;
  const cabinFactor = CABIN_FACTORS[seatClass as keyof typeof CABIN_FACTORS] ?? CABIN_FACTORS.economy;
  return Math.round(distanceKm * emissionFactor * cabinFactor);
}
