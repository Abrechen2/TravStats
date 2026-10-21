import type { JSX, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../../ui/Icon";
import { Select } from "../../ui/Field";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { ExpertNote } from "./ExpertNote";

export interface SettingsMenuEntry {
  id: string;
  label: string;
  to: string;
  icon: IconName;
  /** A count beside the entry, e.g. the number of accounts. */
  badge?: number;
}

export interface SettingsMenuGroup {
  id: string;
  /** null draws the group without a heading. */
  label: string | null;
  entries: SettingsMenuEntry[];
}

interface Props {
  /** The navigation landmark's name: "Einstellungen", "Administration". */
  label: string;
  groups: SettingsMenuGroup[];
  activeId: string;
  /** Pages the standard level keeps out of the menu. */
  hiddenPages: number;
  search: ReactNode;
  /** Under the menu: the version line. */
  footer?: ReactNode;
}

/**
 * The left menu of the settings and admin surfaces (forgejo#321): one entry
 * per page, grouped, and sticky — it stays in view however long the page is
 * (tester, 2026-10-20). Only the entry list scrolls inside it, should a short
 * window not fit the whole menu.
 */
export function SettingsMenuColumn({
  label,
  groups,
  activeId,
  hiddenPages,
  search,
  footer,
}: Props): JSX.Element {
  const coarse = useCoarsePointer();
  return (
    <aside
      data-settings-menu="sticky"
      className="flex flex-col"
      style={{
        position: "sticky",
        top: "calc(var(--ts-size-web-header) + var(--ts-space-xl))",
        alignSelf: "start",
        maxHeight: "calc(100vh - var(--ts-size-web-header) - 2 * var(--ts-space-xl))",
        gap: "var(--ts-space-lg)",
      }}
    >
      {search}
      <nav aria-label={label} className="flex flex-col overflow-y-auto" style={{ gap: 2 }}>
        {groups.map((group, index) => (
          <div
            key={group.id}
            className="flex flex-col"
            style={{
              gap: 2,
              paddingTop: index > 0 ? "var(--ts-space-md)" : undefined,
              borderTop: index > 0 && !group.label ? "1px solid var(--ts-border)" : undefined,
              marginTop: index > 0 && !group.label ? "var(--ts-space-sm)" : undefined,
            }}
          >
            {group.label && (
              <span
                className="t-label-mono"
                style={{ padding: "0 var(--ts-space-md)", marginBottom: "var(--ts-space-xs)" }}
              >
                {group.label}
              </span>
            )}
            {group.entries.map((entry) => {
              const active = entry.id === activeId;
              return (
                <Link
                  key={entry.id}
                  to={entry.to}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center"
                  style={{
                    gap: "var(--ts-space-sm)",
                    minHeight: coarse ? "var(--ts-size-touch-min)" : 36,
                    padding: "0 var(--ts-space-md)",
                    borderRadius: "var(--ts-radius-button)",
                    fontSize: 14,
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                    background: active ? "var(--ts-tile)" : "transparent",
                  }}
                >
                  <Icon name={entry.icon} size={16} />
                  <span className="flex-1">{entry.label}</span>
                  {entry.badge !== undefined && (
                    <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                      {entry.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <ExpertNote count={hiddenPages} kind="pages" />
      {footer}
    </aside>
  );
}

/**
 * Below `md` a 240px column would be the whole screen: the same menu becomes a
 * page picker under the search.
 */
export function SettingsMenuCompact({
  label,
  groups,
  activeId,
  hiddenPages,
  search,
}: Props): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const navigate = useNavigate();
  const entries = groups.flatMap((g) => g.entries);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {search}
      <Select
        aria-label={t("settings:pagePicker")}
        value={activeId}
        onChange={(event) => {
          const target = entries.find((e) => e.id === event.target.value);
          if (target) navigate(target.to);
        }}
      >
        {groups.map((group) => (
          <optgroup key={group.id} label={group.label ?? label}>
            {group.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <ExpertNote count={hiddenPages} kind="pages" />
    </div>
  );
}
