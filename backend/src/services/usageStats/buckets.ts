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
