import { format } from "date-fns";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";
import type { AdminUser } from "./SystemInfo";

interface UserManagementProps {
  users: AdminUser[];
  onToggleUserActive: (userId: string) => void;
}

export default function UserManagement({
  users,
  onToggleUserActive,
}: UserManagementProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-4">
      <InlineHelp
        title={t("admin:users.title")}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>
              Verwalten Sie alle Benutzer Ihrer TravStats-Instanz. Hier können Sie Benutzer
              anzeigen, Rollen ändern und Benutzer löschen.
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>Admin:</strong> Vollzugriff auf alle Funktionen, einschließlich Admin-Panel
              </li>
              <li>
                <strong>User:</strong> Standard-Benutzer mit Zugriff auf Flüge, Statistiken und
                Achievements
              </li>
              <li>
                <strong>Löschen:</strong> Vorsicht! Beim Löschen werden alle Daten des Benutzers
                entfernt
              </li>
            </ul>
          </div>
        }
      />
      <div className="bg-[var(--bg-surface)] rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--bg-base)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Username
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Flights
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Achievements
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    {user.username}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {format(new Date(user.createdAt), "MMM d, yyyy")}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-primary)]">
                  {user._count.flights}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-primary)]">
                  {user._count.userAchievements}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.isAdmin ? (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                      Admin
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                      User
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {user.isActive ? (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => onToggleUserActive(user.id)}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    {user.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
