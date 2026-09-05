import type { ParsedBooking } from '../../../bookingParser';
import {
  distinctiveWords,
  foldForMatch,
  namedAirportCode,
  preferNamedAirports,
  type CatalogueAirport,
} from '../namedAirport';

jest.mock('../../../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// The Berlin rows as the catalogue holds them (OurAirports, seeded on 2026-08-30):
// one open airport on the city code, three closed ones with their own names.
const BERLIN: CatalogueAirport[] = [
  { iata: 'BER', icao: 'EDDB', name: 'Berlin Brandenburg Airport', city: 'Berlin', isClosed: false },
  { iata: 'SXF', icao: 'EDDB', name: 'Berlin-Schönefeld Airport', city: 'Berlin', isClosed: true },
  { iata: 'THF', icao: 'EDDI', name: 'Berlin Tempelhof Airport', city: 'Berlin', isClosed: true },
  { iata: 'TXL', icao: 'EDDT', name: 'Berlin-Tegel Otto Lilienthal Airport', city: 'Berlin', isClosed: true },
  { iata: null, icao: 'DE-0013', name: 'Johannisthal Airfield', city: 'Berlin', isClosed: true },
];
const MUNICH: CatalogueAirport[] = [
  { iata: 'MUC', icao: 'EDDM', name: 'Munich Airport', city: 'Munich', isClosed: false },
  { iata: 'MUC', icao: 'EDDM', name: 'Flughafen München-Riem', city: 'Munich', isClosed: true },
];
const catalogue = async (code: string): Promise<CatalogueAirport[]> =>
  code === 'BER' ? BERLIN : code === 'MUC' ? MUNICH : [];

/** The shape of the 2008 Germanwings confirmation from the #287 follow-up. */
const GERMANWINGS_2008 = [
  'Flug: 15.12.2008 | Flugnummer 4U 8135:',
  '11:40 München  12:50 Berlin-Schönefeld',
  'Flug: 16.12.2008 | Flugnummer 4U 8136:',
  '15:15 Berlin-Schönefeld  16:25 München',
].join('\n');

function leg(dep: string, arr: string, flightNumber: string): ParsedBooking {
  return { departureCode: dep, arrivalCode: arr, flightNumber } as ParsedBooking;
}

describe('foldForMatch / distinctiveWords', () => {
  it('folds umlauts the way the catalogue spells them, and strips marks', () => {
    expect(foldForMatch('Berlin-Schönefeld')).toBe('berlin schoenefeld');
    expect(foldForMatch('Zürich, Kloten')).toBe('zuerich kloten');
    expect(foldForMatch('Nantes Atlantique (NTE)')).toBe('nantes atlantique nte');
    expect(foldForMatch('Genève Aéroport / São Paulo')).toBe('geneve aeroport sao paulo');
  });

  it('keeps only words that could mean this airport and no other', () => {
    expect(distinctiveWords(BERLIN[1])).toEqual(['schoenefeld']);
    expect(distinctiveWords(BERLIN[0])).toEqual(['brandenburg']);
    // "otto" is too short to count; the surname stays.
    expect(distinctiveWords(BERLIN[3])).toEqual(['tegel', 'lilienthal']);
    // The city's own name never identifies one of its airports.
    expect(distinctiveWords(MUNICH[0])).toEqual([]);
  });
});

describe('namedAirportCode — the decision', () => {
  const text = foldForMatch(GERMANWINGS_2008);

  it('replaces the city code with the airport the text names', () => {
    expect(namedAirportCode('BER', text, BERLIN)).toBe('SXF');
  });

  it('leaves the code alone when the text names the returned airport itself', () => {
    expect(namedAirportCode('BER', foldForMatch('Abflug Berlin Brandenburg 09:10'), BERLIN)).toBeNull();
  });

  it('leaves the code alone when two airports of the city are named', () => {
    expect(
      namedAirportCode('BER', foldForMatch('Berlin-Tegel oder Berlin-Schönefeld, je nach Wetter'), BERLIN)
    ).toBeNull();
  });

  it('leaves the code alone when the city has nothing to say', () => {
    expect(namedAirportCode('MUC', text, MUNICH)).toBeNull();
    expect(namedAirportCode('CGN', text, [])).toBeNull();
  });

  it('never picks a row without an IATA code', () => {
    expect(namedAirportCode('BER', foldForMatch('Start in Johannisthal'), BERLIN)).toBeNull();
  });
});

describe('preferNamedAirports — over a parsed booking', () => {
  it('files the 2008 legs into Schönefeld, both directions', async () => {
    const parsed = [leg('MUC', 'BER', '4U8135'), leg('BER', 'MUC', '4U8136')];
    const fixed = await preferNamedAirports(parsed, GERMANWINGS_2008, catalogue);
    expect(fixed.map((f) => [f.departureCode, f.arrivalCode])).toEqual([
      ['MUC', 'SXF'],
      ['SXF', 'MUC'],
    ]);
    // Immutable: the input is not touched.
    expect(parsed[0].arrivalCode).toBe('BER');
  });

  it('touches nothing on a mail that names no other airport', async () => {
    const parsed = [leg('MUC', 'BER', 'LH2030')];
    const fixed = await preferNamedAirports(parsed, 'Flug LH2030 München – Berlin Brandenburg', catalogue);
    expect(fixed[0]).toEqual(parsed[0]);
  });

  it('skips flights without a code and asks the catalogue once per code', async () => {
    const lookup = jest.fn(catalogue);
    const parsed = [leg('MUC', 'BER', 'A'), leg('BER', 'MUC', 'B'), { flightNumber: 'C' } as ParsedBooking];
    await preferNamedAirports(parsed, GERMANWINGS_2008, lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
