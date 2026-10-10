import { formatInProfileZone } from "../../lib/profileInstant";
import { useTranslation } from "../../hooks/useTranslation";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import Toggletip from "../ui/Toggletip";

export interface Invitation {
  id: string;
  email: string | null;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  emailStatus: string | null;
  emailError: string | null;
  emailSentAt: string | null;
  creator: { username: string };
  user: { username: string } | null;
}

export type StatusFilter = "all" | "active" | "used" | "expired";

interface InvitationManagementProps {
  invitations: Invitation[];
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  onCreateLink: () => void;
  onCreateEmail: () => void;
  onCopyLink: (invitation: Invitation) => void;
  onResendEmail: (invitation: Invitation) => void;
  onRevoke: (id: string) => void;
}

function isExpired(invitation: Invitation): boolean {
  return new Date(invitation.expiresAt) <= new Date();
}

function rowStatus(invitation: Invitation): "used" | "expired" | "active" {
  if (invitation.usedAt) return "used";
  if (isExpired(invitation)) return "expired";
  return "active";
}

export default function InvitationManagement({
  invitations,
  statusFilter,
  onStatusFilterChange,
  onCreateLink,
  onCreateEmail,
  onCopyLink,
  onResendEmail,
  onRevoke,
}: InvitationManagementProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const { confirm: askConfirm, confirmDialog } = useConfirmDialog();

  const handleRevoke = async (id: string): Promise<void> => {
    if (await askConfirm({ message: t("admin:invitations.confirmRevoke"), destructive: true })) {
      onRevoke(id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold text-(--text-primary)">
            {t("admin:invitations.invitationLinks")}
          </h2>
          {/* Was the collapsed help box; the two facts an admin needs before
              sending one — single use, seven days — now simply stand here. */}
          <p className="text-sm text-(--text-muted) mt-1">{t("admin:invitations.description")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onCreateLink} className="btn-primary">
            {t("admin:invitations.actions.createLink")}
          </button>
          <button onClick={onCreateEmail} className="btn-secondary">
            {t("admin:invitations.actions.createEmail")}
          </button>
        </div>
      </div>

      <div
        className="flex gap-2 mb-4"
        role="group"
        aria-label={t("admin:invitations.filter.label")}
      >
        {(["all", "active", "used", "expired"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatusFilterChange(s)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              statusFilter === s
                ? "bg-(--accent)/20 border-(--accent)/50 text-(--accent)"
                : "border-border text-(--text-muted)"
            }`}
          >
            {t(`admin:invitations.filter.${s}`)}
          </button>
        ))}
      </div>

      {/* `relative`: the scroller must be the containing block of anything
          absolutely positioned in the table, or it escapes the clip and
          widens the page on a phone (forgejo#182, the users table). */}
      <div className="bg-(--bg-surface) relative overflow-x-auto rounded-lg shadow-sm">
        <table className="w-full min-w-[720px]">
          <thead className="bg-(--bg-base)">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-(--text-muted)">
                {t("admin:invitations.table.email")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-(--text-muted)">
                {t("admin:invitations.table.createdBy")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-(--text-muted)">
                {t("admin:invitations.table.expires")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-(--text-muted)">
                {t("admin:invitations.table.usedBy")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-(--text-muted)">
                {t("admin:invitations.table.status")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-(--text-muted)">
                {t("admin:invitations.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {invitations.map((invitation) => {
              const status = rowStatus(invitation);
              const showResend =
                status === "active" &&
                invitation.email !== null &&
                (invitation.emailStatus === null || invitation.emailStatus === "failed");
              return (
                <tr key={invitation.id}>
                  <td className="px-4 py-3 text-sm">
                    {invitation.email ?? <span className="text-(--text-muted)">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm">{invitation.creator.username}</td>
                  <td className="px-4 py-3 text-sm">
                    {/* No place: the profile clock (ADR 0002 Q1), in date-fns' old en-US shape. */}
                    {formatInProfileZone(invitation.expiresAt, "en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {invitation.user?.username ?? <span className="text-(--text-muted)">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {status === "used" ? (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-(--bg-elevated)">
                        {t("admin:invitations.status.usedOn", {
                          date: formatInProfileZone(invitation.usedAt!, "en-US", {
                            month: "short",
                            day: "numeric",
                          }),
                        })}
                      </span>
                    ) : status === "expired" ? (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                        {t("admin:invitations.status.expired")}
                      </span>
                    ) : invitation.emailStatus === "failed" ? (
                      <Toggletip
                        content={invitation.emailError ?? t("admin:invitations.status.emailFailed")}
                        triggerClassName="px-2 py-1 text-xs font-semibold rounded-full"
                        triggerStyle={{ background: "rgba(245,158,11,0.2)", color: "#d97706" }}
                      >
                        {t("admin:invitations.status.emailFailed")}
                      </Toggletip>
                    ) : (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                        {t("admin:invitations.status.active")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <div className="flex items-center justify-end gap-2">
                      {status === "active" && (
                        <button
                          type="button"
                          onClick={() => onCopyLink(invitation)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {t("admin:invitations.actions.copyLink")}
                        </button>
                      )}
                      {showResend && (
                        <button
                          type="button"
                          onClick={() => onResendEmail(invitation)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {invitation.emailStatus === "failed"
                            ? t("admin:invitations.actions.resendEmail")
                            : t("admin:invitations.actions.sendEmail")}
                        </button>
                      )}
                      {status !== "used" && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(invitation.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          {t("admin:invitations.actions.revoke")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirmDialog}
    </div>
  );
}
