import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import type { EvidenceScope, UnattributedReason } from "../../shared/evidence";
import { useEvidence, type EvidenceScopeParams } from "./useEvidence";
import EvidenceEntryRow from "./EvidenceEntryRow";
import { composeI18nText, formatMeasureValue } from "./evidenceText";

/** Docked right at `sm` and above, sheet below — `Modal`'s own breakpoint (design, "The panel"). */
const PANEL_MAX_WIDTH = 640;

const UNATTRIBUTED_KEYS: Record<UnattributedReason, string> = {
  locationHistoryOnly: "evidence:panel.bucket.unattributedLocationHistoryOnly",
  entryRemoved: "evidence:panel.bucket.unattributedEntryRemoved",
  notPerEntry: "evidence:panel.bucket.unattributedNotPerEntry",
};

function scopeText(
  scope: EvidenceScope,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const period =
    scope.period.kind === "year"
      ? t("evidence:panel.scope.year", { year: scope.period.year })
      : scope.period.kind === "rolling12m"
        ? t("evidence:panel.scope.rolling12m")
        : t("evidence:panel.scope.allTime");
  const domains = scope.domains ?? [];
  if (domains.length === 0) return period;
  const domainNames = domains.map((d) => t(`evidence:panel.scope.domain.${d}`)).join(", ");
  return `${period} · ${domainNames}`;
}

/**
 * "Which entries produced this number?" — a docked panel built on `Modal`,
 * the frame with the scrolling body a list needs (`components/ui/Dialog` is
 * for a short question and is the wrong base, per the task brief).
 *
 * Self-contained: it reads its own open state from the URL
 * (`?evidence=<kind>:<key>`) via `useEvidence`, so no page has to mount it
 * conditionally or pass it a value — Task 9 opens it by calling `open()` from
 * a tile, not by rendering this component differently.
 */
export default function EvidencePanel({
  scope,
}: {
  scope?: EvidenceScopeParams;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["evidence", "common"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  const { isOpen, close, response, entries, loading, error, hasMore, loadMore } =
    useEvidence(scope);

  if (!isOpen) return null;

  const measure = response?.measure ?? null;
  const title = measure ? composeI18nText(measure.label, t) : t("evidence:panel.loading");
  const valueText = measure ? formatMeasureValue(measure, t, i18n.language, baseCurrency) : null;
  const showAbstention = measure !== null && measure.value === null;
  const showEmpty =
    !loading && !error && measure !== null && measure.value !== null && entries.length === 0;

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title={title}
      maxWidth={PANEL_MAX_WIDTH}
      closeLabel={t("evidence:panel.close")}
      testId="evidence-panel"
      footer={
        response && (
          <div
            className="flex w-full flex-col gap-1 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <span>{t("evidence:panel.bucket.returned", { count: response.returned })}</span>
            {response.omitted.count > 0 && (
              <span>{t("evidence:panel.bucket.omitted", { count: response.omitted.count })}</span>
            )}
            {response.unattributed.map((u, index) => (
              <span key={`${u.reason}-${index}`}>
                {t(UNATTRIBUTED_KEYS[u.reason], { count: u.count })}
              </span>
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="mt-1 self-start rounded-sm px-2 py-1 text-xs font-medium disabled:opacity-50"
                style={{ color: "var(--accent)" }}
              >
                {t("evidence:panel.loadMore")}
              </button>
            )}
          </div>
        )
      }
    >
      <div className="mb-3">
        {measure && (
          <>
            <p className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {showAbstention ? t("evidence:panel.abstention") : valueText}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {scopeText(measure.scope, t)}
            </p>
          </>
        )}
      </div>

      {loading && entries.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>{t("common:loading.default")}</p>
      )}
      {!loading && error && (
        <p style={{ color: "var(--text-muted)" }}>{t("evidence:panel.loadError")}</p>
      )}
      {showEmpty && <p style={{ color: "var(--text-muted)" }}>{t("evidence:panel.empty")}</p>}

      {entries.length > 0 && measure && (
        <ul>
          {entries.map((entry) => (
            <EvidenceEntryRow key={entry.id} entry={entry} aggregation={measure.aggregation} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
