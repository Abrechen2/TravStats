import { admitsAirport, isAntarcticAirfield } from '../shared/antarcticAirfields';

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

/**
 * The admission rule the catalogue is actually built from.
 *
 * Why this exists: the Antarctic exception first lived only in the CLI seed
 * script, while the admin re-seed — the one path a user can trigger — kept its
 * own hardcoded type list. The fix shipped in three release candidates and the
 * catalogue still came back with twelve Antarctic entries, because the button
 * ran the other filter. Both paths now call this function, so a rule added on
 * one side cannot go missing on the other.
 */
function catalogueRow(over: Partial<Record<string, string>>) {
  return {
    ident: 'EDDM',
    type: 'large_airport',
    iso_country: 'DE',
    iata_code: 'MUC',
    gps_code: 'EDDM',
    latitude_deg: '48.35',
    longitude_deg: '11.78',
    ...over,
  };
}

describe('admitsAirport', () => {
  it('admits an Antarctic station on the ordinary seed path', () => {
    // The case the admin re-seed dropped: typed small_airport, real IATA.
    expect(
      admitsAirport(
        catalogueRow({
          type: 'small_airport',
          iso_country: 'AQ',
          ident: 'SCRM',
          iata_code: 'TNM',
          gps_code: 'SCRM',
          latitude_deg: '-62.1907',
          longitude_deg: '-58.9866',
        }),
      ),
    ).toBe(true);
  });

  it('keeps closed commercial airports so historical flights stay loggable', () => {
    expect(
      admitsAirport(catalogueRow({ type: 'closed', ident: 'EDDI', iata_code: 'THF' })),
    ).toBe(true);
  });

  it('does not widen the closed-only backfill to Antarctica', () => {
    // closedOnly is the historical backfill; widening it would pull stations
    // into a run whose whole point is to touch nothing else.
    const station = catalogueRow({
      type: 'small_airport',
      iso_country: 'AQ',
      iata_code: 'TNM',
    });
    expect(admitsAirport(station)).toBe(true);
    expect(admitsAirport(station, { closedOnly: true })).toBe(false);
  });

  it("still drops the world's small airstrips", () => {
    expect(
      admitsAirport(catalogueRow({ type: 'small_airport', iso_country: 'DE', iata_code: '' })),
    ).toBe(false);
  });

  it('drops a row without a position', () => {
    expect(admitsAirport(catalogueRow({ latitude_deg: '', longitude_deg: '' }))).toBe(false);
  });

  it('drops a row with no code at all', () => {
    expect(
      admitsAirport(catalogueRow({ ident: '', iata_code: '', gps_code: '' })),
    ).toBe(false);
  });
});
