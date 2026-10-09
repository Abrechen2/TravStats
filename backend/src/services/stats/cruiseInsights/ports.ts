/**
 * Ports over the cruises (forgejo#257): new ports against ports seen again,
 * per year and per cruise; the longest pause before a port was seen again; the
 * ports called at on several cruises; and identical itineraries. Pure.
 *
 * ## The unit: a port of a cruise
 *
 * A CATALOGUE port in the cruise's effective sequence — departure port, the
 * port calls in day order, arrival port (`shared/cruise/portSequence.ts`, the
 * rule every port figure uses). A port called at twice on one cruise is one
 * port of that cruise. An unresolved port (an imported name nothing matched)
 * is a real call but cannot be told apart from another, so it is counted
 * apart (`unresolvedCalls`) and never as new or as seen again.
 *
 * ## New and seen again
 *
 * Judged against every sailed cruise, oldest start first — the whole logbook
 * is the reference, so the first cruise discovers every port it calls at. A
 * cruise without a start date cannot be placed in that order: its ports are
 * neither, and it is counted in `undatedCruises`.
 */

import { buildEffectivePortSequence } from "../../../shared/cruise/portSequence";
import type { CruiseInsightRow } from "./rows";
import { daysBetween } from "./rows";

export interface CruisePort {
  id: number;
  name: string;
  /** The first and last day the port appears on this cruise. */
  firstDay: string | null;
  lastDay: string | null;
}

/** The cruise's distinct catalogue ports, in sequence order. */
export function portsOfCruise(row: CruiseInsightRow): CruisePort[] {
  const calls = row.calls.filter((c) => !c.isAtSea && c.portId !== null);
  const sequence = buildEffectivePortSequence<{ id: number; name: string; day: string | null }>(
    row.input.departurePort ? { ...row.input.departurePort, day: row.startDay } : null,
    calls.map((c) => ({ id: c.portId as number, name: c.portName ?? "", day: c.day })),
    row.input.arrivalPort ? { ...row.input.arrivalPort, day: row.endDay } : null
  );
  const out = new Map<number, CruisePort>();
  for (const p of sequence) {
    const seen = out.get(p.id);
    out.set(p.id, {
      id: p.id,
      name: seen?.name || p.name,
      firstDay: seen?.firstDay ?? p.day,
      lastDay: p.day ?? seen?.lastDay ?? null,
    });
  }
  return [...out.values()];
}

/** Port calls at an unresolved port — real calls no catalogue id can name. */
export const unresolvedCallsOf = (row: CruiseInsightRow): number =>
  row.calls.filter((c) => !c.isAtSea && c.portId === null && c.portName !== null).length;

/** Dated cruises, oldest start first — the order "new" is judged in. */
export function datedInOrder(rows: readonly CruiseInsightRow[]): CruiseInsightRow[] {
  return rows
    .filter((r) => r.startDay !== null)
    .sort((a, b) => a.startDay!.localeCompare(b.startDay!) || a.id.localeCompare(b.id));
}

export interface CruisePortFold {
  cruiseId: string;
  newPorts: CruisePort[];
  revisitedPorts: CruisePort[];
}

/** Per dated cruise, which of its ports were new and which were seen on an earlier cruise. */
export function foldNewAndRevisited(rows: readonly CruiseInsightRow[]): CruisePortFold[] {
  const seen = new Set<number>();
  return datedInOrder(rows).map((row) => {
    const ports = portsOfCruise(row);
    const fold = {
      cruiseId: row.id,
      newPorts: ports.filter((p) => !seen.has(p.id)),
      revisitedPorts: ports.filter((p) => seen.has(p.id)),
    };
    ports.forEach((p) => seen.add(p.id));
    return fold;
  });
}

export interface PortReunion {
  portId: number;
  portName: string;
  fromCruiseId: string;
  toCruiseId: string;
  fromDay: string;
  toDay: string;
  days: number;
}

/**
 * The longest pause before a port was seen again: from the last day it was on
 * one cruise to the first day it was on the next. Null with no port on two
 * dated cruises.
 */
export function longestPortReunion(rows: readonly CruiseInsightRow[]): PortReunion | null {
  const last = new Map<number, { cruiseId: string; day: string }>();
  let best: PortReunion | null = null;
  for (const row of datedInOrder(rows)) {
    for (const port of portsOfCruise(row)) {
      const before = last.get(port.id);
      if (before && port.firstDay) {
        const days = daysBetween(before.day, port.firstDay);
        if (best === null || days > best.days) {
          best = {
            portId: port.id,
            portName: port.name,
            fromCruiseId: before.cruiseId,
            toCruiseId: row.id,
            fromDay: before.day,
            toDay: port.firstDay,
            days,
          };
        }
      }
      if (port.lastDay) last.set(port.id, { cruiseId: row.id, day: port.lastDay });
    }
  }
  return best;
}

/** A cruise's distinct catalogue ports among its PORT CALLS only — no embarkation or disembarkation port. */
function calledPortsOf(row: CruiseInsightRow): Array<{ id: number; name: string }> {
  const out = new Map<number, string>();
  for (const c of row.calls) {
    if (!c.isAtSea && c.portId !== null && !out.has(c.portId)) out.set(c.portId, c.portName ?? "");
  }
  return [...out.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * Every catalogue port and the sailed cruises it was on — dated or not.
 * `callsOnly` leaves the embarkation and disembarkation ports out: the badge
 * counts port calls only (owner ruling 2026-10-09), because a home port every
 * cruise starts from would otherwise earn it.
 */
export function cruisesPerPort(
  rows: readonly CruiseInsightRow[],
  { callsOnly = false }: { callsOnly?: boolean } = {}
): Array<{ portId: number; portName: string; cruiseIds: string[] }> {
  const ports = new Map<number, { portName: string; cruiseIds: string[] }>();
  for (const row of rows) {
    for (const port of callsOnly ? calledPortsOf(row) : portsOfCruise(row)) {
      const entry = ports.get(port.id) ?? { portName: port.name, cruiseIds: [] };
      ports.set(port.id, { ...entry, cruiseIds: [...entry.cruiseIds, row.id] });
    }
  }
  return [...ports.entries()]
    .map(([portId, e]) => ({ portId, ...e }))
    .sort(
      (a, b) => b.cruiseIds.length - a.cruiseIds.length || a.portName.localeCompare(b.portName)
    );
}

/**
 * Identical itineraries: sailed cruises whose FULL port sequence is the same,
 * port by port in day order — departure port, every call, arrival port, sea
 * days ignored. Two ports at least; a cruise with an unresolved call takes
 * part in no comparison, because an unmatched name cannot be shown to be the
 * same port. Groups of `minCruises` or more, largest first.
 */
export function repeatedItineraries(
  rows: readonly CruiseInsightRow[],
  /** 2 for the list; 1 lets a badge read "one cruise has this itinerary so far". */
  minCruises = 2
): Array<{ ports: Array<{ id: number; name: string }>; cruiseIds: string[] }> {
  const groups = new Map<
    string,
    { ports: Array<{ id: number; name: string }>; cruiseIds: string[] }
  >();
  for (const row of rows) {
    if (unresolvedCallsOf(row) > 0) continue;
    const calls = row.calls.filter((c) => !c.isAtSea && c.portId !== null);
    const sequence = buildEffectivePortSequence<{ id: number; name: string }>(
      row.input.departurePort,
      calls.map((c) => ({ id: c.portId as number, name: c.portName ?? "" })),
      row.input.arrivalPort
    ).map((p) => ({ id: p.id, name: p.name }));
    if (sequence.length < 2) continue;
    const key = sequence.map((p) => p.id).join(">");
    const group = groups.get(key) ?? { ports: sequence, cruiseIds: [] };
    groups.set(key, { ...group, cruiseIds: [...group.cruiseIds, row.id] });
  }
  return [...groups.values()]
    .filter((g) => g.cruiseIds.length >= minCruises)
    .sort((a, b) => b.cruiseIds.length - a.cruiseIds.length || a.ports.length - b.ports.length);
}
