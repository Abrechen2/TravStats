/**
 * GeoJSON exporter — one FeatureCollection per strategy. Routes are
 * LineStrings; kinks are Points colour-coded by severity. Drop the
 * file into geojson.io for visual inspection.
 */
import fs from 'fs';
import path from 'path';
import { bearingDeg, bearingDeviation } from '../../../backend/src/shared/geo/haversine';
import type { LegMetrics, StrategyLegOutcome, StrategySummary, Waypoint } from './types';

interface Feature {
  readonly type: 'Feature';
  readonly geometry:
    | { readonly type: 'LineString'; readonly coordinates: ReadonlyArray<Waypoint> }
    | { readonly type: 'Point'; readonly coordinates: Waypoint };
  readonly properties: Record<string, unknown>;
}

interface FeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: ReadonlyArray<Feature>;
}

const SEVERITY_COLOR: ReadonlyArray<readonly [number, string]> = [
  [150, '#ff0000'],
  [120, '#ff8c00'],
  [90, '#ffd700'],
];

function severityColor(deltaDeg: number): string {
  for (const [threshold, color] of SEVERITY_COLOR) if (deltaDeg >= threshold) return color;
  return '#90ee90';
}

function legToFeatures(outcome: StrategyLegOutcome): Feature[] {
  const m = outcome.metrics;
  const wpts = m.waypoints;
  const lineColor = m.worstKinkDeg >= 150
    ? '#ff0000'
    : m.worstKinkDeg >= 120
    ? '#ff8c00'
    : m.worstKinkDeg >= 90
    ? '#ffd700'
    : m.landFractionPct > 5
    ? '#9400d3'
    : '#1e90ff';
  const features: Feature[] = [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: wpts as unknown as Waypoint[] },
      properties: {
        kind: 'route',
        cruise: outcome.cruise,
        legIndex: outcome.legIndex,
        leg: `${outcome.dep.name} → ${outcome.arr.name}`,
        worstKinkDeg: Math.round(m.worstKinkDeg * 10) / 10,
        kinkCount90: m.kinkCount90,
        kinkCount120: m.kinkCount120,
        kinkCount150: m.kinkCount150,
        chordKm: Math.round(m.chordKm),
        polylineKm: Math.round(m.polylineKm),
        detourRatio: Math.round(m.detourRatio * 100) / 100,
        bendingEnergy: Math.round(m.bendingEnergy * 100) / 100,
        landSampleCount: m.landSampleCount,
        landFractionPct: Math.round(m.landFractionPct * 10) / 10,
        waypointCount: wpts.length,
        elapsedMs: outcome.elapsedMs,
        stroke: lineColor,
        'stroke-width': 2,
        ...(outcome.meta ?? {}),
      },
    },
  ];
  for (let i = 1; i < wpts.length - 1; i++) {
    const prev = { lat: wpts[i - 1][1], lon: wpts[i - 1][0] };
    const curr = { lat: wpts[i][1], lon: wpts[i][0] };
    const next = { lat: wpts[i + 1][1], lon: wpts[i + 1][0] };
    const delta = bearingDeviation(bearingDeg(prev, curr), bearingDeg(curr, next));
    if (delta < 90) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: wpts[i] },
      properties: {
        kind: 'kink',
        cruise: outcome.cruise,
        legIndex: outcome.legIndex,
        deltaDeg: Math.round(delta * 10) / 10,
        'marker-color': severityColor(delta),
        'marker-size': delta >= 130 ? 'large' : 'medium',
      },
    });
  }
  return features;
}

export function exportStrategyGeoJson(
  outDir: string,
  strategyName: string,
  outcomes: ReadonlyArray<StrategyLegOutcome>,
): string {
  fs.mkdirSync(outDir, { recursive: true });
  const features: Feature[] = [];
  for (const outcome of outcomes) {
    if (outcome.errored) continue;
    features.push(...legToFeatures(outcome));
  }
  const fc: FeatureCollection = { type: 'FeatureCollection', features };
  const file = path.join(outDir, `${strategyName}.geojson`);
  fs.writeFileSync(file, JSON.stringify(fc));
  return file;
}

export function exportSummaryJson(
  outDir: string,
  summaries: ReadonlyArray<StrategySummary>,
  outcomesByStrategy: ReadonlyMap<string, ReadonlyArray<StrategyLegOutcome>>,
): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'harness-summary.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    summaries,
    perLeg: Object.fromEntries(
      Array.from(outcomesByStrategy.entries()).map(([name, outcomes]) => [
        name,
        outcomes.map((o) => ({
          cruise: o.cruise,
          legIndex: o.legIndex,
          dep: o.dep.name,
          arr: o.arr.name,
          errored: o.errored,
          errorMessage: o.errorMessage,
          metrics: cleanMetrics(o.metrics),
          meta: o.meta ?? null,
        })),
      ]),
    ),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function cleanMetrics(m: LegMetrics): Omit<LegMetrics, 'waypoints'> & { waypointCount: number } {
  const { waypoints, ...rest } = m;
  return { ...rest, waypointCount: waypoints.length };
}

export function renderSummaryTable(summaries: ReadonlyArray<StrategySummary>): string {
  if (summaries.length === 0) return '(no summaries)';
  const headers = [
    'strategy',
    'errored',
    'clean',
    '≥90°',
    '≥120°',
    '≥150°',
    'meanWorst°',
    'p95Worst°',
    'meanBend',
    'meanDetour',
    'p95Detour',
    'meanLand%',
    'maxLand%',
    'msTotal',
  ];
  const rows = summaries.map((s) => [
    s.name,
    String(s.legsErrored),
    String(s.legsClean),
    String(s.legsKinky90),
    String(s.legsKinky120),
    String(s.legsKinky150),
    s.meanWorstKinkDeg.toFixed(1),
    s.p95WorstKinkDeg.toFixed(1),
    s.meanBendingEnergy.toFixed(2),
    s.meanDetourRatio.toFixed(2),
    s.p95DetourRatio.toFixed(2),
    s.meanLandFractionPct.toFixed(1),
    s.maxLandFractionPct.toFixed(1),
    String(s.totalElapsedMs),
  ]);

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells: ReadonlyArray<string>): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [fmt(headers), fmt(widths.map((w) => '-'.repeat(w))), ...rows.map(fmt)].join('\n');
}
