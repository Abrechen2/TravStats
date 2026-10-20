/**
 * Pure, I/O-free coarsening helpers for the anonymous usage payload.
 *
 * Exact counts are never sent. Distances are rounded so that an exact odd
 * number cannot act as a de-facto instance fingerprint across pings.
 */

export type UsersBucket = "1" | "2-5" | "6-20" | "20+";
export type FlightsBucket = "<50" | "50-250" | "250-1k" | "1k+";
export type CruisesBucket = "0" | "1-5" | "6-20" | "20+";

export function bucketUsers(n: number): UsersBucket {
  if (n <= 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  return "20+";
}

export function bucketFlights(n: number): FlightsBucket {
  if (n < 50) return "<50";
  if (n <= 250) return "50-250";
  if (n <= 1000) return "250-1k";
  return "1k+";
}

/** Zero is its own bucket: "domain enabled but never used" is the signal we want. */
export function bucketCruises(n: number): CruisesBucket {
  if (n === 0) return "0";
  if (n <= 5) return "1-5";
  if (n <= 20) return "6-20";
  return "20+";
}

/** Round to the nearest 100 km. */
export function roundKm(km: number): number {
  return Math.round(km / 100) * 100;
}

const ARCH_MAP: Record<string, string> = {
  x64: "amd64",
  x86_64: "amd64",
  arm64: "arm64",
  aarch64: "arm64",
};

export function detectArch(): string {
  return ARCH_MAP[process.arch] ?? process.arch;
}

/**
 * Entries per domain (forgejo#315). Zero is its own bucket, as for cruises:
 * "switched on, never used" is the signal. Must match `COUNT_BUCKETS` in the
 * receiver (`travstats-stats/src/schema.ts`), which refuses any other value.
 */
export type CountBucket = "0" | "1-10" | "11-50" | "51-250" | "250+";

export function bucketCount(n: number): CountBucket {
  if (n <= 0) return "0";
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 250) return "51-250";
  return "250+";
}

/** The passport's country count. Receiver: `COUNTRY_BUCKETS`. */
export type CountriesBucket = "0" | "1-5" | "6-20" | "21-50" | "50+";

export function bucketCountries(n: number): CountriesBucket {
  if (n <= 0) return "0";
  if (n <= 5) return "1-5";
  if (n <= 20) return "6-20";
  if (n <= 50) return "21-50";
  return "50+";
}

/** Paired Companion devices. Receiver: `PAIRING_BUCKETS`. */
export type PairingsBucket = "0" | "1" | "2-5" | "6+";

export function bucketPairings(n: number): PairingsBucket {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  return "6+";
}
