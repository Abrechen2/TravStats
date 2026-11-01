import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { AnimatePresence } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../../lib/api";
import { formatIsoDate } from "../../lib/dateUtils";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { useToastStore } from "../../store/toastStore";
import { statusPillStyle } from "../table/statusPillStyle";
import AdminPasswordResetModal from "../Admin/AdminPasswordResetModal";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";
import Button from "../ui/Button";
import { ConfirmDialog, ErrorLine, SettingItem } from "../ui/settings";
import { MenuItem, RowMenu } from "./RowMenu";
import type { AdminUser } from "./types";
import { useAdminAction } from "./useAdminAction";

type Pending = { kind: "delete" | "lock" | "reset2fa"; user: AdminUser };

/**
 * Users › Konten (design C2): every account with the actions that need an
 * admin — lock, new password, reset the second step, delete. Locking, the
 * second-step reset and deleting go through the confirmation block (deleting
 * with the account's name typed); a failed action is said under the row, with
 * which action it was.
 */
export default function UsersAccounts(): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin", "common"]);
  const row = useRowCopy("users");
  const dialog = useDialogCopy();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const addToast = useToastStore((s) => s.addToast);
  const [params] = useSearchParams();
  const highlightUserId = params.get("user");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reset, setReset] = useState<AdminUser | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const action = useAdminAction();
  const highlightRef = useRef<HTMLLIElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const { users: list } = await adminApi.getUsers();
      setUsers(list);
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load the accounts", error);
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The row a link meant (the inbox row of a password-reset request); nothing is
  // pre-selected, because the actions here are destructive.
  useEffect(() => {
    if (highlightUserId && typeof highlightRef.current?.scrollIntoView === "function") {
      highlightRef.current.scrollIntoView({ block: "center" });
    }
  }, [highlightUserId, users]);

  const toggleActive = (user: AdminUser): Promise<boolean> =>
    action.run("lock", async () => {
      await adminApi.toggleUserActive(user.id);
      await load();
    });

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    const { kind, user } = pending;
    const ok =
      kind === "delete"
        ? await action.run("delete", async () => {
            await adminApi.deleteUser(user.id);
            await load();
          })
        : kind === "reset2fa"
          ? await action.run("reset2fa", async () => {
              await adminApi.disableUserTwoFactor(user.id);
              await load();
            })
          : await toggleActive(user);
    if (ok) {
      setPending(null);
      addToast("success", t(`settingsRows:users.done.${kind}`, { name: user.username }));
    } else {
      setPending(null);
    }
  };

  const copy = row("nutzerliste");
  const asking = pending
    ? dialog(
        pending.kind === "delete" ? "userdel" : pending.kind === "lock" ? "userlock" : "user2fa",
        { name: pending.user.username, count: pending.user._count.flights }
      )
    : null;

  return (
    <SettingItem title={copy.title} help={copy.help} scope="allAccounts">
      {loadFailed ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
          <ErrorLine>{t("settingsRows:users.errors.load")}</ErrorLine>
          <Button variant="secondary" onClick={() => void load()}>
            {t("settingsRows:server.retry")}
          </Button>
        </div>
      ) : null}
      {action.failed ? (
        <ErrorLine>{t(`settingsRows:users.errors.${action.failed}`)}</ErrorLine>
      ) : null}
      <ul className="flex flex-col" style={{ margin: 0, padding: 0 }}>
        {(users ?? []).map((user) => (
          <li
            key={user.id}
            ref={user.id === highlightUserId ? highlightRef : undefined}
            data-highlighted={user.id === highlightUserId ? "true" : undefined}
            className="flex flex-wrap items-center"
            style={{
              listStyle: "none",
              gap: "var(--ts-space-md)",
              padding: "var(--ts-space-md) 0",
              borderTop: "1px solid var(--ts-border)",
              ...(user.id === highlightUserId
                ? { boxShadow: "inset 2px 0 0 var(--ts-accent)" }
                : null),
            }}
          >
            <span className="flex min-w-0 flex-col" style={{ flex: "1 1 200px" }}>
              <span style={{ fontWeight: 700, color: "var(--ts-text-bright)" }}>
                {user.username}
              </span>
              <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                {formatIsoDate(user.createdAt)} ·{" "}
                {t("settingsRows:users.counts", {
                  flights: user._count.flights,
                  achievements: user._count.userAchievements,
                })}
              </span>
            </span>
            <span className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <span
                className="ts-status-pill"
                style={statusPillStyle(user.isAdmin ? "in_progress" : "historical")}
              >
                {user.isAdmin ? t("admin:users.role.admin") : t("admin:users.role.user")}
              </span>
              {user.username === "demo" ? (
                <span className="ts-status-pill" style={statusPillStyle("review")}>
                  {t("settingsRows:users.demo")}
                </span>
              ) : null}
              <span
                className="ts-status-pill"
                style={statusPillStyle(user.twoFactorEnabledAt ? "completed" : "historical")}
              >
                {user.twoFactorEnabledAt
                  ? t("admin:users.twoFactor.on")
                  : t("admin:users.twoFactor.off")}
              </span>
              <span
                className="ts-status-pill"
                style={statusPillStyle(user.isActive ? "completed" : "cancelled")}
              >
                {user.isActive ? t("admin:users.status.active") : t("admin:users.status.inactive")}
              </span>
            </span>
            <RowMenu label={t("settingsRows:users.menu", { name: user.username })}>
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      close();
                      if (user.isActive) setPending({ kind: "lock", user });
                      else void toggleActive(user);
                    }}
                  >
                    {user.isActive
                      ? t("admin:users.actions.deactivate")
                      : t("admin:users.actions.activate")}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close();
                      setReset(user);
                    }}
                  >
                    {t("admin:users.actions.resetPassword")}
                  </MenuItem>
                  {user.twoFactorEnabledAt !== null ? (
                    <MenuItem
                      onClick={() => {
                        close();
                        setPending({ kind: "reset2fa", user });
                      }}
                    >
                      {t("admin:users.actions.resetTwoFactor")}
                    </MenuItem>
                  ) : null}
                  {user.id !== currentUserId ? (
                    <MenuItem
                      danger
                      onClick={() => {
                        close();
                        setPending({ kind: "delete", user });
                      }}
                    >
                      {t("admin:users.actions.delete")}
                    </MenuItem>
                  ) : null}
                </>
              )}
            </RowMenu>
          </li>
        ))}
      </ul>
      <AnimatePresence>
        {reset ? (
          <AdminPasswordResetModal
            userId={reset.id}
            username={reset.username}
            onClose={() => setReset(null)}
          />
        ) : null}
      </AnimatePresence>
      {asking ? (
        <ConfirmDialog
          open
          {...asking}
          busy={action.busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </SettingItem>
  );
}
