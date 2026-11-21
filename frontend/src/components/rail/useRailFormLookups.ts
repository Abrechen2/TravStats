import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { trainLabel, useRailEntrySuggestions } from "../../hooks/useRailEntrySuggestions";
import type { Trip } from "../../types";
import type { RailFormDraft } from "./railFormModel";

/** The trips the form offers. */
export function useRailTripList(): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);
  // Non-fatal on purpose: without the list the field offers "no trip", which
  // beats taking the dialog down over a side lookup.
  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((all) => {
        if (!cancelled) setTrips(all);
      })
      .catch((err: unknown) => logger.warn("RailFormModal: failed to load trips", err));
    return () => {
      cancelled = true;
    };
  }, []);
  return trips;
}

/** Operator and train suggestions for the typed route, and picking one. */
export function useRailTrainSuggestions(
  draft: RailFormDraft,
  setDraft: Dispatch<SetStateAction<RailFormDraft>>
) {
  const { suggestions, failed: suggestionsFailed } = useRailEntrySuggestions({
    departure: draft.departure,
    arrival: draft.arrival,
    operator: draft.operator,
  });
  const typedTrain = trainLabel({
    category: draft.trainCategory.trim() || null,
    number: draft.trainNumber.trim(),
  });
  const trainChips = suggestions.trains.map(trainLabel);
  const pickTrain = (label: string): void => {
    const train = suggestions.trains.find((candidate) => trainLabel(candidate) === label);
    if (!train) return;
    setDraft((prev) => ({
      ...prev,
      trainCategory: train.category ?? "",
      trainNumber: train.number,
    }));
  };
  return { suggestions, suggestionsFailed, typedTrain, trainChips, pickTrain };
}
