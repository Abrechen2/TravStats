import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { emptyDraft, type TierPeriodDraft } from "./tierHistory";

interface Props {
  drafts: TierPeriodDraft[];
  onChange: (next: TierPeriodDraft[]) => void;
  /** Set by the caller when `draftsToPeriods` refused the drafts on save. */
  invalid?: boolean;
}

/**
 * The card's dated status history (loyalty-status-history-dated): which tier
 * was held from when until when. The lodging statistics read it to name, per
 * year, the tier held THEN rather than today's.
 */
export default function TierHistoryEditor({ drafts, onChange, invalid }: Props): JSX.Element {
  const { t } = useTranslation(["loyalty"]);

  const patch = (key: string, change: Partial<TierPeriodDraft>): void =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...change } : d)));

  return (
    <div className="space-y-2" data-testid="tier-history-editor">
      {drafts.length === 0 && <p className="t-caption">{t("loyalty:history.empty")}</p>}
      {drafts.map((draft) => (
        <div key={draft.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            aria-label={t("loyalty:history.tier")}
            placeholder={t("loyalty:history.tier")}
            value={draft.tier}
            onChange={(e) => patch(draft.key, { tier: e.target.value })}
            className="input"
          />
          <label className="flex items-center gap-1 text-xs">
            {t("loyalty:history.from")}
            <input
              type="date"
              aria-label={t("loyalty:history.from")}
              value={draft.validFrom}
              onChange={(e) => patch(draft.key, { validFrom: e.target.value })}
              className="input"
            />
          </label>
          <label className="flex items-center gap-1 text-xs" title={t("loyalty:history.untilOpen")}>
            {t("loyalty:history.until")}
            <input
              type="date"
              aria-label={t("loyalty:history.until")}
              value={draft.validUntil}
              onChange={(e) => patch(draft.key, { validUntil: e.target.value })}
              className="input"
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(drafts.filter((d) => d.key !== draft.key))}
            className="text-xs hover:underline"
            style={{ color: "var(--ts-bad)", fontWeight: 600 }}
          >
            {t("loyalty:history.remove")}
          </button>
        </div>
      ))}
      {drafts.length > 0 && <p className="t-caption">{t("loyalty:history.untilOpen")}</p>}
      {invalid && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t("loyalty:history.invalid")}
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange([...drafts, emptyDraft()])}
        className="text-xs hover:underline"
        style={{ color: "var(--ts-accent)", fontWeight: 600 }}
      >
        {t("loyalty:history.add")}
      </button>
    </div>
  );
}
