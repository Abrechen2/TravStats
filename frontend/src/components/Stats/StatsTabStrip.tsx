import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { DOMAINS, type DomainKey } from "../../shared/domains";

interface Props {
  /** Domain tabs the reader may open — `visibleStatsTabs`, already gated. */
  tabs: DomainKey[];
  active: DomainKey | "all";
  onSelect: (tab: DomainKey | "all") => void;
}

/** The statistics page's top tabs: "Gesamt" first, then one per domain. */
export default function StatsTabStrip({ tabs, active, onSelect }: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  return (
    <div
      className="px-4 pt-3"
      style={{ background: "var(--bg-base)", borderBottom: "1px solid var(--color-border)" }}
    >
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto overflow-y-hidden">
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
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-(--accent) text-(--accent)"
          : "border-transparent text-(--text-secondary) hover:text-(--text-primary)"
      }`}
    >
      {children}
    </button>
  );
}
