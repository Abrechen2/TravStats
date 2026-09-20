import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useTranslation } from "../../hooks/useTranslation";
import { Icon } from "../ui/Icon";
import { isPathActive, type NavNode, type NavSection } from "./useNavItems";

interface MoreMenuProps {
  sections: NavSection[];
  /**
   * Destinations folded into the menu as a first section, "Ziele". The phone
   * header has no room for the four primary entries (round 4, §6: below 640px
   * they move into "Mehr").
   */
  primary?: NavNode[];
  align?: "left" | "right";
}

function badgeText(badge: number): string {
  return badge > 9 ? "9+" : String(badge);
}

/**
 * "Mehr": everything that is not one of the four primary destinations, in
 * labelled sections with an icon per entry. Click toggles; Escape, an outside
 * click or choosing an entry closes. Hover menus are avoided (touch, a11y).
 */
export default function MoreMenu({
  sections,
  primary,
  align = "left",
}: MoreMenuProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(rootRef, close);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Primary entries flatten into leaves: a Logbuch group contributes its
  // domains, which is what the phone has room to show.
  const destinations = (primary ?? []).flatMap((node) =>
    node.kind === "group" ? node.children : [node]
  );
  const allSections: NavSection[] = [
    ...(destinations.length > 0
      ? [{ id: "destinations", label: t("dashboard:nav.destinations"), items: destinations }]
      : []),
    ...sections.filter((section) => section.items.length > 0),
  ];
  const active = allSections.some((section) =>
    section.items.some((item) => isPathActive(item.path, location.pathname))
  );
  const badge = sections.reduce(
    (sum, section) => sum + section.items.reduce((n, item) => n + (item.badge ?? 0), 0),
    0
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center gap-1 rounded-md px-3 py-1.5 text-sm"
        style={{
          fontWeight: active ? 700 : 500,
          color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
          background: open ? "var(--ts-tile)" : "transparent",
        }}
      >
        {t("dashboard:nav.more")}
        <Icon name="chevron-down" size={14} />
        {badge > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2 w-2 rounded-full"
            style={{ background: "var(--ts-warn)" }}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full z-70 mt-1.5 flex min-w-[240px] flex-col rounded-lg p-2 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
            gap: "var(--ts-space-sm)",
          }}
        >
          {allSections.map((section) => (
            <div key={section.id} role="group" aria-label={section.label} className="flex flex-col">
              <span className="t-label-mono" style={{ padding: "6px 10px 4px" }}>
                {section.label}
              </span>
              {section.items.map((item) => {
                const itemActive = isPathActive(item.path, location.pathname);
                return (
                  <Link
                    key={item.id}
                    role="menuitem"
                    to={item.path}
                    onClick={close}
                    aria-current={itemActive ? "page" : undefined}
                    className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm"
                    style={{
                      color: itemActive ? "var(--ts-text-bright)" : "var(--ts-text)",
                      fontWeight: itemActive ? 700 : 500,
                      background: itemActive ? "var(--ts-tile)" : "transparent",
                    }}
                  >
                    <span className="flex items-center gap-2">
                      {item.icon && <Icon name={item.icon} size={16} />}
                      {item.label}
                    </span>
                    {(item.badge ?? 0) > 0 && (
                      <span
                        className="t-label-mono"
                        style={{ color: item.warn ? "var(--ts-warn)" : "var(--ts-muted)" }}
                      >
                        {badgeText(item.badge ?? 0)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
