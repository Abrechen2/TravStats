import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { JSX, ReactNode } from "react";
import { useRevealActive } from "../../lib/ui/revealInRow";
import { useTranslation } from "../../hooks/useTranslation";
import { isStatsTabArrival } from "../../lib/stats/statsTabArrival";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { Icon } from "../ui/Icon";
import { DOMAIN_ICON } from "../ui/domainIcons";

interface Props {
  /** Domain tabs the reader may open — `visibleStatsTabs`, already gated. */
  tabs: DomainKey[];
  active: DomainKey | "all";
  onSelect: (tab: DomainKey | "all") => void;
}

/**
 * The statistics page's top tabs: "Gesamt" first, then one per domain.
 *
 * On a phone the strip scrolls sideways, and the active tab is brought into
 * view whenever it changes — a direct `/stats?tab=poi` used to open with the
 * Orte tab off the right edge while its content filled the page (CT106 audit
 * B06). Tabs keep their width and never wrap icon and label onto two lines.
 */
export default function StatsTabStrip({ tabs, active, onSelect }: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useRevealActive(rowRef, '[aria-current="page"]', [active, tabs.join(",")]);

  // Opened from a "Details" link further down: start at the top, on the tab.
  const location = useLocation();
  const arrived = isStatsTabArrival(location.state);
  useEffect(() => {
    if (!arrived) return;
    window.scrollTo({ top: 0 });
    rowRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, [arrived, location.key]);

  return (
    <div style={{ background: "var(--ts-bg)", borderBottom: "1px solid var(--ts-border)" }}>
      <div
        ref={rowRef}
        className="mx-auto flex max-w-6xl gap-1 overflow-x-auto overflow-y-hidden scrollbar-none"
      >
        <TabButton active={active === "all"} onClick={(): void => onSelect("all")}>
          {t("stats:filter.all")}
        </TabButton>
        {tabs.map((k) => (
          <TabButton key={k} active={active === k} onClick={(): void => onSelect(k)}>
            <Icon name={DOMAIN_ICON[k]} size={16} />
            {t(`common:${DOMAINS[k].i18nKey}`)}
          </TabButton>
        ))}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm"
      style={{
        fontWeight: active ? 700 : 500,
        color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
        boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
      }}
    >
      {children}
    </button>
  );
}
