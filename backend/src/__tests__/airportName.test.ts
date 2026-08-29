import * as fs from 'fs';
import * as path from 'path';
import { normalizeAirportName, buildDuplicateMarkerCleanupSql } from '../shared/airportName';

/**
 * Every input here is a name quoted VERBATIM from the OurAirports CSV the
 * seeder downloads (`davidmegginson.github.io/ourairports-data/airports.csv`,
 * read 2026-08-29 off the running RC container). The file carried 132 rows
 * marked this way — this is a standing property of the source, not a one-off.
 */
describe('normalizeAirportName', () => {
  it('strips the marker shape the source uses most', () => {
    expect(normalizeAirportName('[Duplicate] Beijing Xijiao Airport')).toBe('Beijing Xijiao Airport');
    expect(normalizeAirportName('[Duplicate] ERQUELINNES DZ')).toBe('ERQUELINNES DZ');
  });

  it('strips the round-bracket variants, spaced or not', () => {
    expect(normalizeAirportName('(Duplicate)Yeouido Airport')).toBe('Yeouido Airport');
    expect(normalizeAirportName('(Duplicate) Utai Airstrip')).toBe('Utai Airstrip');
  });

  it('strips the malformed and hedged variants the source also carries', () => {
    // Mismatched brackets, question marks and a whole editorial aside — all
    // real rows. Matching on the WORD rather than on one exact shape is the
    // only thing that catches these.
    expect(normalizeAirportName('(??Duplicate??)LEVS AIRPORT')).toBe('LEVS AIRPORT');
    expect(normalizeAirportName('(Duplicate}Kadanwari Airport')).toBe('Kadanwari Airport');
    expect(normalizeAirportName('{Duplicate}Cumaná Heliport')).toBe('Cumaná Heliport');
    expect(normalizeAirportName('(Misplaced duplicate?)Aeropuerto internacional Simón bolivar')).toBe(
      'Aeropuerto internacional Simón bolivar',
    );
  });

  it('strips a TRAILING marker too', () => {
    // `Sayma (duplicate)` — the marker is not always a prefix, so a
    // startsWith-style fix would leave this one in the picker.
    expect(normalizeAirportName('Sayma (duplicate)')).toBe('Sayma');
  });

  it('keeps a non-latin name intact once the marker is gone', () => {
    expect(normalizeAirportName('(Duplicate)Аэропорт İlker Karter')).toBe('Аэропорт İlker Karter');
  });

  it('leaves legitimate brackets alone', () => {
    // The decisive case: this row is marked AND carries a real parenthetical.
    // Stripping "any leading bracket" would mangle the half we want to keep.
    expect(normalizeAirportName('[Duplicate] Halifax (South Battery) Heliport')).toBe(
      'Halifax (South Battery) Heliport',
    );
    expect(normalizeAirportName('Western Sydney International (Nancy Bird Walton) Airport')).toBe(
      'Western Sydney International (Nancy Bird Walton) Airport',
    );
  });

  it('touches nothing on an ordinary name', () => {
    expect(normalizeAirportName('Teniente Rodolfo Marsh Martin Airport')).toBe(
      'Teniente Rodolfo Marsh Martin Airport',
    );
    expect(normalizeAirportName("Wolf's Fang Runway")).toBe("Wolf's Fang Runway");
  });

  it('keeps the original when stripping would leave nothing', () => {
    // A row named only by its marker still needs SOME name — an empty string
    // in the picker is worse than an ugly one.
    expect(normalizeAirportName('[Duplicate]')).toBe('[Duplicate]');
  });

  it('keeps a bare word that is not a marker', () => {
    expect(normalizeAirportName('Duplicate Lake Airport')).toBe('Duplicate Lake Airport');
  });
});

/**
 * Both catalogue write paths must route the name through the shared rule.
 *
 * This guard exists because the Antarctic admission rule was fixed in the CLI
 * seed script alone and shipped WRONG in three release candidates: the admin
 * re-seed — the only path a user can trigger — kept its own copy. A rule that
 * lives in `shared/` but is called from one side is the same bug again.
 */
describe('both catalogue write paths use the shared rule', () => {
  const writePaths = [
    path.join(__dirname, '..', 'seedAirportsFromCSV.ts'),
    path.join(__dirname, '..', 'services', 'airportSeedingService.ts'),
  ];

  it.each(writePaths)('%s normalizes the name it writes', (file) => {
    const source = fs.readFileSync(file, 'utf-8');
    expect(source).toContain('normalizeAirportName');
    // …and does not write the raw CSV name past it.
    expect(source).not.toMatch(/name:\s*airport\.name\b/);
  });
});

/**
 * The data migration must carry the rule, not a hand-typed copy of it.
 *
 * The importer fix only reaches rows the CSV still contains. Rows whose
 * upstream counterpart was renamed or retyped are orphans no re-seed matches
 * again -- and they are the ones with real IATA codes in the picker. The
 * migration is the only thing that ever repairs those, so a rule change that
 * silently left the migration behind would leave them broken forever.
 */
describe('the catalogue repair migration carries the shared rule', () => {
  const migration = path.join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20260829080000_strip_duplicate_marker_from_airport_names',
    'migration.sql',
  );

  it('contains exactly the statement the shared rule generates', () => {
    const sql = fs.readFileSync(migration, 'utf-8');
    expect(sql).toContain(buildDuplicateMarkerCleanupSql('airports', 'name'));
  });
});
