import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { updateLoyaltyMembership } from "../../lib/api/loyalty";
import { logger } from "../../lib/logger";
import type { TierPeriod } from "../../types/loyalty";
import TierHistoryEditor from "./TierHistoryEditor";
import { draftsToPeriods, toDrafts, type TierPeriodDraft } from "./tierHistory";

interface Props {
  membershipId: string;
  periods: TierPeriod[];
  onSaved: () => void;
}

/**
 * The status history of a HOTEL card, edited in place under its row.
 *
 * The hotel card's own editor (`MembershipManager`) also serves the chain
 * page, where a history editor has no business, so the loyalty page adds this
 * beside it rather than into it. It writes only `tierPeriods`, which the
 * server treats as "replace the history, leave everything else alone".
 */
export default function TierHistoryToggle({ membershipId, periods, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["loyalty", "common"]);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<TierPeriodDraft[]>([]);
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const toggle = (): void => {
    if (!open) setDrafts(toDrafts(periods));
    setInvalid(false);
    setError(false);
    setOpen((was) => !was);
  };

  const save = async (): Promise<void> => {
    const tierPeriods = draftsToPeriods(drafts);
    setInvalid(tierPeriods === null);
    if (tierPeriods === null) return;
    setSaving(true);
    setError(false);
    try {
      await updateLoyaltyMembership(membershipId, { tierPeriods });
      setOpen(false);
      onSaved();
    } catch (err: unknown) {
      logger.error("TierHistoryToggle: save failed", err);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        data-testid={`tier-history-toggle-${membershipId}`}
        aria-expanded={open}
        onClick={toggle}
        className="text-xs hover:underline"
        style={{ color: "var(--ts-accent)", fontWeight: 600 }}
      >
        {t("loyalty:history.toggle", { count: periods.length })}
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-4">
          <TierHistoryEditor drafts={drafts} onChange={setDrafts} invalid={invalid} />
          {error && (
            <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
              {t("loyalty:history.saveError")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={toggle} disabled={saving} className="btn-secondary">
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="btn-primary"
            >
              {t("loyalty:history.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
