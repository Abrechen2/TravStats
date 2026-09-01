import { describe, it, expect, jest } from '@jest/globals';
import { extractFlightDataFromText, pickFlightNumber } from '../utils';

jest.mock('../../../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('extractFlightDataFromText — gate', () => {
  it('does not turn the boarding time into a gate', () => {
    // "BOARDING 18:30" is when boarding starts. `Boarding` used to count as a
    // gate label, so a Lufthansa pass reported gate "18" — a plausible-looking
    // value that is simply not on the pass.
    expect(extractFlightDataFromText('BOARDING 18:30').gate).toBeUndefined();
  });

  it('does not take a clock even after a real gate label', () => {
    // The `\b` matters: without it the match backs off to "1" to slip past the
    // no-clock guard.
    expect(extractFlightDataFromText('GATE 18:30').gate).toBeUndefined();
  });

  it('reads a gate written the ordinary way', () => {
    expect(extractFlightDataFromText('GATE B45').gate).toBe('B45');
    expect(extractFlightDataFromText('GATE: 029').gate).toBe('029');
    expect(extractFlightDataFromText('AUSGANG A12').gate).toBe('A12');
  });

  it('still reads a gate the pass introduces as a boarding gate', () => {
    expect(extractFlightDataFromText('BOARDING GATE B12').gate).toBe('B12');
  });

  it('is not fooled by the gate-closing column next to it', () => {
    // "GATE SCHLIESST 18:45" carries a gate LABEL and a clock, and nothing else.
    expect(
      extractFlightDataFromText('GATE SCHLIESST 18:45').gate
    ).toBeUndefined();
  });
});

describe('extractFlightDataFromText — booking reference', () => {
  it('does not read a column heading as a booking reference', () => {
    // "KLASSE" is the cabin heading on a German pass. `findExistingFlight`
    // looks a PNR up BEFORE flight number and date, so an invented one merges
    // the scan into whatever flight happens to carry it.
    expect(extractFlightDataFromText('PASSAGIER KLASSE STATUS').pnr).toBeUndefined();
  });

  it('reads a record locator the pass names', () => {
    // Labelled, so all-letter references are still accepted.
    expect(extractFlightDataFromText('BOOKING REFERENCE: ABCDEF').pnr).toBe('ABCDEF');
    expect(extractFlightDataFromText('PNR XYZABC').pnr).toBe('XYZABC');
  });

  it('reads an unlabelled reference that could not be a word', () => {
    expect(extractFlightDataFromText('9RFAA7').pnr).toBe('9RFAA7');
    expect(extractFlightDataFromText('85LMUN').pnr).toBe('85LMUN');
  });

  it('does not carve a reference out of a longer number', () => {
    expect(extractFlightDataFromText('1234567890123').pnr).toBeUndefined();
  });
});

describe('pickFlightNumber', () => {
  it('does not mistake an OCR-mangled gate for the flight', () => {
    // Gates print as "B08", "E06", "K18"; the O/0 and I/1 confusions turn them
    // into exactly the shape of a flight number, and they sit ABOVE the flight
    // number on the card. Three of the twelve sample passes were reported as
    // EO6, KII8 and BO8 instead of their real Lufthansa numbers.
    expect(pickFlightNumber('GATE EO6 FLUG LH2415')).toBe('LH2415');
    expect(pickFlightNumber('GATE KII8 FLUG LH2414')).toBe('LH2414');
    expect(pickFlightNumber('GATE BO8 FLUG LH2317')).toBe('LH2317');
  });

  it('accepts a carrier the curated list does not know', () => {
    // ~145 common airlines is a shortlist, not a world index. A real flight on
    // an unfashionable carrier must not be dropped for being absent from it.
    expect(pickFlightNumber('FLUG ZZ742')).toBe('ZZ742');
  });

  it('reads a known carrier that is not the first candidate', () => {
    // Order alone decided this before, which is the whole defect.
    expect(pickFlightNumber('BO8 ZZ742 EN8409')).toBe('EN8409');
  });

  it('is undefined when the text holds no flight number at all', () => {
    expect(pickFlightNumber('PASSAGIER KLASSE STATUS')).toBeUndefined();
  });
});
