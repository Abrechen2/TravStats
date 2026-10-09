import { useCallback, useEffect, useRef, useState } from "react";

import { roadtripsApi } from "../../lib/api/roadtrips";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { isSavable } from "../../lib/roadtrip/roadtripView";
import { toEditorStation, type EditorStation } from "../../lib/roadtrip/editorStation";
import type { RoadtripNights, RoadtripStation, StationInput } from "../../types/roadtrip";
import type { TourLeg, TourRoute } from "../../types/tour";

export { toEditorStation, type EditorStation };

/**
 * `saved` — the server holds every change. `pending` — a change waits for the
 * pause. `saving` — on its way. `error` — the last send failed; the edits are
 * kept. `waiting` — a station is not complete yet (no place, or a stay night
 * without its stay), and nothing is sent until it is. `conflict` — the server's
 * station list changed since it was read (the phone added or removed one);
 * nothing was sent, and the edits wait to be merged (forgejo#244).
 */
export const SAVE_STATUSES = [
  "saved",
  "pending",
  "saving",
  "error",
  "waiting",
  "conflict",
] as const;
export type SaveStatus = (typeof SAVE_STATUSES)[number];

/**
 * Where the edits the server does not hold yet are kept, apart from the page:
 * `none` — there are none; `kept` — in this browser (`stationDraftStore`), so
 * a reload or a closed tab does not lose them; `failed` — the browser refused
 * to keep them, and they live only on this page.
 */
export type LocalDraftState = "none" | "kept" | "failed";

/** Persists the local draft; the editor's caller binds it to user and roadtrip. */
export interface StationDraftSink {
  write: (draft: { base: EditorStation[]; drafts: EditorStation[] }) => boolean;
  clear: () => void;
}

export interface SavedStations {
  roadtrip: TourRoute;
  nights: RoadtripNights;
  stations: RoadtripStation[];
  legs: TourLeg[];
}

let keySeq = 0;
export function newStationKey(): string {
  keySeq += 1;
  // A counter alone restarts at every page load, and a restored draft may
  // carry keys from an earlier one; the random part keeps them apart.
  return `new-${keySeq}-${Math.random().toString(36).slice(2, 10)}`;
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
/** The editor's undo window; a held change waits this long. */
export const HOLD_MS = 8000;

/**
 * The editor's save loop (design 2026-09-25: "Alles wird sofort
 * gespeichert"). Every change waits for a short pause and then sends the
 * whole list — the endpoint replaces it atomically, so the editor never
 * sends a piece. A change made while a save is in flight sends again once it
 * lands, so the last word is always the reader's. A station that is not
 * complete holds the send back rather than being dropped from it: dropping
 * it would delete it on the server.
 *
 * forgejo#244, three additions:
 * - every unsent change is also written to the LOCAL draft (`sink`), and the
 *   draft is cleared once the server confirmed the last change — so the
 *   status can say "lokal gesichert" apart from "auf dem Server gespeichert";
 * - each write names the station ids it was based on (`expectedStationIds`).
 *   A station the phone appended meanwhile makes the server refuse the write
 *   (status `conflict`) instead of being deleted by a list that never knew it;
 * - `rebase` continues from a merged list after such a conflict (or a restored
 *   draft), and `discard` returns to what the server holds.
 *
 * forgejo#242: a change made with `{ hold: true }` (a removal, a reorder) is
 * not sent until `holdMs` has passed or `releaseHold` is called. The server
 * drops the legs of every pair that stops being adjacent — a recorded or
 * hand-drawn line with them — so an "undo" after the write could restore the
 * order but never the line. Held, the undo restores both, because nothing
 * was sent. "Fertig" and leaving the page still send at once.
 */
export function useStationAutosave({
  routeId,
  initial,
  restored = null,
  onSaved,
  sink = null,
  pauseMs = PAUSE_MS,
  holdMs = HOLD_MS,
}: {
  routeId: string;
  /** The station list as the server holds it — the base of every write. */
  initial: EditorStation[];
  /** A local draft to continue from (already merged with `initial`). */
  restored?: EditorStation[] | null;
  onSaved: (saved: SavedStations) => void;
  sink?: StationDraftSink | null;
  pauseMs?: number;
  /** How long a held change waits — the undo window. */
  holdMs?: number;
}): {
  drafts: EditorStation[];
  status: SaveStatus;
  local: LocalDraftState;
  /** The list the server confirmed last — `base` of a merge. */
  serverStations: () => EditorStation[];
  change: (next: (prev: EditorStation[]) => EditorStation[], options?: { hold?: boolean }) => void;
  /** Send a held change now (after its undo, or when the window closes). */
  releaseHold: () => void;
  flush: () => Promise<SaveStatus>;
  rebase: (server: EditorStation[], merged: EditorStation[]) => void;
  discard: () => void;
} {
  const start = restored ?? initial;
  const [drafts, setDrafts] = useState<EditorStation[]>(start);
  const [status, setStatusState] = useState<SaveStatus>("saved");
  const [local, setLocal] = useState<LocalDraftState>("none");
  const statusRef = useRef<SaveStatus>("saved");
  const latest = useRef(start);
  const server = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const again = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const sinkRef = useRef(sink);
  sinkRef.current = sink;

  const setStatus = useCallback((next: SaveStatus): void => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const keepLocally = useCallback((): void => {
    const target = sinkRef.current;
    if (!target) return;
    setLocal(target.write({ base: server.current, drafts: latest.current }) ? "kept" : "failed");
  }, []);

  const forgetLocally = useCallback((): void => {
    sinkRef.current?.clear();
    setLocal("none");
  }, []);

  /** One write of the list as it stands now. */
  const sendOnce = useCallback(async (): Promise<void> => {
    const snapshot = latest.current;
    if (!snapshot.every(isSavable)) {
      setStatus("waiting");
      return;
    }
    setStatus("saving");
    try {
      const saved = await roadtripsApi.replaceStations(
        routeId,
        (snapshot as Array<EditorStation & { lat: number; lon: number }>).map(toInput),
        server.current.flatMap((s) => (s.id ? [s.id] : []))
      );
      // The server answers the list in the order it was SENT; that is how
      // new stations learn their ids, and what the next write is based on.
      server.current = snapshot.map((d, i) =>
        saved.stations[i] ? { ...toEditorStation(saved.stations[i]), key: d.key } : d
      );
      const changedMeanwhile = latest.current !== snapshot;
      const idByKey = new Map(snapshot.map((d, i) => [d.key, saved.stations[i]?.id]));
      const merged = latest.current.map((d) => {
        const id = d.id ?? idByKey.get(d.key);
        return id && id !== d.id ? { ...d, id } : d;
      });
      latest.current = merged;
      setDrafts(merged);
      onSavedRef.current(saved);
      if (changedMeanwhile) {
        keepLocally();
        setStatus("pending");
      } else {
        forgetLocally();
        setStatus("saved");
      }
    } catch (err) {
      if (apiErrorMachineCode(err) === "ROADTRIP_STATIONS_CHANGED") {
        logger.warn("Roadtrip stations changed on the server; the edits wait to be merged");
        setStatus("conflict");
      } else {
        logger.warn("Saving roadtrip stations failed", err);
        setStatus("error");
      }
    }
  }, [routeId, keepLocally, forgetLocally, setStatus]);

  const active = useRef<Promise<SaveStatus> | null>(null);

  const save = useCallback(async (): Promise<SaveStatus> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (held.current) {
      clearTimeout(held.current);
      held.current = null;
    }
    // A conflict is settled by `rebase` or `discard`, never by sending again.
    if (statusRef.current === "conflict") return "conflict";
    // A save already running sends once more when it lands — and this caller
    // waits for that, so "Fertig" never reads a status from half-way.
    if (active.current) {
      again.current = true;
      return active.current;
    }
    const loop = (async (): Promise<SaveStatus> => {
      do {
        again.current = false;
        await sendOnce();
      } while (again.current && statusRef.current !== "conflict");
      return statusRef.current;
    })();
    active.current = loop;
    try {
      return await loop;
    } finally {
      active.current = null;
    }
  }, [sendOnce]);

  const schedule = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), pauseMs);
  }, [save, pauseMs]);

  const releaseHold = useCallback((): void => {
    if (held.current) {
      clearTimeout(held.current);
      held.current = null;
    }
    if (statusRef.current !== "conflict" && statusRef.current !== "saved") schedule();
  }, [schedule]);

  const change = useCallback(
    (next: (prev: EditorStation[]) => EditorStation[], options: { hold?: boolean } = {}): void => {
      const value = next(latest.current);
      latest.current = value;
      setDrafts(value);
      keepLocally();
      if (statusRef.current === "conflict") return;
      setStatus(value.every(isSavable) ? "pending" : "waiting");
      if (options.hold) {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        if (held.current) clearTimeout(held.current);
        held.current = setTimeout(() => {
          held.current = null;
          schedule();
        }, holdMs);
        return;
      }
      // While a change is held, nothing goes out early: the hold sends it all.
      if (held.current) return;
      schedule();
    },
    [keepLocally, schedule, setStatus, holdMs]
  );

  const rebase = useCallback(
    (nextServer: EditorStation[], merged: EditorStation[]): void => {
      server.current = nextServer;
      latest.current = merged;
      setDrafts(merged);
      keepLocally();
      setStatus(merged.every(isSavable) ? "pending" : "waiting");
      schedule();
    },
    [keepLocally, schedule, setStatus]
  );

  const discard = useCallback((): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (held.current) {
      clearTimeout(held.current);
      held.current = null;
    }
    latest.current = server.current;
    setDrafts(server.current);
    forgetLocally();
    setStatus("saved");
  }, [forgetLocally, setStatus]);

  // A restored draft is unsent work: keep it locally and send it after the pause.
  useEffect(() => {
    if (!restored) return;
    keepLocally();
    setStatus(restored.every(isSavable) ? "pending" : "waiting");
    schedule();
  }, []);

  // Leaving the page with a change still waiting for its pause sends it. If
  // that send fails, the local draft is still there for the next opening.
  useEffect(
    () => () => {
      if (timer.current || held.current) {
        if (timer.current) clearTimeout(timer.current);
        if (held.current) clearTimeout(held.current);
        timer.current = null;
        held.current = null;
        void save();
      }
    },
    [save]
  );

  // A reload or a closed tab with unsent changes: the browser asks first
  // (forgejo#248). The local draft would bring them back, but only on this
  // device — the question is the cheaper rescue.
  const unsent = status !== "saved";
  useEffect(() => {
    if (!unsent) return;
    const ask = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [unsent]);

  const serverStations = useCallback((): EditorStation[] => server.current, []);

  return {
    drafts,
    status,
    local,
    serverStations,
    change,
    releaseHold,
    flush: save,
    rebase,
    discard,
  };
}
