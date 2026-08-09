import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useClickOutside } from "../../hooks/useClickOutside";
import { displayName, initials, type DisplayableUser } from "../../lib/userDisplay";

interface UserMenuProps {
  user: DisplayableUser | null | undefined;
  profilePicture?: string;
  onLogout: () => void;
}

/**
 * Avatar + name in the header, opening a menu with "edit profile" and "log out"
 * (#241).
 *
 * This also moves the logout button out of the top bar. It used to sit there as
 * a bare button next to the account name, which made a stray click in that
 * corner end the session — something that happened repeatedly during testing.
 * Behind one deliberate click it cannot be hit by accident, and the top bar
 * gets its width back.
 */
export default function UserMenu({ user, profilePicture, onLogout }: UserMenuProps): JSX.Element {
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
            to="/settings?tab=general&section=profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm transition-colors hover:bg-(--bg-muted)"
            style={{ color: "var(--text-primary)" }}
          >
            {t("settings:profile.editProfile", { defaultValue: "Profil bearbeiten" })}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-(--bg-muted)"
            style={{ color: "var(--text-primary)" }}
          >
            {t("dashboard:logout")}
          </button>
        </div>
      )}
    </div>
  );
}
