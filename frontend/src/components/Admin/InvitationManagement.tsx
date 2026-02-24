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
            <p>{t("admin:invitations.help.description")}</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t("admin:invitations.help.createTitle")}</strong>{" "}
                {t("admin:invitations.help.create")}
              </li>
              <li>
                <strong>{t("admin:invitations.help.expiryTitle")}</strong>{" "}
                {t("admin:invitations.help.expiry")}
              </li>
              <li>
                <strong>{t("admin:invitations.help.oneUseTitle")}</strong>{" "}
                {t("admin:invitations.help.oneUse")}
              </li>
              <li>
                <strong>{t("admin:invitations.help.emailTitle")}</strong>{" "}
                {t("admin:invitations.help.email")}
              </li>
            </ul>
          </div>
        }
      />
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("admin:invitations.invitationLinks")}
        </h2>
        <button
          onClick={onCreateInvitation}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
        >
          {t("admin:invitations.createButton")}
        </button>
      </div>

      {copiedUrl && (
        <div
          className="border rounded-lg p-3 text-sm"
          style={{ background: "var(--bg-elevated)", borderColor: "#4ade80", color: "#16a34a" }}
        >
          {t("admin:invitations.copiedToClipboard")}
        </div>
      )}

      <div className="bg-[var(--bg-surface)] rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--bg-base)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {t("admin:invitations.table.email")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {t("admin:invitations.table.createdBy")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {t("admin:invitations.table.expires")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {t("admin:invitations.table.status")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-primary)]">
                  {invitation.email || <span className="text-[var(--text-muted)]">&mdash;</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-primary)]">
                  {invitation.creator.username}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-primary)]">
                  {format(new Date(invitation.expiresAt), "MMM d, yyyy")}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {invitation.usedAt ? (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                      {t("admin:invitations.status.usedOn", {
                        date: format(new Date(invitation.usedAt), "MMM d"),
                      })}
                    </span>
                  ) : new Date(invitation.expiresAt) < new Date() ? (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                      {t("admin:invitations.status.expired")}
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      {t("admin:invitations.status.active")}
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
