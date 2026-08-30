import { describe, it, expect } from '@jest/globals';
import { Prisma } from '@prisma/client';

import { isDuplicateCodeError } from '../seedAirportsFromCSV';

/**
 * A fresh start must not log errors for data the CSV was always going to
 * contain.
 *
 * Forgejo #3: booting an empty instance produced error-level lines such as
 * "Error processing airport SSCV Hermod Helideck", with Prisma reporting a
 * unique constraint failure on (icao, is_closed). The source catalogue holds
 * several distinct offshore helidecks that share one ICAO; the row is looked up
 * by its IATA pair, is not found, and the insert then collides with a different
 * airport's ICAO.
 *
 * Skipping is right — updating would overwrite an unrelated airport with this
 * one's coordinates — and the outcome is the same every time, so it belongs at
 * debug level with a count in the summary, not in the error log. A first
 * startup full of red lines teaches people that red lines are normal.
 *
 * The error is built from Prisma's own class rather than a hand-made object, so
 * this notices if the library ever changes the shape the seeder keys on.
 */
describe('isDuplicateCodeError', () => {
  it('recognises a real Prisma unique-constraint error', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`icao`,`is_closed`)',
      { code: 'P2002', clientVersion: Prisma.prismaVersion.client }
    );
    expect(isDuplicateCodeError(error)).toBe(true);
  });

  it('does not swallow a different Prisma failure', () => {
    // P2003 is a foreign-key violation — a genuine fault that must stay loud.
    const error = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003',
      clientVersion: Prisma.prismaVersion.client,
    });
    expect(isDuplicateCodeError(error)).toBe(false);
  });

  it('does not swallow an ordinary error', () => {
    expect(isDuplicateCodeError(new Error('connection reset'))).toBe(false);
  });

  it('survives the values a catch block can actually receive', () => {
    // `catch (e: unknown)` can hand over anything at all, and a guard that
    // throws while classifying an error is worse than the error.
    expect(isDuplicateCodeError(null)).toBe(false);
    expect(isDuplicateCodeError(undefined)).toBe(false);
    expect(isDuplicateCodeError('P2002')).toBe(false);
    expect(isDuplicateCodeError({ code: 2002 })).toBe(false);
  });
});
