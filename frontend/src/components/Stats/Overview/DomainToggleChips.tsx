// Chip row letting the user toggle which domains contribute to the
// cross-domain charts and KPIs. Disabled chips signal "domain available
// but no data yet" or "domain not yet rolled out".
import type { JSX } from "react";
import { DOMAINS, type DomainKey } from "../../../shared/domains";
import type { DomainStatsMap } from "../../../lib/stats/domain-stats";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";

interface Props {
  /** Domains to offer chips for — the caller passes the user's enabledDomains. */
  domains: readonly DomainKey[];
  visible: Partial<Record<DomainKey, boolean>>;
  setVisible: (next: Partial<Record<DomainKey, boolean>>) => void;
  statsMap: DomainStatsMap;
}

export default function DomainToggleChips({
  domains,
  visible,
  setVisible,
  statsMap,
}: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const { colorOf } = useDomainColors();
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {domains.map((key) => {
        const d = DOMAINS[key];
        const stats = statsMap[key];
        const hasData = stats?.hasData === true;
        const active = visible[key] === true && hasData;
        const disabled = !hasData;
        return (
          <button
            key={key}
            type="button"
            onClick={(): void => {
              if (disabled) return;
              setVisible({ ...visible, [key]: !visible[key] });
            }}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: active
                ? "color-mix(in srgb, var(--domain-color) 14%, transparent)"
                : "var(--bg-surface)",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              borderColor: active ? colorOf(d.key) : "var(--color-border)",
              ["--domain-color" as string]: colorOf(d.key),
            }}
          >
            <span
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, background: d.color }}
            />
            <span aria-hidden>{d.icon}</span>
            <span>{t(`common:${d.i18nKey}`)}</span>
            {!hasData && (
              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                · {t("stats:overviewToggle.noData")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
