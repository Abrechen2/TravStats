// Owns the measures that cannot be read off a single flight: seat streaks, the
// busiest calendar day, a route repeated on consecutive days, a same-day there
// and back, and a connection too tight to be comfortable. Every one of them
// needs the flights in relation to each other, in departure order.
//
// It is separate from `calculateUserStats` because it is a different pass over
// different data. That function walks the flights once, accumulating facts each
// flight carries by itself; this walks a re-sorted copy and asks about the gaps
// between them. They shared a function body only because they shared a
// variable. Splitting them also puts the two populations side by side where
// they can be seen: everything here reads `status === 'flown'` flights that
// carry a departure time, EXCEPT the hat-trick, which counts historical imports
// too because such an import carries a real date even when its time of day is a
// placeholder. That distinction is easy to lose inside a 350-line loop.

import type { FlightData } from './achievementStats';

export interface FlightSequenceStats {
  windowStreak: number;
  middleStreak: number;
  aisleStreak: number;
  maxFlightsOneDay: number;
  groundhogRoute: number;
  /** 1 when any calendar day holds a route and its exact reverse, else 0.
   *  A count-shaped flag because the requirement ladder compares numbers. */
  hasSameDayReturn: number;
  tightConnection: number;
}

export function computeFlightSequenceStats(flights: FlightData[]): FlightSequenceStats {
  const sorted = [...flights]
    .filter((f) => f.status === 'flown' && f.departureTime)
    .sort((a, b) => (a.departureTime!.getTime() - b.departureTime!.getTime()));

  // Window / Middle / Aisle streaks (based on seatNumber last char: A/F typically
  // window, B/E middle, C/D aisle — rough; G/H are the wide-body aisle letters)
  let winRun = 0;
  let maxWin = 0;
  let midRun = 0;
  let maxMid = 0;
  let aisleRun = 0;
  let maxAisle = 0;
  for (const f of sorted) {
    const seat = f.seatNumber?.toUpperCase().match(/[A-Z]$/)?.[0];
    if (!seat) {
      winRun = 0;
      midRun = 0;
      aisleRun = 0;
      continue;
    }
    // Conventional narrow-body mapping: A / F / K = window, C / D = aisle, B / E = middle
    if (seat === 'A' || seat === 'F' || seat === 'K') {
      winRun++;
      maxWin = Math.max(maxWin, winRun);
      midRun = 0;
      aisleRun = 0;
    } else if (seat === 'B' || seat === 'E') {
      midRun++;
      maxMid = Math.max(maxMid, midRun);
      winRun = 0;
      aisleRun = 0;
    } else if (seat === 'C' || seat === 'D' || seat === 'G' || seat === 'H') {
      aisleRun++;
      maxAisle = Math.max(maxAisle, aisleRun);
      winRun = 0;
      midRun = 0;
    } else {
      winRun = 0;
      midRun = 0;
      aisleRun = 0;
    }
  }

  // Hat-Trick — most flights on one calendar day. Counts flown + historical
  // alike: a historical import carries a real date even when the time of day
  // is a placeholder.
  const flightsPerDay = new Map<string, number>();
  for (const f of flights) {
    if (!f.departureTime) continue;
    const dayKey = f.departureTime.toISOString().slice(0, 10);
    flightsPerDay.set(dayKey, (flightsPerDay.get(dayKey) ?? 0) + 1);
  }
  const maxFlightsOneDay = Math.max(0, ...flightsPerDay.values());

  // Groundhog Day — same route on three consecutive calendar days
  const routesByDay = new Map<string, Set<string>>();
  for (const f of sorted) {
    const key = (f.departureTime!.toISOString().slice(0, 10));
    const route = `${f.depIata || f.depIcao}-${f.arrIata || f.arrIcao}`;
    if (!routesByDay.has(key)) routesByDay.set(key, new Set());
    routesByDay.get(key)!.add(route);
  }
  const days = Array.from(routesByDay.keys()).sort();
  let maxGroundhog = 0;
  for (let i = 0; i < days.length; i++) {
    for (const route of routesByDay.get(days[i])!) {
      let streak = 1;
      let prev = new Date(days[i]);
      for (let j = i + 1; j < days.length; j++) {
        const curr = new Date(days[j]);
        const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        if (diff === 1 && routesByDay.get(days[j])!.has(route)) {
          streak++;
          prev = curr;
        } else if (diff > 1) {
          break;
        }
      }
      maxGroundhog = Math.max(maxGroundhog, streak);
    }
  }

  // There and Back Again — one calendar day holding a route AND its exact
  // reverse. Reuses the flown-only routesByDay map built for Groundhog Day.
  const hasReversePair = (routes: Set<string>): boolean => {
    for (const route of routes) {
      const [a, b] = route.split('-');
      if (a && b && a !== 'null' && b !== 'null' && a !== b && routes.has(`${b}-${a}`)) {
        return true;
      }
    }
    return false;
  };
  let hasSameDayReturn = 0;
  if (Array.from(routesByDay.values()).some(hasReversePair)) {
    hasSameDayReturn = 1;
  }

  // Tight connection — any consecutive flight pair where arrival airport == next departure airport,
  // and the gap between arrivalTime and next departureTime is < 45 minutes (but > 0).
  let tightConnection = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a.arrivalTime || !b.departureTime) continue;
    const aArr = a.arrIata || a.arrIcao;
    const bDep = b.depIata || b.depIcao;
    if (aArr && bDep && aArr === bDep) {
      const gapMin = (b.departureTime.getTime() - a.arrivalTime.getTime()) / 60000;
      if (gapMin > 0 && gapMin < 45) {
        tightConnection++;
      }
    }
  }

  return {
    windowStreak: maxWin,
    middleStreak: maxMid,
    aisleStreak: maxAisle,
    maxFlightsOneDay,
    groundhogRoute: maxGroundhog,
    hasSameDayReturn,
    tightConnection,
  };
}
