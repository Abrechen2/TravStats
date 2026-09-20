import { useRef, useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { isNodeActive, isPathActive, type NavGroup } from "./useNavItems";
import { Icon } from "../ui/Icon";

export interface ExternalLink {
  id: string;
  label: string;
  href: string;
  icon?: JSX.Element;
}

interface NavDropdownProps {
  group: NavGroup;
  externalLinks?: never;
  label?: never;
  align?: "left" | "right";
  variant?: "nav" | "chip";
}

interface ExternalDropdownProps {
  group?: never;
  label: string;
  externalLinks: ExternalLink[];
  align?: "left" | "right";
  variant?: "nav" | "chip";
}

function badgeText(badge: number): string {
  return badge > 9 ? "9+" : String(badge);
}

/**
 * The Logbuch dropdown (and any other plain submenu). Click
 * toggles, Escape / outside click / navigating a child closes. Hover-only
 * menus are deliberately avoided (touch + a11y).
 */
export default function NavDropdown(props: NavDropdownProps | ExternalDropdownProps): JSX.Element {
  const { align = "left", variant = "nav" } = props;
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

  const label = props.group ? props.group.label : props.label;
  const badge = props.group?.badge;
  const active = props.group ? isNodeActive(props.group, location.pathname) : false;

  const triggerClass =
    variant === "chip"
      ? "flex items-center gap-1 px-2.5 py-1 rounded-sm text-[11px] font-medium transition-colors duration-150"
      : "relative px-3 text-sm flex items-center gap-1";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
        style={
          variant === "chip"
            ? { color: "var(--text-muted)", border: "1px solid var(--color-border)" }
            : {
                // Same marker as a primary link: bright, bold, an accent bar on
                // the header's bottom edge.
                height: "var(--ts-size-web-header)",
                fontWeight: active ? 700 : 500,
                color: active || open ? "var(--ts-text-bright)" : "var(--ts-muted)",
                boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
              }
        }
      >
        {label}
        <Icon name="chevron-down" size={14} />
        {typeof badge === "number" && badge > 0 && (
          <span
            className="absolute -top-1 -right-1 text-xs font-bold rounded-full h-4 min-w-4 px-0.5 flex items-center justify-center"
            style={{ background: "var(--danger)", color: "#fff" }}
          >
            {badgeText(badge)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full min-w-[176px] z-70 rounded-lg p-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
        >
          {props.group
            ? props.group.children.map((child) => {
                const childActive = isPathActive(child.path, location.pathname);
                return (
                  <Link
                    key={child.id}
                    role="menuitem"
                    to={child.path}
                    onClick={close}
                    aria-current={childActive ? "page" : undefined}
                    className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-md text-sm"
                    style={{
                      color: childActive
                        ? "var(--ts-text-bright)"
                        : child.warn
                          ? "var(--ts-warn)"
                          : "var(--ts-text)",
                      fontWeight: childActive ? 700 : 500,
                      background: childActive ? "var(--ts-tile)" : "transparent",
                    }}
                  >
                    <span className="flex items-center gap-1.5">{child.label}</span>
                    {(child.badge ?? 0) > 0 && (
                      <span
                        className="text-xs font-bold rounded-full h-4 min-w-4 px-0.5 flex items-center justify-center"
                        style={{ background: "var(--danger)", color: "#fff" }}
                      >
                        {badgeText(child.badge ?? 0)}
                      </span>
                    )}
                  </Link>
                );
              })
            : props.externalLinks.map((linkItem) => (
                <a
                  key={linkItem.id}
                  role="menuitem"
                  href={linkItem.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  {linkItem.icon}
                  {linkItem.label}
                </a>
              ))}
        </div>
      )}
    </div>
  );
}
