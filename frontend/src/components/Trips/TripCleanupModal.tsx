import Modal from "../Modal";
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { tripsApi, type MicroTripCandidate } from "../../lib/api/trips";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface TripCleanupModalProps {
  onClose(): void;
  onChanged(): void;
}

/**
 * "Aufräumen" modal — lists micro-trip candidates (legacy one-booking
 * auto-trips: ≤2 flights, no other content) and dissolves the selected
 * ones. Dissolving deletes only the trip container; flights survive via
 * FK onDelete: SetNull on the backend.
 */
export default function TripCleanupModal({
  onClose,
  onChanged,
}: TripCleanupModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [candidates, setCandidates] = useState<MicroTripCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getMicroTripCandidates()
      .then((list) => {
        if (cancelled) return;
        setCandidates(list);
        setSelected(new Set(list.map((c) => c.id)));
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "TripCleanupModal: failed to load candidates");
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDissolve = async (): Promise<void> => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await tripsApi.dissolveMicroTrips([...selected]);
      addToast("success", t("trips:cleanup.done", { count: result.dissolved }));
      onChanged();
      onClose();
    } catch (err) {
      logger.error("TripCleanupModal: dissolve failed", err);
      addToast("error", t("trips:cleanup.error"));
      setBusy(false);
    }
  };

  const formatRange = (c: MicroTripCandidate): string => {
    if (!c.startDate) return "—";
    const from = new Date(c.startDate).toLocaleDateString();
    if (!c.endDate) return from;
    return `${from} – ${new Date(c.endDate).toLocaleDateString()}`;
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={t("trips:cleanup.title")}
      maxWidth={512}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:modal.cancel")}
          </button>
          <button
            onClick={() => void handleDissolve()}
            disabled={busy || selected.size === 0}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--danger)" }}
          >
            {t("trips:cleanup.confirm", { count: selected.size })}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("trips:cleanup.intro")}
      </p>
      {candidates === null ? (
        <div className="px-5 py-8 text-sm text-center" style={{ color: "var(--text-muted)" }}>
          …
        </div>
      ) : candidates.length === 0 ? (
        <div className="px-5 py-8 text-sm text-center" style={{ color: "var(--text-muted)" }}>
          {t("trips:cleanup.empty")}
        </div>
      ) : (
        <>
          <div className="px-5 pb-2 flex gap-3 text-xs">
            <button
              onClick={() => setSelected(new Set(candidates.map((c) => c.id)))}
              style={{ color: "var(--accent)" }}
            >
              {t("trips:cleanup.selectAll")}
            </button>
            <button onClick={() => setSelected(new Set())} style={{ color: "var(--text-muted)" }}>
              {t("trips:cleanup.selectNone")}
            </button>
          </div>
          <div
            className="overflow-y-auto px-5 py-2 space-y-1"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            {candidates.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-(--bg-muted)"
              >
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span
                  aria-hidden
                  className="inline-block rounded-full shrink-0"
                  style={{ width: 8, height: 8, background: c.color }}
                />
                <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                  {c.name}
                </span>
                <span
                  className="ml-auto text-xs whitespace-nowrap"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("trips:cleanup.flightCount", { count: c.flightCount })} · {formatRange(c)}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
