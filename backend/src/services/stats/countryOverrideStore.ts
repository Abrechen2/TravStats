/**
 * Reading and writing the user's passport country overrides (forgejo#308).
 * What an override MEANS is `./countryOverrides.ts`; this file only stores it.
 */

import { prisma } from "../../db";
import type { CountryOverrideInput, CountryOverrideVerdict } from "./countryOverrides";

/** An override as the API publishes it. */
export interface CountryOverrideRecord extends CountryOverrideInput {
  createdAt: string;
  updatedAt: string;
}

interface StoredRow {
  countryCode: string;
  verdict: string;
  note: string;
  day: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A DATE column comes back as UTC midnight, so its UTC day IS the stored day.
 * A row whose verdict is outside the vocabulary (only possible by writing the
 * table by hand) is dropped here rather than guessed into one of the three.
 */
function toRecord(row: StoredRow): CountryOverrideRecord | null {
  if (row.verdict !== "visited" && row.verdict !== "ground" && row.verdict !== "excluded") {
    return null;
  }
  return {
    countryCode: row.countryCode,
    verdict: row.verdict as CountryOverrideVerdict,
    note: row.note,
    day: row.day ? row.day.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SELECT = {
  countryCode: true,
  verdict: true,
  note: true,
  day: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Every override of the user, by country code. */
export async function listCountryOverrides(userId: string): Promise<CountryOverrideRecord[]> {
  const rows = await prisma.countryOverride.findMany({
    where: { userId },
    select: SELECT,
    orderBy: { countryCode: "asc" },
  });
  return rows.map(toRecord).filter((r): r is CountryOverrideRecord => r !== null);
}

/** Create or replace the user's override for one country. */
export async function upsertCountryOverride(
  userId: string,
  countryCode: string,
  value: { verdict: CountryOverrideVerdict; note: string; day: string | null }
): Promise<CountryOverrideRecord> {
  const data = {
    verdict: value.verdict,
    note: value.note,
    day: value.day ? new Date(`${value.day}T00:00:00.000Z`) : null,
  };
  const row = await prisma.countryOverride.upsert({
    where: { userId_countryCode: { userId, countryCode } },
    create: { userId, countryCode, ...data },
    update: data,
    select: SELECT,
  });
  // The verdict was validated on the way in, so the record exists.
  return toRecord(row)!;
}

/** @returns whether there was an override to delete */
export async function deleteCountryOverride(userId: string, countryCode: string): Promise<boolean> {
  const { count } = await prisma.countryOverride.deleteMany({ where: { userId, countryCode } });
  return count > 0;
}
