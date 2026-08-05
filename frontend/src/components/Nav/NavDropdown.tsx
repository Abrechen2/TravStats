import { useRef, useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { isNodeActive, isPathActive, type NavGroup } from "./useNavItems";

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
 * One dropdown for every nav submenu (Logbuch, Support, System). Click
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
      : "relative px-3 py-1.5 text-sm transition-colors duration-200 rounded-md flex items-center gap-1";

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
                fontWeight: active ? 600 : 500,
                color: active ? "var(--accent)" : "var(--text-muted)",
                background: active || open ? "var(--bg-elevated)" : "transparent",
              }
        }
      >
        {label}
        <span aria-hidden="true" className="text-[9px] opacity-70">
          ▼
        </span>
        {typeof badge === "number" && badge > 0 && (
          <span
            className="absolute -top-1 -right-1 text-xs font-bold rounded-full h-4 min-w-4 px-0.5 flex items-center justify-center"
            style={{ background: "var(--danger)", color: "#fff" }}
          >
            {badgeText(badge)}
          </span>
        )}
        {variant === "nav" && active && (
          <span
            className="absolute -bottom-px left-2 right-2 h-[3px] rounded-full"
            style={{ background: "var(--accent)" }}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full mt-1.5 min-w-[176px] z-70 rounded-lg p-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
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
                        ? "var(--accent)"
                        : child.warn
                          ? "var(--warning)"
                          : "var(--text-muted)",
                      fontWeight: childActive ? 600 : 500,
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      {child.label}
                      {child.betaBadge && (
                        <span className="inline-flex items-center rounded-sm px-1 py-0.5 text-[10px] font-medium leading-none text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-600/20 dark:text-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/20">
                          Beta
                        </span>
                      )}
                    </span>
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
