import { useMemo, useState } from "react";
import type { JSX } from "react";
import Modal from "../../Modal";
import { useBulkLookup } from "../../../hooks/useBulkLookup";
import { useTranslation } from "../../../hooks/useTranslation";
import { flightsApi } from "../../../lib/api/flights";
import { flightDeparture } from "../../../lib/entityTimes";
import { logger } from "../../../lib/logger";
import { lookupOutcomeText } from "../../../lib/lookupOutcomeText";
import { dayOf } from "../../../shared/time";
import type { Flight } from "../../../types";
import {
  planRefresh,
  type LookupAircraft,
  type RefreshField,
  type RefreshPlan,
} from "./flightRefreshModel";

type Applied = "applied" | "failed";

/**
 * "Flüge aktualisieren" (forgejo#407): the selected flights are put to the
 * flight-data provider through `POST /flight-lookup/bulk` (ten to a call, each
 * on its own day) and the answer is shown row by row BEFORE anything is
 * written. Only fields that are empty on the flight are filled; a flight the
 * provider could not be asked about says why.
 */
export default function FlightRefreshModal({
  flights,
  labelOf,
  onClose,
  onApplied,
}: {
  flights: readonly Flight[];
  labelOf: (flightId: string) => string;
  onClose: () => void;
  onApplied: () => void;
}): JSX.Element {
  const { t } = useTranslation(["flights", "errors", "common"]);
  const lookup = useBulkLookup<LookupAircraft>();
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ReadonlyMap<string, Applied>>(new Map());

  const rows = useMemo(
    () =>
      flights.map((f) => {
        const departure = flightDeparture(f);
        return {
          key: f.id,
          flightNumber: f.flightNumber ?? "",
          date: departure ? dayOf(departure) : null,
        };
      }),
    [flights]
  );

  const plans = useMemo(() => {
    const out = new Map<string, RefreshPlan>();
    for (const f of flights) {
      const outcome = lookup.outcomes.get(f.id);
      if (outcome?.status === "found") out.set(f.id, planRefresh(f, outcome));
    }
    return out;
  }, [flights, lookup.outcomes]);
  const fillable = flights.filter((f) => plans.get(f.id)?.kind === "fill" && !results.has(f.id));

  const apply = async (): Promise<void> => {
    setApplying(true);
    const next = new Map(results);
    for (const f of fillable) {
      const plan = plans.get(f.id);
      if (plan?.kind !== "fill") continue;
      try {
        await flightsApi.update(f.id, plan.patch);
        next.set(f.id, "applied");
      } catch (error) {
        logger.warn("Filling in a flight from the provider failed", error);
        next.set(f.id, "failed");
      }
    }
    setResults(next);
    setApplying(false);
    if ([...next.values()].includes("applied")) onApplied();
  };

  const asked = lookup.outcomes.size > 0;
  const muted = { color: "var(--text-muted)" };
  return (
    <Modal
      open
      onClose={onClose}
      busy={lookup.running || applying}
      title={t("flights:refresh.title")}
      maxWidth={640}
      closeLabel={t("flights:refresh.close")}
      testId="flight-refresh-modal"
      footer={
        <>
          {!asked && (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              disabled={lookup.running}
              onClick={() => void lookup.run(rows)}
            >
              {lookup.running && lookup.progress
                ? t("flights:refresh.running", lookup.progress)
                : t("flights:refresh.start")}
            </button>
          )}
          {fillable.length > 0 && (
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm"
              disabled={applying}
              onClick={() => void apply()}
            >
              {applying
                ? t("flights:refresh.applying")
                : t("flights:refresh.apply", { count: fillable.length })}
            </button>
          )}
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={onClose}>
            {t("flights:refresh.close")}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm" style={muted}>
        {t("flights:refresh.intro")}
      </p>
      {asked && (
        <ul className="flex flex-col gap-2" data-testid="flight-refresh-rows">
          {flights.map((f) => {
            const outcome = lookup.outcomes.get(f.id);
            const plan = plans.get(f.id);
            const applied = results.get(f.id);
            return (
              <li key={f.id} className="text-sm" data-testid="flight-refresh-row">
                <span className="font-medium">{labelOf(f.id)}</span>
                <span className="block text-xs" style={muted}>
                  {outcome ? lookupOutcomeText(outcome, t) : "—"}
                </span>
                {plan?.kind === "fill" && (
                  <span className="block text-xs">
                    {t("flights:refresh.willFill", {
                      fields: (Object.keys(plan.patch) as RefreshField[])
                        .map((field) => t(`flights:refresh.field.${field}`))
                        .join(", "),
                    })}
                  </span>
                )}
                {plan?.kind === "nothingNew" && (
                  <span className="block text-xs" style={muted}>
                    {t("flights:refresh.nothingNew")}
                  </span>
                )}
                {plan?.kind === "ambiguous" && (
                  <span className="block text-xs" style={muted}>
                    {t("flights:refresh.ambiguous")}
                  </span>
                )}
                {applied && (
                  <span
                    role={applied === "failed" ? "alert" : "status"}
                    className="block text-xs"
                    style={{ color: applied === "failed" ? "var(--ts-bad)" : "var(--ts-good)" }}
                  >
                    {t(
                      applied === "failed"
                        ? "flights:refresh.applyFailed"
                        : "flights:refresh.applied"
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
