import { useCallback, useRef, useState } from "react";
import { apiErrorMachineCode } from "../../lib/apiError";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import { flightSaveFailure } from "./flightSaveFailure";
import type { Airport } from "../../lib/api";
import type { Flight, FlightInput } from "../../types";
import type { DuplicateFlight, FlightSubmitOptions } from "./flightFormModel";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The four ways the create form saves. */
export type FlightSubmitVariant = "save" | "saveAndReturn" | "force" | "merge";

/**
 * A refused save, kept apart from the sentence (forgejo#246, #247): the key
 * decides whether a retry is offered, the field whether the message belongs
 * beside an input rather than in the banner.
 */
export interface FlightSubmitFailure {
  key: string;
  /** The input the server named (`field` of its answer), or null. */
  field: string | null;
  variant: FlightSubmitVariant;
}

interface Deps {
  t: Translate;
  departure: Airport | null;
  arrival: Airport | null;
  canSubmit: boolean;
  onSubmit: (flight: FlightInput, opts?: FlightSubmitOptions) => Promise<Flight | void>;
  buildFlightPayload: () => FlightInput;
  storeHistoricalData: () => void;
  maybeAssignTrip: (created: Flight | void) => Promise<void>;
  prepareReturnFlightForm: () => void;
  afterReturnPrepared: () => void;
  setLoading: (loading: boolean) => void;
  setError: (message: string) => void;
  setDuplicateFlight: (flight: DuplicateFlight | null) => void;
  setTimeEstimationWarning: (warning: null) => void;
}

function fieldOf(err: unknown): string | null {
  const data = (err as { response?: { data?: { field?: unknown } } } | null)?.response?.data;
  return typeof data?.field === "string" && data.field !== "" ? data.field : null;
}

/**
 * The create form's four submit paths — save, save-and-return, force and
 * merge — in ONE runner (forgejo#247). They were four copies of the same
 * twenty lines in `useFlightForm`, and none of them could tell what had
 * failed beyond a sentence.
 *
 * - **One request at a time.** A ref, not the `loading` state: two clicks in
 *   one frame (or Enter plus a click) both saw `loading === false` and each
 *   created the flight.
 * - **The failure keeps its key and field**, so the form can offer "Erneut
 *   versuchen" for a dropped connection and put a time the server refused
 *   beside that time.
 * - **`retry()` repeats the path that failed**, with the same payload rules.
 *
 * Behaviour is otherwise exactly what the four handlers did: the same guards
 * and sentences, a 409 with the existing flight opens the duplicate question
 * (save and save-and-return only), the trip assignment runs after a create.
 */
export function useFlightSubmit(deps: Deps): {
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleSubmitAndReturn: (e: React.FormEvent) => Promise<void>;
  handleForceSubmit: () => Promise<void>;
  handleMergeSubmit: () => Promise<void>;
  failure: FlightSubmitFailure | null;
  clearFailure: () => void;
  retry: () => Promise<void>;
  /** Counts saves that went through — a form that stays open starts its discard guard over. */
  savedCount: number;
} {
  const inFlight = useRef(false);
  const [failure, setFailure] = useState<FlightSubmitFailure | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const run = useCallback(async (variant: FlightSubmitVariant): Promise<void> => {
    const d = depsRef.current;
    if (variant === "force" || variant === "merge") d.setDuplicateFlight(null);
    if (!d.departure || !d.arrival) {
      d.setError(d.t("errors:missingAirports"));
      return;
    }
    // canSubmit only greys out the button; Enter in any input still submits
    // the form. The time rules have to hold here too, or the guard is
    // decorative — that is how a blank required time reached the wire as noon.
    // (Force and merge come from the duplicate question, after a save that
    // passed this guard.)
    if ((variant === "save" || variant === "saveAndReturn") && !d.canSubmit) {
      d.setError(d.t("errors:missingTimes"));
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    d.setLoading(true);
    d.setError("");
    setFailure(null);
    try {
      d.storeHistoricalData();
      d.setTimeEstimationWarning(null);
      const opts: FlightSubmitOptions | undefined =
        variant === "saveAndReturn"
          ? { hasMoreFlights: true }
          : variant === "force"
            ? { force: true }
            : variant === "merge"
              ? { merge: true }
              : undefined;
      const created = await (opts
        ? d.onSubmit(d.buildFlightPayload(), opts)
        : d.onSubmit(d.buildFlightPayload()));
      await d.maybeAssignTrip(created);
      setSavedCount((n) => n + 1);
      if (variant === "saveAndReturn") {
        d.prepareReturnFlightForm();
        d.afterReturnPrepared();
      }
    } catch (err: unknown) {
      const outcome = flightSaveFailure(err, d.t);
      if (outcome.kind === "duplicate" && (variant === "save" || variant === "saveAndReturn")) {
        d.setDuplicateFlight(outcome.existing);
        return;
      }
      const key = saveErrorKey(err, "errors:saveFailed");
      d.setError(outcome.kind === "message" ? outcome.message : d.t(key));
      setFailure({
        key,
        field: apiErrorMachineCode(err) ? fieldOf(err) : null,
        variant,
      });
    } finally {
      inFlight.current = false;
      d.setLoading(false);
    }
  }, []);

  const retry = useCallback(async (): Promise<void> => {
    if (failure) await run(failure.variant);
  }, [failure, run]);

  return {
    handleSubmit: async (e) => {
      e.preventDefault();
      await run("save");
    },
    handleSubmitAndReturn: async (e) => {
      e.preventDefault();
      await run("saveAndReturn");
    },
    handleForceSubmit: () => run("force"),
    handleMergeSubmit: () => run("merge"),
    failure,
    clearFailure: useCallback(() => setFailure(null), []),
    retry,
    savedCount,
  };
}
