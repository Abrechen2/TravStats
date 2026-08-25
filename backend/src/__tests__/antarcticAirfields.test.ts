import { isAntarcticAirfield } from '../seedAirportsFromCSV';

/**
 * Rows quoted verbatim from the OurAirports CSV
 * (`davidmegginson.github.io/ourairports-data/airports.csv`, read 2026-08-25).
 * Only the columns the predicate reads are kept.
 */
function row(over: Partial<Record<string, string>>): Record<string, string> {
  return {
    ident: '',
    type: 'small_airport',
    name: '',
    iso_country: 'AQ',
    iata_code: '',
    gps_code: '',
    ...over,
  };
}

describe('isAntarcticAirfield', () => {
  it('admits the field tourists actually reach Antarctica through', () => {
    // Teniente Rodolfo Marsh Martin on King George Island — has a real IATA
    // and is typed small_airport, which is why it was invisible.
    expect(
      isAntarcticAirfield(
        row({ ident: 'SCRM', iata_code: 'TNM', gps_code: 'SCRM', name: 'Teniente Rodolfo Marsh Martin Airport' }),
      ),
    ).toBe(true);
  });

  it('admits the research stations the owner named', () => {
    const stations = [
      row({ ident: 'EGAR', gps_code: 'EGAR', name: 'Rothera Research Station' }),
      row({ ident: 'SAWB', gps_code: 'SAWB', name: 'Gustavo Marambio Airport' }),
      row({ ident: 'SCGC', iata_code: 'UGL', gps_code: 'SCGC', name: 'Union Glacier Blue-Ice Runway' }),
      row({ ident: 'AQ-0001', gps_code: 'AT17', name: 'Novolazarevskaya Station' }),
    ];
    for (const station of stations) {
      expect(isAntarcticAirfield(station)).toBe(true);
    }
  });

  it('rejects a placeholder with no code anyone could type', () => {
    // OurAirports gives unaddressable features a synthetic `AQ-00NN` ident.
    // Without this guard "Navaid" would appear in the airport picker under
    // the code AQ-0012.
    expect(isAntarcticAirfield(row({ ident: 'AQ-0012', name: 'Navaid' }))).toBe(false);
    expect(isAntarcticAirfield(row({ ident: 'AQ-0011', name: 'Wolfs Fang' }))).toBe(false);
  });

  it('leaves the rest of the world alone', () => {
    // The whole point is that this is Antarctica-only: admitting every
    // small_airport worldwide would bury the picker in airstrips.
    expect(
      isAntarcticAirfield(
        row({ iso_country: 'DE', ident: 'EDAY', gps_code: 'EDAY', name: 'Strausberg' }),
      ),
    ).toBe(false);
  });

  it('does not claim types the normal filter already admits', () => {
    // Wolf's Fang is medium_airport and comes in through allowedTypes — the
    // single Antarctic field that always did, which is why "seven continents"
    // was effectively reachable through one airfield.
    expect(
      isAntarcticAirfield(
        row({ type: 'medium_airport', ident: 'AT98', iata_code: 'WFR', gps_code: 'AT98' }),
      ),
    ).toBe(false);
    expect(
      isAntarcticAirfield(row({ type: 'heliport', ident: 'SAYO', gps_code: 'SAYO' })),
    ).toBe(false);
    expect(
      isAntarcticAirfield(row({ type: 'closed', ident: 'AQ-0013', name: 'McMurdo Ice Runway' })),
    ).toBe(false);
  });
});
