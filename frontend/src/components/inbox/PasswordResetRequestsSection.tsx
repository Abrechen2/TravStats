import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { adminApi, type PasswordResetRequest } from "../../lib/api/admin";
import { logger } from "../../lib/logger";
import { useAuthStore } from "../../store/authStore";
import { useToastStore } from "../../store/toastStore";
import Button from "../ui/Button";
import { Card } from "../ui/Card";

import { relativeTimeFromNow } from "./relativeTime";

/**
 * "Somebody asked for their password back" — the admin-only block at the top of
 * the inbox's review tab (forgejo#88, point 2).
 *
 * An instance without SMTP used to answer a forgotten password with a sentence
 * telling the user to contact an administrator, and the administrator was never
 * told. The request is a row now, and this is where it is read.
 *
 * ## Why it can disappear entirely
 *
 * It renders nothing at all for a non-admin, and nothing for an admin with no
 * open request. Both are deliberate: the inbox is a normal user's page, and a
 * permanently present empty block above their own questions would be a heading
 * about other people's accounts that never has anything under it.
 *
 * ## Why it does not reset the password itself
 *
 * Handing an admin a reset button here would mean deciding, in a list, what
 * `AdminPasswordResetModal` asks about properly — generate or set, force a
 * change on next login. The row links INTO user management at the account
 * instead, and "erledigt" only stamps the request. Two buttons, because
 * answering the person and clearing the note are two decisions; an admin who
 * rang them up clears the note without touching the account.
 */
export default function PasswordResetRequestsSection(): JSX.Element | null {
  const { t, i18n } = useTranslation(["dataQuality", "common"]);
  const isAdmin = useAuthStore((state) => state.user?.isAdmin ?? false);
  const addToast = useToastStore((state) => state.addToast);

  const [requests, setRequests] = useState<PasswordResetRequest[]>([]);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await adminApi.getPasswordResetRequests();
      setRequests(data.requests);
    } catch (error) {
      // A failure here is not the user's problem — they came to the inbox for
      // their own questions. It is logged and the block stays away, rather
      // than a toast about an admin endpoint on somebody else's screen.
      logger.warn("Failed to load password reset requests:", error);
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  const handleDone = async (id: string): Promise<void> => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await adminApi.markPasswordResetRequestHandled(id);
      setRequests((prev) => prev.filter((request) => request.id !== id));
      addToast("success", t("dataQuality:passwordResets.handled"));
    } catch (error) {
      logger.error("Failed to mark the password reset request as handled:", error);
      addToast("error", t("dataQuality:passwordResets.handleFailed"));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (!isAdmin || requests.length === 0) return null;

  return (
    <Card
      style={{ marginBottom: "var(--ts-space-xl)" }}
      aria-labelledby="password-reset-requests-title"
    >
      <h3
        id="password-reset-requests-title"
        style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t("dataQuality:passwordResets.title")}
      </h3>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
        {t("dataQuality:passwordResets.description")}
      </p>

      <ul
        className="flex flex-col"
        style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
      >
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-center justify-between"
            style={{
              gap: "var(--ts-space-md)",
              borderTop: "1px solid var(--ts-border)",
              paddingTop: "var(--ts-space-md)",
            }}
          >
            <span style={{ color: "var(--ts-text)" }}>
              {t("dataQuality:passwordResets.row", {
                username: request.username,
                when: relativeTimeFromNow(request.requestedAt, i18n.language),
              })}
            </span>
            <span className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
              {/* The admin page reads `?user=` and scrolls that row into view —
                  see UserManagement. `?tab=` must name the tab the section
                  lives in, or the deep link lands nowhere. */}
              <Link to={`/admin?tab=general&section=users&user=${request.userId}`}>
                <Button variant="secondary">{t("dataQuality:passwordResets.openUser")}</Button>
              </Link>
              <Button
                variant="secondary"
                disabled={busyIds.has(request.id)}
                onClick={() => void handleDone(request.id)}
              >
                {t("dataQuality:passwordResets.markHandled")}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
