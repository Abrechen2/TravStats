import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Icon, type IconName } from "../ui/Icon";

export interface AdminIndexSection {
  id: string;
  label: string;
  badge?: number;
}

export interface AdminIndexTab {
  id: string;
  label: string;
}

/** A line icon per admin section, as the settings index has per entry. */
const SECTION_ICON: Record<string, IconName> = {
  system: "info",
  instance: "settings",
  users: "user",
  invitations: "mail",
  externalServices: "key-round",
  parsers: "sparkles",
  logging: "list",
  backups: "database",
  smtp: "mail",
  shipsMasterData: "ship",
  portsMasterData: "anchor",
  airlinesMasterData: "plane",
  aircraftMasterData: "plane",
  airportsMasterData: "map-pin",
};

interface Props {
  tabs: AdminIndexTab[];
  activeTab: string;
  onTab: (id: string) => void;
  sections: AdminIndexSection[];
  activeSection: string;
  onSection: (id: string) => void;
}

/**
 * The admin page's left column, round 4 ("Admin v2"): the area tabs, a mono
 * "Bereich" label and the sections as icon rows, open on the page.
 *
 * It replaces a 208px surface panel fixed to the viewport height, whose own
 * scroll box held the title and whose active row was an accent-coloured
 * label on a left border — the same column the settings page draws, so the
 * two instance-wide and personal surfaces now read as one family.
 */
export default function AdminIndex({
  tabs,
  activeTab,
  onTab,
  sections,
  activeSection,
  onSection,
}: Props): JSX.Element {
  const { t } = useTranslation(["admin"]);
  return (
    <aside
      className="flex flex-col"
      style={{
        position: "sticky",
        top: "calc(var(--ts-size-web-header) + var(--ts-space-xl))",
        alignSelf: "start",
        gap: "var(--ts-space-lg)",
      }}
    >
      {tabs.length > 1 && (
        <div
          role="tablist"
          className="flex overflow-x-auto scrollbar-none"
          style={{ borderBottom: "1px solid var(--ts-border)" }}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTab(tab.id)}
                className="whitespace-nowrap text-center"
                style={{
                  flex: "1 1 auto",
                  padding: "var(--ts-space-sm) 4px",
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                  boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      <nav
        aria-label={t("admin:sectionPicker", { defaultValue: "Bereich" })}
        className="flex flex-col"
        style={{ gap: 2 }}
      >
        <span
          className="t-label-mono"
          style={{ padding: "0 var(--ts-space-md)", marginBottom: "var(--ts-space-xs)" }}
        >
          {t("admin:sectionPicker", { defaultValue: "Bereich" })}
        </span>
        {sections.map((section) => {
          const active = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSection(section.id)}
              className="flex items-center text-left"
              style={{
                gap: "var(--ts-space-sm)",
                minHeight: 36,
                padding: "0 var(--ts-space-md)",
                borderRadius: "var(--ts-radius-button)",
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                background: active ? "var(--ts-tile)" : "transparent",
              }}
            >
              <Icon name={SECTION_ICON[section.id] ?? "settings"} size={16} />
              <span className="flex-1">{section.label}</span>
              {section.badge !== undefined && (
                <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                  {section.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
