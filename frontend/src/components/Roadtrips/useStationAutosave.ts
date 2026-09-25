import { useCallback, useEffect, useRef, useState } from "react";

import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import { isSavable, type StationDraft } from "../../lib/roadtrip/roadtripView";
import type { RoadtripNights, RoadtripStation, StationInput } from "../../types/roadtrip";
import type { TourLeg, TourRoute } from "../../types/tour";

/** A station in the editor: a draft plus what only the editor needs. */
export interface EditorStation extends StationDraft {
  /** Stable across saves; a new station has no id until the server gives it one. */
  key: string;
  stayLabel?: string;
  stayCancelled?: boolean;
}

/**
 * `saved` — nothing to send. `pending` — a change waits for the pause.
 * `saving` — on its way. `error` — the last send failed; the edits are kept.
 * `waiting` — a station is not complete yet (no place, or a stay night
 * without its stay), and nothing is sent until it is.
 */
export type SaveStatus = "saved" | "pending" | "saving" | "error" | "waiting";

export interface SavedStations {
  roadtrip: TourRoute;
  nights: RoadtripNights;
  stations: RoadtripStation[];
  legs: TourLeg[];
}

let keySeq = 0;
export function newStationKey(): string {
  keySeq += 1;
  return `new-${Date.now()}-${keySeq}`;
}

export function toEditorStation(s: RoadtripStation): EditorStation {
  return {
    key: s.id,
    id: s.id,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    startDate: s.startDate,
    endDate: s.endDate,
    notes: s.notes,
    night:
      s.state === "stay" && s.lodgingStayId
        ? { kind: "stay", lodgingStayId: s.lodgingStayId }
        : s.state === "free"
          ? { kind: "free" }
          : { kind: "pass" },
    stayLabel: s.stay?.lodgingName,
    stayCancelled: s.stay?.status === "cancelled",
  };
}

function toInput(d: EditorStation & { lat: number; lon: number }): StationInput {
  return {
    ...(d.id ? { id: d.id } : {}),
    title: d.title.trim(),
    lat: d.lat,
    lon: d.lon,
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    notes: d.notes ?? null,
    night: d.night as StationInput["night"],
  };
}

const PAUSE_MS = 700;

/**
 * The editor's save loop (design 2026-09-25: "Alles wird sofort
 * gespeichert"). Every change waits for a short pause and then sends the
 * whole list — the endpoint replaces it atomically, so the editor never
 * sends a piece. A change made while a save is in flight sends again once it
 * lands, so the last word is always the reader's. A station that is not
 * complete holds the send back rather than being dropped from it: dropping
 * it would delete it on the server.
 */
export function useStationAutosave({
  routeId,
  initial,
  onSaved,
  pauseMs = PAUSE_MS,
}: {
  routeId: string;
  initial: EditorStation[];
  onSaved: (saved: SavedStations) => void;
  pauseMs?: number;
}): {
  drafts: EditorStation[];
  status: SaveStatus;
  change: (next: (prev: EditorStation[]) => EditorStation[]) => void;
  flush: () => Promise<void>;
} {
  const [drafts, setDrafts] = useState<EditorStation[]>(initial);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const latest = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const save = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const snapshot = latest.current;
    if (!snapshot.every(isSavable)) {
      setStatus("waiting");
      return;
    }
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    setStatus("saving");
    const run = (async () => {
      try {
        const saved = await roadtripsApi.replaceStations(
          routeId,
          (snapshot as Array<EditorStation & { lat: number; lon: number }>).map(toInput)
        );
        // New stations learn their ids by position in the list as SENT.
        const idByKey = new Map(snapshot.map((d, i) => [d.key, saved.stations[i]?.id]));
        const merged = latest.current.map((d) => {
          const id = d.id ?? idByKey.get(d.key);
          return id && id !== d.id ? { ...d, id } : d;
        });
        latest.current = merged;
        setDrafts(merged);
        onSavedRef.current(saved);
        setStatus(again.current ? "pending" : "saved");
      } catch (err) {
        logger.warn("Saving roadtrip stations failed", err);
        setStatus("error");
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (again.current) {
      again.current = false;
      await save();
    }
  }, [routeId]);

  const change = useCallback(
    (next: (prev: EditorStation[]) => EditorStation[]): void => {
      const value = next(latest.current);
      latest.current = value;
      setDrafts(value);
      setStatus(value.every(isSavable) ? "pending" : "waiting");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), pauseMs);
    },
    [save, pauseMs]
  );

  // Leaving the page with a change still waiting for its pause sends it.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [save]
  );

  return { drafts, status, change, flush: save };
}
