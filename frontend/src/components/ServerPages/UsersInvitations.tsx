import { useCallback, useEffect, useState, type JSX } from "react";
import { adminApi } from "../../lib/api";
import { copyToClipboard } from "../../lib/clipboard";
import { formatInProfileZone } from "../../lib/profileInstant";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { statusPillStyle } from "../table/statusPillStyle";
import CreateEmailInviteModal from "../Admin/CreateEmailInviteModal";
import CreateLinkInviteModal from "../Admin/CreateLinkInviteModal";
import InviteSuccessModal from "../Admin/InviteSuccessModal";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";
import Button from "../ui/Button";
import { ConfirmDialog, ErrorLine, SettingItem } from "../ui/settings";
import type { Invitation } from "./types";
import { useAdminAction } from "./useAdminAction";

type Filter = "all" | "active" | "used" | "expired";
const FILTERS: readonly Filter[] = ["all", "active", "used", "expired"];

interface Success {
  inviteUrl: string;
  emailSent: boolean | undefined;
  emailError: string | null;
  recipientEmail: string | null;
}

function statusOf(invitation: Invitation): "used" | "expired" | "active" {
  if (invitation.usedAt) return "used";
  return new Date(invitation.expiresAt) <= new Date() ? "expired" : "active";
}

/**
 * Users › Einladungen (design C2): a link works once, for up to 30 days. Making
 * one by mail needs a mail server, so the button says so instead of failing
 * after the form; revoking goes through the confirmation block, and every failed
 * action is named under the list.
 */
export default function UsersInvitations(): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin"]);
  const row = useRowCopy("users");
  const dialog = useDialogCopy();
  const addToast = useToastStore((s) => s.addToast);
  const [filter, setFilter] = useState<Filter>("active");
  const [list, setList] = useState<Invitation[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mailReady, setMailReady] = useState<boolean | null>(null);
  const [linkModal, setLinkModal] = useState(false);
  const [mailModal, setMailModal] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const action = useAdminAction();

  const load = useCallback(async (): Promise<void> => {
    try {
      const { invitations } = await adminApi.getInvitations(filter);
      setList(invitations as Invitation[]);
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load the invitations", error);
      setLoadFailed(true);
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let alive = true;
    adminApi.getSmtpConfig().then(
      (config) => alive && setMailReady(config.configured === true && config.enabled !== false),
      () => alive && setMailReady(false)
    );
    return () => {
      alive = false;
    };
  }, []);

  const createLink = (days: 1 | 7 | 30): Promise<boolean> =>
    action.run("create", async () => {
      const { inviteUrl } = await adminApi.createLinkInvitation(days);
      setLinkModal(false);
      setSuccess({ inviteUrl, emailSent: undefined, emailError: null, recipientEmail: null });
      await load();
    });
  const createMail = (email: string, days: 1 | 7 | 30): Promise<boolean> =>
    action.run("create", async () => {
      const result = await adminApi.createEmailInvitation(email, days);
      setMailModal(false);
      setSuccess({
        inviteUrl: result.inviteUrl,
        emailSent: result.emailSent,
        emailError: result.emailError,
        recipientEmail: email,
      });
      await load();
    });
  const copyLink = async (invitation: Invitation): Promise<void> => {
    try {
      await copyToClipboard(`${window.location.origin}/register?token=${invitation.token}`);
      addToast("success", t("admin:invitations.success.copiedToClipboard"));
    } catch {
      addToast("error", t("admin:invitations.success.copyFailed"));
    }
  };
  const resend = (invitation: Invitation): Promise<boolean> =>
    action.run("resend", async () => {
      const { emailSent } = await adminApi.resendInvitationEmail(invitation.id);
      await load();
      // The mail server answered but refused: that is a failure of the resend, not a success.
      if (!emailSent) throw new Error("mail not sent");
      addToast("success", t("admin:invitations.toasts.resent"));
    });
  const revoke = async (): Promise<void> => {
    if (!revoking) return;
    const target = revoking;
    const ok = await action.run("revoke", async () => {
      await adminApi.revokeInvitation(target.id);
      await load();
    });
    setRevoking(null);
    if (ok) addToast("success", t("admin:invitations.toasts.revoked"));
  };

  const copy = row("einlliste");
  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      scope="allAccounts"
      control={
        <>
          <Button variant="primary" onClick={() => setLinkModal(true)}>
            {t("admin:invitations.actions.createLink")}
          </Button>
          <Button
            variant="secondary"
            disabled={mailReady !== true}
            onClick={() => setMailModal(true)}
          >
            {t("admin:invitations.actions.createEmail")}
          </Button>
        </>
      }
    >
      {mailReady === false ? (
        <p className="t-caption" style={{ margin: 0 }}>
          {t("settingsRows:users.noMail")}
        </p>
      ) : null}
      <div
        className="flex flex-wrap"
        role="group"
        aria-label={t("admin:invitations.filter.label")}
        style={{ gap: "var(--ts-space-sm)" }}
      >
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? "primary" : "secondary"}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`admin:invitations.filter.${f}`)}
          </Button>
        ))}
      </div>
      {loadFailed ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
          <ErrorLine>{t("settingsRows:users.errors.loadInvitations")}</ErrorLine>
          <Button variant="secondary" onClick={() => void load()}>
            {t("settingsRows:server.retry")}
          </Button>
        </div>
      ) : null}
      {action.failed ? (
        <ErrorLine>{t(`settingsRows:users.errors.${action.failed}`)}</ErrorLine>
      ) : null}
      {list && list.length === 0 && !loadFailed ? (
        <p className="t-caption" style={{ margin: 0 }}>
          {t("settingsRows:users.noInvitations")}
        </p>
      ) : null}
      <ul className="flex flex-col" style={{ margin: 0, padding: 0 }}>
        {(list ?? []).map((invitation) => {
          const status = statusOf(invitation);
          const canResend =
            status === "active" &&
            invitation.email !== null &&
            (invitation.emailStatus === null || invitation.emailStatus === "failed");
          return (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center"
              style={{
                listStyle: "none",
                gap: "var(--ts-space-md)",
                padding: "var(--ts-space-md) 0",
                borderTop: "1px solid var(--ts-border)",
              }}
            >
              <span className="flex min-w-0 flex-col" style={{ flex: "1 1 200px" }}>
                <span style={{ color: "var(--ts-text-bright)", fontWeight: 600 }}>
                  {invitation.email ?? t("settingsRows:users.linkOnly")}
                </span>
                <span className="t-caption">
                  {t("settingsRows:users.invitationMeta", {
                    creator: invitation.creator.username,
                    until: formatInProfileZone(invitation.expiresAt, "en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }),
                  })}
                  {invitation.user ? ` · ${invitation.user.username}` : ""}
                </span>
              </span>
              <span
                className="ts-status-pill"
                style={statusPillStyle(
                  status === "used"
                    ? "completed"
                    : status === "expired"
                      ? "cancelled"
                      : invitation.emailStatus === "failed"
                        ? "review"
                        : "in_progress"
                )}
              >
                {status === "active" && invitation.emailStatus === "failed"
                  ? t("admin:invitations.status.emailFailed")
                  : t(`settingsRows:users.status.${status}`)}
              </span>
              <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                {status === "active" ? (
                  <Button variant="secondary" onClick={() => void copyLink(invitation)}>
                    {t("admin:invitations.actions.copyLink")}
                  </Button>
                ) : null}
                {canResend ? (
                  <Button
                    variant="secondary"
                    disabled={action.busy || mailReady !== true}
                    onClick={() => void resend(invitation)}
                  >
                    {invitation.emailStatus === "failed"
                      ? t("admin:invitations.actions.resendEmail")
                      : t("admin:invitations.actions.sendEmail")}
                  </Button>
                ) : null}
                {status !== "used" ? (
                  <Button variant="danger" onClick={() => setRevoking(invitation)}>
                    {t("admin:invitations.actions.revoke")}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {linkModal ? (
        <CreateLinkInviteModal
          onCreate={async (days) => void (await createLink(days))}
          onClose={() => setLinkModal(false)}
          creating={action.busy}
        />
      ) : null}
      {mailModal ? (
        <CreateEmailInviteModal
          onCreate={async (email, days) => void (await createMail(email, days))}
          onClose={() => setMailModal(false)}
          creating={action.busy}
        />
      ) : null}
      {success ? <InviteSuccessModal {...success} onClose={() => setSuccess(null)} /> : null}
      {revoking ? (
        <ConfirmDialog
          open
          {...dialog("invrevoke", { name: revoking.email ?? t("settingsRows:users.linkOnly") })}
          busy={action.busy}
          onCancel={() => setRevoking(null)}
          onConfirm={() => void revoke()}
        />
      ) : null}
    </SettingItem>
  );
}
