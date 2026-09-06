import { useState } from "react";
import { format } from "date-fns";
import { AnimatePresence } from "framer-motion";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import type { AdminUser } from "./SystemInfo";
import AdminPasswordResetModal from "./AdminPasswordResetModal";
import ConfirmModal from "../Training/ConfirmModal";

interface UserManagementProps {
  users: AdminUser[];
  onToggleUserActive: (userId: string) => void;
  onDeleteUser: (userId: string) => void;
  onResetTwoFactor: (userId: string) => void;
}

export default function UserManagement({
  users,
  onToggleUserActive,
  onDeleteUser,
  onResetTwoFactor,
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

  return (
    <div className="space-y-4">
      {/* Was the collapsed help box. The sentence that matters is the one about
          deactivation keeping the data — an admin should not have to open
          anything to learn that. */}
      <p className="text-sm text-(--text-muted)">{t("admin:users.description")}</p>
      <div className="bg-(--bg-surface) rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-(--bg-base)">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:users.table.username")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:users.table.flights")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:users.table.achievements")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:users.table.role")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:users.table.status")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:users.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-(--text-primary)">{user.username}</div>
                  <div className="text-xs text-(--text-muted)">
                    {format(new Date(user.createdAt), "MMM d, yyyy")}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-(--text-primary)">
                  {user._count.flights}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-(--text-primary)">
                  {user._count.userAchievements}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.isAdmin ? (
                    <span
                      className="px-2 py-1 text-xs font-semibold rounded-full"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent)",
                        border: "1px solid var(--accent)",
                      }}
                    >
                      {t("admin:users.role.admin")}
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-(--bg-elevated) text-(--text-primary)">
                      {t("admin:users.role.user")}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.isActive ? (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-(--success)/15 text-(--success)">
                      {t("admin:users.status.active")}
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-(--danger)/15 text-(--danger)">
                      {t("admin:users.status.inactive")}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => onToggleUserActive(user.id)}
                    className="text-(--accent) hover:text-(--accent)"
                  >
                    {user.isActive
                      ? t("admin:users.actions.deactivate")
                      : t("admin:users.actions.activate")}
                  </button>
                  {" · "}
                  <button
                    onClick={() => setResetModalUser({ id: user.id, username: user.username })}
                    className="text-orange-500 hover:text-orange-400"
                  >
                    {t("admin:users.actions.resetPassword")}
                  </button>
                  {/* Only offered while 2FA is actually on — its presence IS
                      the indicator, no extra badge column needed. */}
                  {user.twoFactorEnabledAt !== null && (
                    <>
                      {" · "}
                      <button
                        onClick={() =>
                          setResetTwoFactorConfirm({ id: user.id, username: user.username })
                        }
                        className="text-orange-500 hover:text-orange-400"
                      >
                        {t("admin:users.actions.resetTwoFactor")}
                      </button>
                    </>
                  )}
                  {user.id !== currentUserId && (
                    <>
                      {" · "}
                      <button
                        onClick={() =>
                          setDeleteUserConfirm({ id: user.id, username: user.username })
                        }
                        className="text-(--danger) hover:text-(--danger)"
                      >
                        {t("admin:users.actions.delete")}
                      </button>
                    </>
                  )}
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
        confirmButtonClass="bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white"
      />
    </div>
  );
}
