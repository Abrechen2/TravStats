import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useClickOutside } from "../../hooks/useClickOutside";
import { displayName, initials, type DisplayableUser } from "../../lib/userDisplay";
import { Icon } from "../ui/Icon";

interface UserMenuProps {
  user: DisplayableUser | null | undefined;
  profilePicture?: string;
  onLogout: () => void;
  /** Opens the diagnostic export. Absent: the entry is not drawn. */
  onReportBug?: () => void;
  /** Draws the admin link (T4, 2026-09-17 tester feedback). Absent or false:
   *  no entry — the same default a normal account gets. */
  isAdmin?: boolean;
}

/** Where support goes. The same three the old header's Support chip held. */
const SUPPORT_LINKS = [
  {
    id: "donate",
    labelKey: "common:support.donate",
    href: "https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42",
  },
  { id: "star", labelKey: "common:support.star", href: "https://github.com/Abrechen2/TravStats" },
  { id: "discord", labelKey: "", href: "https://discord.gg/CRnjB9f78t" },
] as const;

/**
 * Avatar + name in the header, opening the account menu (#241): settings, bug
 * report, support links and log out. Round 4 (E1) put everything personal
 * behind the avatar, so the Bug button and the Support and System chips left
 * the header row.
 *
 * This also moves the logout button out of the top bar. It used to sit there as
 * a bare button next to the account name, which made a stray click in that
 * corner end the session — something that happened repeatedly during testing.
 * Behind one deliberate click it cannot be hit by accident, and the top bar
 * gets its width back.
 */
export default function UserMenu({
  user,
  profilePicture,
  onLogout,
  onReportBug,
  isAdmin = false,
}: UserMenuProps): JSX.Element {
  const { t } = useTranslation(["dashboard", "settings", "common"]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside clicks go through the project's own hook rather than a second
  // hand-rolled document listener; Escape is added here because the hook does
  // not cover the keyboard. The key listener only exists while the menu is open.
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, close);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const name = displayName(user);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("dashboard:userMenu.label", { defaultValue: "Account menu" })}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm transition-colors"
        style={{ border: "1px solid var(--color-border)", color: "var(--text-primary)" }}
      >
        {profilePicture ? (
          <img
            src={profilePicture}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            style={{ border: "1px solid var(--color-border)" }}
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
            style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
          >
            {initials(user)}
          </span>
        )}
        <span className="hidden xl:inline max-w-[10rem] truncate">{name}</span>
        <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg shadow-xl"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
        >
          <div
            className="px-3 py-2 text-xs"
            style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--color-border)" }}
          >
            {name}
          </div>
          <Link
            to="/settings/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--ts-tile)"
            style={{ color: "var(--ts-text)" }}
          >
            <Icon name="settings" size={16} />
            {t("dashboard:settings")}
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--ts-tile)"
              style={{ color: "var(--ts-text)" }}
            >
              <Icon name="shield" size={16} />
              {t("dashboard:admin")}
            </Link>
          )}
          {onReportBug && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onReportBug();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--ts-tile)"
              style={{ color: "var(--ts-text)" }}
            >
              <Icon name="triangle-alert" size={16} />
              {t("common:diagnostic.reportBug")}
            </button>
          )}
          <div
            role="group"
            aria-label={t("dashboard:nav.support")}
            className="flex flex-col"
            style={{ borderTop: "1px solid var(--ts-border)", paddingTop: 4, marginTop: 4 }}
          >
            <span className="t-label-mono" style={{ padding: "6px 12px 2px" }}>
              {t("dashboard:nav.support")}
            </span>
            {SUPPORT_LINKS.map((link) => (
              <a
                key={link.id}
                role="menuitem"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--ts-tile)"
                style={{ color: "var(--ts-muted)" }}
              >
                {link.labelKey ? t(link.labelKey) : "Discord"}
              </a>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--ts-border)", marginTop: 4 }} />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--ts-tile)"
            style={{ color: "var(--ts-text)" }}
          >
            <Icon name="log-out" size={16} />
            {t("dashboard:logout")}
          </button>
        </div>
      )}
    </div>
  );
}
