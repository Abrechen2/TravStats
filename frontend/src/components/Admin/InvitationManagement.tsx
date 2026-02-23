import { format } from "date-fns";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

export interface Invitation {
  id: string;
  email?: string;
  token: string;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
  creator: {
    username: string;
  };
}

interface InvitationManagementProps {
  invitations: Invitation[];
  copiedUrl: boolean;
  onCreateInvitation: () => void;
}

export default function InvitationManagement({
  invitations,
  copiedUrl,
  onCreateInvitation,
}: InvitationManagementProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-4">
      <InlineHelp
        title={t("admin:invitations.title")}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>
              Erstellen Sie Einladungslinks, um neue Benutzer zu Ihrer TravStats-Instanz einzuladen.
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>Einladung erstellen:</strong> Generiert einen eindeutigen Link, der zum
                Registrieren verwendet werden kann
              </li>
              <li>
                <strong>Ablaufdatum:</strong> Einladungen laufen nach 7 Tagen ab (standardmäßig)
              </li>
              <li>
                <strong>Einmalige Nutzung:</strong> Jeder Link kann nur einmal verwendet werden
              </li>
              <li>
                <strong>E-Mail (optional):</strong> Sie können eine E-Mail-Adresse zuordnen, um die
                Einladung zu verfolgen
              </li>
            </ul>
          </div>
        }
      />
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Invitation Links</h2>
        <button
          onClick={onCreateInvitation}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
        >
          + Create Invitation
        </button>
      </div>

      {copiedUrl && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-green-800 dark:text-green-200 text-sm">
          Invitation link copied to clipboard!
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Created By
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Expires
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {invitation.email || <span className="text-gray-400">&mdash;</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {invitation.creator.username}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {format(new Date(invitation.expiresAt), "MMM d, yyyy")}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {invitation.usedAt ? (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                      Used on {format(new Date(invitation.usedAt), "MMM d")}
                    </span>
                  ) : new Date(invitation.expiresAt) < new Date() ? (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                      Expired
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                      Active
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
