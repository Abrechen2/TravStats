import { useCallback, useState } from "react";
import type { Flight } from "../../../types";

export interface FlightSelection {
  /** Whether the list shows its checkboxes at all. */
  selecting: boolean;
  start: () => void;
  /** Leaves selection mode and forgets the selection. */
  stop: () => void;
  /** The chosen flights, in the order they were chosen. Kept across pages. */
  selected: ReadonlyMap<string, Flight>;
  isSelected: (id: string) => boolean;
  toggle: (flight: Flight) => void;
  /** Adds every flight of the page in view. */
  selectAll: (flights: readonly Flight[]) => void;
  clear: () => void;
  /** Replaces chosen flights with fresher copies (after the list reloaded). */
  refresh: (flights: readonly Flight[]) => void;
}

/**
 * An EXPLICIT selection of flights for the bulk edit (forgejo#217): nothing is
 * selected by a filter or a page, only by the user's ticks. The rows keep
 * their objects so the preview can count what each one has today.
 */
export function useFlightSelection(): FlightSelection {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlyMap<string, Flight>>(new Map());
  const toggle = useCallback((flight: Flight) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(flight.id)) next.delete(flight.id);
      else next.set(flight.id, flight);
      return next;
    });
  }, []);
  const selectAll = useCallback((flights: readonly Flight[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const f of flights) next.set(f.id, f);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Map()), []);
  const start = useCallback(() => setSelecting(true), []);
  const stop = useCallback(() => {
    setSelecting(false);
    setSelected(new Map());
  }, []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);
  const refresh = useCallback((flights: readonly Flight[]) => {
    setSelected((prev) => {
      if (prev.size === 0 || !flights.some((f) => prev.has(f.id))) return prev;
      const next = new Map(prev);
      for (const f of flights) if (next.has(f.id)) next.set(f.id, f);
      return next;
    });
  }, []);
  return { selecting, start, stop, selected, isSelected, toggle, selectAll, clear, refresh };
}
