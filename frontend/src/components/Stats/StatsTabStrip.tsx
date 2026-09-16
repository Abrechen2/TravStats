import { useRef } from "react";
import type { JSX, ReactNode } from "react";
import { useRevealActive } from "../../lib/ui/revealInRow";
import { useTranslation } from "../../hooks/useTranslation";
import { DOMAINS, type DomainKey } from "../../shared/domains";

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

  return (
    <div
      className="pt-3"
      style={{ background: "var(--ts-bg)", borderBottom: "1px solid var(--ts-border)" }}
    >
      <div
        ref={rowRef}
        className="mx-auto flex max-w-6xl gap-1 overflow-x-auto overflow-y-hidden scrollbar-none"
      >
        <TabButton active={active === "all"} onClick={(): void => onSelect("all")}>
          {t("stats:filter.all")}
        </TabButton>
        {tabs.map((k) => (
          <TabButton key={k} active={active === k} onClick={(): void => onSelect(k)}>
            <span className="mr-1.5" aria-hidden>
              {DOMAINS[k].icon}
            </span>
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
      className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-(--accent) text-(--accent)"
          : "border-transparent text-(--text-secondary) hover:text-(--text-primary)"
      }`}
    >
      {children}
    </button>
  );
}
