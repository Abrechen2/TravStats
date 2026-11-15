import { isAxiosError } from "axios";
import { useEffect, useRef, useState, type JSX } from "react";

import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi, type PublicUrlCheckResult } from "../../lib/api/admin";
import { profileDateTime } from "../../lib/profileInstant";
import { refreshReadinessShell } from "../../store/readinessShellStore";
import Button from "../ui/Button";

type Outcome =
  | { kind: "result"; result: PublicUrlCheckResult }
  | { kind: "failed"; reason: "timeout" | "rateLimited" | "forbidden" | "generic" };

/** The request itself failed — not the same thing as "the address is unreachable". */
function failureOf(error: unknown): "timeout" | "rateLimited" | "forbidden" | "generic" {
  if (!isAxiosError(error)) return "generic";
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "timeout";
  const status = error.response?.status;
  if (status === 429) return "rateLimited";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 504 || status === 408) return "timeout";
  return "generic";
}

/**
 * "Erreichbarkeit prüfen" on the public-address row (readiness stage 2, §12).
 * The server probes the SAVED address, so an edited, unsaved one disables the
 * button and says why — a green answer for the old address would read as an
 * answer for the new one. Every outcome has its own sentence; a failed request
 * is never shown as "unreachable" and an unreachable address never as an error.
 */
export default function PublicUrlCheck({
  unsaved,
  savedUrl,
}: {
  unsaved: boolean;
  /** The address the server holds; a result belongs to exactly one of these. */
  savedUrl: string;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const coarse = useCoarsePointer();
  const demo = useIsDemoAccount();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A result for an address the field no longer holds would read as an answer
  // about the new one: drop it on any edit or save, and ignore a late arrival.
  const current = useRef(savedUrl);
  useEffect(() => {
    current.current = savedUrl;
    setOutcome(null);
  }, [savedUrl, unsaved]);

  const run = async (): Promise<void> => {
    const asked = current.current;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await adminApi.checkPublicUrl();
      if (asked !== current.current) return;
      setOutcome({ kind: "result", result });
      // A stored result changes the readiness item; the shell re-reads once.
      void refreshReadinessShell();
    } catch (error) {
      if (asked !== current.current) return;
      setOutcome({ kind: "failed", reason: failureOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const message = ((): { text: string; good: boolean } | null => {
    if (!outcome) return null;
    if (outcome.kind === "failed") {
      return { text: t(`settings:publicUrlCheck.failed.${outcome.reason}`), good: false };
    }
    const { result } = outcome;
    if (result.ok) {
      const time = profileDateTime(result.checkedAt) ?? "";
      return { text: t("settings:publicUrlCheck.ok", { time }), good: true };
    }
    const code = result.errorCode ?? "unknown";
    return {
      text: t(`settings:publicUrlCheck.error.${code}`, { status: result.httpStatus ?? "–" }),
      good: false,
    };
  })();

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <div>
        <Button
          variant="secondary"
          disabled={busy || unsaved || demo}
          style={{ minHeight: coarse ? 44 : undefined }}
          onClick={() => void run()}
        >
          {busy ? t("settings:publicUrlCheck.checking") : t("settings:publicUrlCheck.button")}
        </Button>
      </div>
      {unsaved && <p className="t-caption">{t("settings:publicUrlCheck.saveFirst")}</p>}
      {message && (
        <p
          role={message.good ? "status" : "alert"}
          className="t-caption"
          style={{ color: message.good ? "var(--ts-good)" : "var(--ts-warn)" }}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
