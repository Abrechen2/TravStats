import { useState } from "react";
import { format } from "date-fns";
import { AnimatePresence } from "framer-motion";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import type { AdminUser } from "./SystemInfo";
import AdminPasswordResetModal from "./AdminPasswordResetModal";
import ConfirmModal from "../Training/ConfirmModal";

interface UserManagementProps {
  users: AdminUser[];
  onToggleUserActive: (userId: string) => void;
  onDeleteUser: (userId: string) => void;
}

export default function UserManagement({
  users,
  onToggleUserActive,
  onDeleteUser,
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

  return (
    <div className="space-y-4">
      <InlineHelp
        title={t("admin:users.title")}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>{t("admin:users.help.description")}</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t("admin:users.help.adminTitle")}</strong> {t("admin:users.help.admin")}
              </li>
              <li>
                <strong>{t("admin:users.help.userTitle")}</strong> {t("admin:users.help.user")}
              </li>
              <li>
                <strong>{t("admin:users.help.deactivateTitle")}</strong>{" "}
                {t("admin:users.help.deactivate")}
              </li>
            </ul>
          </div>
        }
      />
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
                  <div className="text-sm font-medium text-(--text-primary)">
                    {user.username}
                  </div>
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
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      {t("admin:users.status.active")}
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                      {t("admin:users.status.inactive")}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => onToggleUserActive(user.id)}
                    className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
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
                  {user.id !== currentUserId && (
                    <>
                      {" · "}
                      <button
                        onClick={() =>
                          setDeleteUserConfirm({ id: user.id, username: user.username })
                        }
                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
