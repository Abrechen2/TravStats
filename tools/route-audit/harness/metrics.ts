/**
 * Metric computation for the routing-strategy harness.
 *
 * Bearing reversal alone (the original audit metric) is necessary but
 * insufficient — Stage 1 / Stage 2 both improved kink count while making
 * the visual worse. We add land-crossing fraction, bending energy, and
 * detour ratio so a strategy that "smooths but cuts land" gets penalised
 * even if its kink count drops.
 */
import { haversineKm, bearingDeg, bearingDeviation } from '../../../backend/src/shared/geo/haversine';
import type { LegMetrics, Waypoint } from './types';

const FINE_SAMPLE_DEG = 0.05;

export function polylineLengthKm(coords: ReadonlyArray<Waypoint>): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversineKm(
      { lat: coords[i - 1][1], lon: coords[i - 1][0] },
      { lat: coords[i][1], lon: coords[i][0] },
    );
  }
  return km;
}

function variance(samples: ReadonlyArray<number>): number {
  if (samples.length < 2) return 0;
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  return samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
}

export function computeLegMetrics(
  waypoints: ReadonlyArray<Waypoint>,
  isLand: (lat: number, lon: number) => boolean,
): LegMetrics {
  if (waypoints.length < 2) {
    return {
      waypoints,
      chordKm: 0,
      polylineKm: 0,
      detourRatio: 1,
      worstKinkDeg: 0,
      kinkCount90: 0,
      kinkCount120: 0,
      kinkCount150: 0,
      bendingEnergy: 0,
      landSampleCount: 0,
      landFractionPct: 0,
      segmentLengthVarianceKm2: 0,
    };
  }
  const dep = { lat: waypoints[0][1], lon: waypoints[0][0] };
  const arr = { lat: waypoints[waypoints.length - 1][1], lon: waypoints[waypoints.length - 1][0] };
  const chordKm = haversineKm(dep, arr);
  const segmentLengths: number[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    segmentLengths.push(haversineKm(
      { lat: waypoints[i - 1][1], lon: waypoints[i - 1][0] },
      { lat: waypoints[i][1], lon: waypoints[i][0] },
    ));
  }
  const polylineKm = segmentLengths.reduce((s, x) => s + x, 0);

  let worstKinkDeg = 0;
  let kinkCount90 = 0;
  let kinkCount120 = 0;
  let kinkCount150 = 0;
  let bendingEnergy = 0;
  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = { lat: waypoints[i - 1][1], lon: waypoints[i - 1][0] };
    const curr = { lat: waypoints[i][1], lon: waypoints[i][0] };
    const next = { lat: waypoints[i + 1][1], lon: waypoints[i + 1][0] };
    const b1 = bearingDeg(prev, curr);
    const b2 = bearingDeg(curr, next);
    const delta = bearingDeviation(b1, b2);
    if (delta > worstKinkDeg) worstKinkDeg = delta;
    if (delta >= 90) kinkCount90++;
    if (delta >= 120) kinkCount120++;
    if (delta >= 150) kinkCount150++;
    const segKm = (segmentLengths[i - 1] + segmentLengths[i]) / 2;
    if (segKm > 1e-3) {
      const deltaRad = (delta * Math.PI) / 180;
      bendingEnergy += (deltaRad * deltaRad) / segKm;
    }
  }

  let landSamples = 0;
  let totalSamples = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const [lon0, lat0] = waypoints[i - 1];
    const [lon1, lat1] = waypoints[i];
    const dLon = lon1 - lon0;
    const dLat = lat1 - lat0;
    const segDeg = Math.hypot(dLon, dLat);
    const samples = Math.max(2, Math.ceil(segDeg / FINE_SAMPLE_DEG));
    for (let s = 1; s < samples; s++) {
      const t = s / samples;
      const lon = lon0 + dLon * t;
      const lat = lat0 + dLat * t;
      if (isLand(lat, lon)) landSamples++;
      totalSamples++;
    }
  }
  const landFractionPct = totalSamples === 0 ? 0 : (landSamples / totalSamples) * 100;

  return {
    waypoints,
    chordKm,
    polylineKm,
    detourRatio: chordKm < 1 ? 1 : polylineKm / chordKm,
    worstKinkDeg,
    kinkCount90,
    kinkCount120,
    kinkCount150,
    bendingEnergy,
    landSampleCount: landSamples,
    landFractionPct,
    segmentLengthVarianceKm2: variance(segmentLengths),
  };
}

export function percentile(values: ReadonlyArray<number>, p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((s, x) => s + x, 0) / values.length;
}
