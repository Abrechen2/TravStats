/**
 * Ratchet for docs/adr/0001-api-response-shape.md.
 *
 * Two response shapes coexist in this API: the flights/stats/auth family
 * answers with the resource itself, the lodging/places/cruise family wraps it
 * in `{success, data}`. The ADR settles that both stay and that a ROUTER never
 * mixes them. This test holds the line the day it was drawn:
 *
 *   - every router file is assigned to one family in the baseline, so a new
 *     router is a decision, not an accident;
 *   - a bare-family router carries `success: true` only as often as the
 *     frozen list says, and that entry may only shrink;
 *   - an enveloped-family router keeps at least one envelope — one that lost
 *     them all has changed family and must say so in the baseline.
 *
 * What it does NOT see: a bare `res.json(resource)` slipped into an enveloped
 * router. That leak has no grep-able signature; the OpenAPI response-schema
 * ratchet is the place that would notice a shape change per endpoint.
 */
import fs from 'fs';
import path from 'path';

interface Baseline {
  bare: string[];
  enveloped: string[];
  frozenEnvelopes: Record<string, number>;
}

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const BASELINE_PATH = path.join(__dirname, 'apiResponseShape.baseline.json');
const ADR = 'docs/adr/0001-api-response-shape.md';

function routerFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : routerFiles(full);
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
      return [path.relative(ROUTES_DIR, full).split(path.sep).join('/')];
    })
    .sort();
}

function envelopeCount(relative: string): number {
  const source = fs.readFileSync(path.join(ROUTES_DIR, relative), 'utf8');
  return (source.match(/success:\s*true/g) ?? []).length;
}

const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const files = routerFiles(ROUTES_DIR);

describe('API response shape — one family per router (ADR 0001)', () => {
  it('assigns every router file to exactly one family', () => {
    const assigned = new Set([...baseline.bare, ...baseline.enveloped]);
    const unassigned = files.filter((f) => !assigned.has(f));
    expect(
      unassigned,
      // A new router: decide its family (see the ADR) and add it to the baseline.
    ).toEqual([]);

    const twice = baseline.bare.filter((f) => baseline.enveloped.includes(f));
    expect(twice).toEqual([]);

    const present = new Set(files);
    const stale = [...assigned].filter((f) => !present.has(f));
    // A router that no longer exists must leave the baseline.
    expect(stale).toEqual([]);
  });

  it('a bare-family router gains no envelope, and a frozen entry only shrinks', () => {
    const grew: string[] = [];
    const shrank: string[] = [];
    for (const file of baseline.bare) {
      const frozen = baseline.frozenEnvelopes[file] ?? 0;
      const count = envelopeCount(file);
      if (count > frozen) grew.push(`${file}: ${count} > ${frozen}`);
      if (count < frozen) shrank.push(`${file}: ${count} < ${frozen}`);
    }
    // A bare-family router answered `{success: true, ...}` somewhere new.
    // Answer with the resource, or move the router to the enveloped family —
    // the ADR says which.
    expect(grew).toEqual([]);
    // Good news that must be recorded: lower the entry in frozenEnvelopes.
    expect(shrank).toEqual([]);
  });

  it('frozen entries name bare-family routers only', () => {
    const misplaced = Object.keys(baseline.frozenEnvelopes).filter(
      (f) => !baseline.bare.includes(f),
    );
    expect(misplaced).toEqual([]);
  });

  it('an enveloped-family router keeps at least one envelope', () => {
    const emptied = baseline.enveloped.filter((f) => envelopeCount(f) === 0);
    // The router changed shape entirely — record the move in the baseline.
    expect(emptied).toEqual([]);
  });
});
