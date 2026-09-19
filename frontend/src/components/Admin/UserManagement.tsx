import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatIsoDate } from "../../lib/dateUtils";
import { statusPillStyle } from "../table/statusPillStyle";
import { Icon } from "../ui/Icon";
import { AnimatePresence } from "framer-motion";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import type { AdminUser } from "./SystemInfo";
import AdminPasswordResetModal from "./AdminPasswordResetModal";
import ConfirmModal from "../Training/ConfirmModal";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";

interface UserManagementProps {
  users: AdminUser[];
  onToggleUserActive: (userId: string) => void;
  onDeleteUser: (userId: string) => void;
  onResetTwoFactor: (userId: string) => void;
  /**
   * `?user=` off the admin page — the account a link INTO this table meant
   * (forgejo#88, point 2: the inbox row for a password-reset request).
   *
   * Passed in rather than read from the URL here: this component is rendered
   * outside a Router in its own tests, and a `useSearchParams` call would make
   * a table of users depend on routing to render at all.
   */
  highlightUserId?: string | null;
}

export default function UserManagement({
  users,
  onToggleUserActive,
  onDeleteUser,
  onResetTwoFactor,
  highlightUserId = null,
}: UserManagementProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [resetModalUser, setResetModalUser] = useState<{ id: string; username: string } | null>(
    null
  );
  const [deleteUserConfirm, setDeleteUserConfirm] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const [resetTwoFactorConfirm, setResetTwoFactorConfirm] = useState<{
    id: string;
    username: string;
  } | null>(null);

  /**
   * The table has no search box, so "open the admin at that user" would
   * otherwise mean "open a list and find them yourself". The row is scrolled
   * into view and outlined; nothing is pre-selected, because the actions here
   * are destructive enough that arriving with one armed would be wrong.
   */
  const highlightRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!highlightUserId) return;
    // The row may not be mounted yet when a deep link opens the page; the
    // effect re-runs when `users` arrives, which is when the ref is there.
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightUserId, users]);

  return (
    <div className="space-y-4">
      {/* Was the collapsed help box. The sentence that matters is the one about
          deactivation keeping the data — an admin should not have to open
          anything to learn that. */}
      <p className="t-caption">{t("admin:users.description")}</p>
      {/* Round 4 ("Admin v2"): initials, role and 2FA as pills, figures in
          mono, and the row's actions behind "…" — four text links in a row
          pushed the table past its card at every width. */}
      {/* Scrolls sideways only on a phone: a scroll box would clip the row
          menu of the last rows, and from md up the table fits. */}
      <div
        className="overflow-x-auto md:overflow-visible"
        style={{
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
        }}
      >
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr
              className="t-label-mono text-left"
              style={{ borderBottom: "1px solid var(--ts-border)" }}
            >
              <th className="px-5 py-3 font-normal">{t("admin:users.table.username")}</th>
              <th className="px-3 py-3 font-normal">{t("admin:users.table.role")}</th>
              <th className="px-3 py-3 text-right font-normal">{t("admin:users.table.flights")}</th>
              <th className="px-3 py-3 text-right font-normal">
                {t("admin:users.table.achievements")}
              </th>
              <th className="px-3 py-3 font-normal">2FA</th>
              <th className="px-3 py-3 font-normal">{t("admin:users.table.status")}</th>
              <th className="w-12 px-3 py-3">
                <span className="sr-only">{t("admin:users.table.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ts-border)]">
            {users.map((user) => (
              <tr
                key={user.id}
                ref={user.id === highlightUserId ? highlightRef : undefined}
                data-highlighted={user.id === highlightUserId ? "true" : undefined}
                style={
                  user.id === highlightUserId
                    ? { boxShadow: "inset 2px 0 0 var(--ts-accent)" }
                    : undefined
                }
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{
                        background: "var(--ts-surface2)",
                        color: "var(--ts-text-bright)",
                        fontFamily: "var(--ts-font-mono)",
                      }}
                    >
                      {user.username.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="flex flex-col">
                      <span style={{ fontWeight: 700, color: "var(--ts-text-bright)" }}>
                        {user.username}
                      </span>
                      <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                        {formatIsoDate(user.createdAt)}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span
                    className="ts-status-pill"
                    style={statusPillStyle(user.isAdmin ? "in_progress" : "historical")}
                  >
                    {user.isAdmin ? t("admin:users.role.admin") : t("admin:users.role.user")}
                  </span>
                </td>
                <td className="px-3 py-3 text-right" style={MONO}>
                  {user._count.flights}
                </td>
                <td className="px-3 py-3 text-right" style={MONO}>
                  {user._count.userAchievements}
                </td>
                <td className="px-3 py-3">
                  <span
                    className="ts-status-pill"
                    style={statusPillStyle(user.twoFactorEnabledAt ? "completed" : "historical")}
                  >
                    {user.twoFactorEnabledAt
                      ? t("admin:users.twoFactor.on")
                      : t("admin:users.twoFactor.off")}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span
                    className="ts-status-pill"
                    style={statusPillStyle(user.isActive ? "completed" : "cancelled")}
                  >
                    {user.isActive
                      ? t("admin:users.status.active")
                      : t("admin:users.status.inactive")}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  <RowMenu label={t("common:buttons.moreActions")}>
                    {(close) => (
                      <>
                        <MenuItem
                          onClick={() => {
                            close();
                            onToggleUserActive(user.id);
                          }}
                        >
                          {user.isActive
                            ? t("admin:users.actions.deactivate")
                            : t("admin:users.actions.activate")}
                        </MenuItem>
                        <MenuItem
                          onClick={() => {
                            close();
                            setResetModalUser({ id: user.id, username: user.username });
                          }}
                        >
                          {t("admin:users.actions.resetPassword")}
                        </MenuItem>
                        {/* Only offered while 2FA is actually on. */}
                        {user.twoFactorEnabledAt !== null && (
                          <MenuItem
                            onClick={() => {
                              close();
                              setResetTwoFactorConfirm({ id: user.id, username: user.username });
                            }}
                          >
                            {t("admin:users.actions.resetTwoFactor")}
                          </MenuItem>
                        )}
                        {user.id !== currentUserId && (
                          <MenuItem
                            danger
                            onClick={() => {
                              close();
                              setDeleteUserConfirm({ id: user.id, username: user.username });
                            }}
                          >
                            {t("admin:users.actions.delete")}
                          </MenuItem>
                        )}
                      </>
                    )}
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AnimatePresence>
        {resetModalUser && (
          <AdminPasswordResetModal
            userId={resetModalUser.id}
            username={resetModalUser.username}
            onClose={() => setResetModalUser(null)}
          />
        )}
      </AnimatePresence>
      <ConfirmModal
        isOpen={!!resetTwoFactorConfirm}
        onClose={() => setResetTwoFactorConfirm(null)}
        onConfirm={() => {
          if (resetTwoFactorConfirm) {
            onResetTwoFactor(resetTwoFactorConfirm.id);
            setResetTwoFactorConfirm(null);
          }
        }}
        title={t("admin:users.resetTwoFactorConfirm.title")}
        message={t("admin:users.resetTwoFactorConfirm.message", {
          username: resetTwoFactorConfirm?.username ?? "",
        })}
        confirmText={t("admin:users.resetTwoFactorConfirm.confirm")}
        cancelText={t("common:buttons.cancel")}
        confirmButtonClass="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500 text-white"
      />
      <ConfirmModal
        isOpen={!!deleteUserConfirm}
        onClose={() => setDeleteUserConfirm(null)}
        onConfirm={() => {
          if (deleteUserConfirm) {
            onDeleteUser(deleteUserConfirm.id);
            setDeleteUserConfirm(null);
          }
        }}
        title={t("admin:users.deleteConfirm.title")}
        message={t("admin:users.deleteConfirm.message", {
          username: deleteUserConfirm?.username ?? "",
        })}
        confirmText={t("admin:users.deleteConfirm.confirm")}
        cancelText={t("common:buttons.cancel")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </div>
  );
}

const MONO = { fontFamily: "var(--ts-font-mono)", color: "var(--ts-text-bright)" } as const;

/** A row's "…" menu: rare and destructive actions stay one click away, not in the row. */
function RowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-block"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--ts-radius-button)]"
        style={{ color: "var(--ts-muted)" }}
      >
        <Icon name="ellipsis" size={16} />
      </button>
      {open && (
        <span
          role="menu"
          className="absolute right-0 z-30 mt-1 flex min-w-48 flex-col p-1 text-left shadow-xl"
          style={{
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-button)",
          }}
        >
          {children(() => setOpen(false))}
        </span>
      )}
    </span>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="whitespace-nowrap rounded-[var(--ts-radius-button)] px-3 py-2 text-left text-sm hover:bg-[var(--ts-surface2)]"
      style={{ color: danger ? "var(--ts-bad)" : "var(--ts-text-bright)" }}
    >
      {children}
    </button>
  );
}
