import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useRailVisible } from "../../hooks/useRailVisible";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";

/**
 * The "Alle" tab's domain filter, on the map itself (tester 2026-09-26). It
 * used to exist only inside the collapsed map panel, where nobody found it.
 * One chip per domain the viewer has — rail only where its beta switch and
 * the viewer's own toggle allow it — each in its domain colour from the
 * store. The choice is remembered per viewer by the filter store.
 *
 * The per-domain tabs stay (owner decision 2026-09-05, design §9); this
 * filters the cross-domain map, it does not replace them.
 */
export default function DomainFilterChips(): JSX.Element | null {
  const { t } = useTranslation(["dashboard", "common"]);
  const { isEnabled } = useEnabledDomains();
  const railVisible = useRailVisible();
  const { colorOf } = useDomainColors();
  const domains = useDashboardFilterStore((s) => s.domains);
  const setDomains = useDashboardFilterStore((s) => s.setDomains);

  const options = AVAILABLE_DOMAINS.filter(
    (key) => (key !== "rail" || railVisible) && isEnabled(key)
  );
  if (options.length < 2) return null;

  const toggle = (key: DomainKey): void => {
    setDomains(domains.includes(key) ? domains.filter((d) => d !== key) : [...domains, key]);
  };

  return (
    <div
      role="group"
      aria-label={t("dashboard:filter.domains")}
      data-testid="dashboard-domain-filter"
      // On a phone the collapsed legend and the map panel share the bottom
      // edge, so the chips sit one row higher there.
      className="absolute bottom-[124px] flex gap-1.5 overflow-x-auto sm:bottom-[72px]"
      style={{
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        maxWidth: "calc(100% - 24px)",
        padding: 6,
        borderRadius: 999,
        background: "rgba(22,27,34,0.85)",
        border: "1px solid var(--color-border)",
        scrollbarWidth: "none",
      }}
    >
      {options.map((key) => {
        const active = domains.includes(key);
        const colour = colorOf(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(key)}
            className="shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors"
            style={{
              background: active ? colour : "transparent",
              color: active ? "#0d1117" : "var(--text-muted)",
              border: `1px solid ${active ? colour : "var(--color-border)"}`,
              fontWeight: active ? 600 : 400,
            }}
          >
            {t(`common:${DOMAINS[key].i18nKey}`)}
          </button>
        );
      })}
    </div>
  );
}
