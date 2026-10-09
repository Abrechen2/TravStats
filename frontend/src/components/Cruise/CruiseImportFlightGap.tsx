import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { tripsApi } from "../../lib/api/trips";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { formatLocalDate } from "../../lib/displayFormat";
import { FormErrorBanner } from "../form";
import { storeFlights } from "./cruiseImportFlights";
import type { FlightGapItem } from "./cruiseImportFlights";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "LH123 · 05.10.2026", or the route where the booking gave no number. */
function flightLabel(t: Translate, item: FlightGapItem): string {
  const { flight } = item;
  const name =
    flight.flightNumber?.trim() ||
    `${flight.departure.iata ?? flight.departure.name ?? "?"} → ${flight.arrival.iata ?? flight.arrival.name ?? "?"}`;
  const day = (flight.departureLocal ?? "").slice(0, 10);
  return t("flightGap.item", {
    flight: day ? `${name} · ${formatLocalDate(day)}` : name,
    reason: t(`flightGap.reason.${item.reason}`),
  });
}

/**
 * The fly & cruise flights an import did not store, named one by one, with a
 * retry that stores ONLY the missing ones (forgejo#225, re-review residual):
 * each is looked up in the logbook first, so a flight that did arrive the
 * first time — the request timed out, say — is not created twice.
 *
 * "Ohne diese Flüge abschließen" ends the import knowingly; nothing is
 * dropped without the user having been told.
 */
export function CruiseImportFlightGap({
  items,
  created,
  tripId,
  onDone,
}: {
  items: readonly FlightGapItem[];
  /** Whether this import stored a cruise — it changes the opening sentence. */
  created: boolean;
  tripId?: string;
  /** With how many flights the retries added, and how many are still missing. */
  onDone: (result: { added: number; stillMissing: number }) => void;
}): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const [left, setLeft] = useState<FlightGapItem[]>([...items]);
  const [added, setAdded] = useState(0);
  const [busy, setBusy] = useState(false);
  const [retried, setRetried] = useState(false);

  const retry = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await storeFlights(
        left.map((item) => item.flight),
        { checkFirst: true, failedReason: "failed" }
      );
      if (tripId && result.ids.length > 0) {
        // Filed with the import's trip like the others; a failure here is
        // logged, the flights themselves are stored.
        try {
          await tripsApi.assignFlights(tripId, { flightIds: result.ids, action: "add" });
        } catch (err: unknown) {
          logger.error("CruiseImportFlightGap: assigning the added flights failed", err);
        }
      }
      const nowAdded = added + result.ids.length + result.present;
      setAdded(nowAdded);
      setRetried(true);
      if (result.gap.length === 0) onDone({ added: nowAdded, stillMissing: 0 });
      else setLeft(result.gap);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => onDone({ added, stillMissing: left.length })}
      busy={busy}
      maxWidth={560}
      closeLabel={t("common:buttons.close")}
      title={t("flightGap.title")}
      footer={
        <>
          <button
            type="button"
            onClick={() => onDone({ added, stillMissing: left.length })}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
          >
            {t("flightGap.skip")}
          </button>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            className="btn-primary px-4 py-2 text-sm"
          >
            {busy ? t("common:buttons.saving") : t("flightGap.retry", { count: left.length })}
          </button>
        </>
      }
    >
      <p className="mb-2 text-sm text-(--text-primary)">
        {t(created ? "flightGap.introSaved" : "flightGap.introKnown", { count: left.length })}
      </p>
      <ul className="mb-2 list-disc pl-5 text-sm text-(--text-primary)">
        {left.map((item, index) => (
          <li
            key={`${item.flight.flightNumber ?? ""}-${item.flight.departureLocal ?? ""}-${index}`}
          >
            {flightLabel(t, item)}
          </li>
        ))}
      </ul>
      <p className="text-xs text-(--text-muted)">{t("flightGap.hint")}</p>
      <FormErrorBanner message={retried ? t("flightGap.retryFailed") : null} />
    </Modal>
  );
}
