import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  announceRecoveryKeyStatusChange,
  recoveryKeyApi,
  type RecoveryKeyStatus,
  type RevealedRecoveryKey,
} from "../../lib/api/recoveryKey";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import Button from "../ui/Button";
import { ErrorLine, LinkButton } from "../ui/settings";
import RecoveryKeyReauthStep from "./RecoveryKeyReauthStep";

/** How many trailing characters the confirm step asks for — the server's own number. */
export const CONFIRM_LENGTH = 4;

type Step = "reauth" | "show" | "confirm";

/** The text of the downloaded file, in the UI's language. */
function fileText(
  t: (key: string, values?: Record<string, string>) => string,
  revealed: RevealedRecoveryKey
): string {
  return [
    t("settings:recoveryKey.file.title"),
    "",
    `${t("settings:recoveryKey.file.instance")}: ${revealed.instanceName}`,
    `${t("settings:recoveryKey.file.key")}: ${revealed.key}`,
    `${t("settings:recoveryKey.file.fingerprint")}: ${revealed.fingerprint}`,
    "",
    t("settings:recoveryKey.file.restore"),
    t("settings:recoveryKey.file.restoreManual"),
    "",
    t("settings:recoveryKey.file.keep"),
    "",
  ].join("\n");
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * The recovery-key flow (owner request 2026-11-24): re-authenticate, see the key
 * once (copy / download), then type its last four characters back. The key
 * lives in this component's state only and is gone when the dialog closes.
 */
export default function RecoveryKeyFlow({
  onConfirmed,
}: {
  onConfirmed: (status: RecoveryKeyStatus) => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [step, setStep] = useState<Step>("reauth");
  const [revealed, setRevealed] = useState<RevealedRecoveryKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [lastFour, setLastFour] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === "reauth" || !revealed) {
    return (
      <RecoveryKeyReauthStep
        notice={notice}
        onRevealed={(r) => {
          setRevealed(r);
          setNotice(null);
          setStep("show");
        }}
      />
    );
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(revealed.key);
      setCopied("ok");
    } catch (err) {
      logger.warn("Copying the recovery key failed", err);
      setCopied("failed");
    }
  };

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await recoveryKeyApi.confirm(lastFour.trim());
      announceRecoveryKeyStatusChange();
      onConfirmed(status);
    } catch (err) {
      const code = apiErrorMachineCode(err);
      logger.warn(`Recovery key confirmation refused: ${code ?? "unknown"}`);
      if (code === "RECOVERY_KEY_NOT_REVEALED") {
        // The half-hour window ran out: the key has to be shown (and proven) again.
        setRevealed(null);
        setLastFour("");
        setNotice(t("settings:recoveryKey.confirm.expired"));
        setStep("reauth");
      } else if (code === "RECOVERY_KEY_CONFIRM_MISMATCH") {
        setError(t("settings:recoveryKey.confirm.mismatch"));
      } else if (code === "RECOVERY_KEY_CONFIRM_FORMAT") {
        setError(t("settings:recoveryKey.confirm.format", { count: String(CONFIRM_LENGTH) }));
      } else if (code === "RATE_LIMITED") {
        setError(t("settings:recoveryKey.confirm.rateLimited"));
      } else {
        setError(t("settings:recoveryKey.confirm.failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === "show") {
    return (
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <p className="t-body" style={{ margin: 0 }}>
          {t("settings:recoveryKey.show.why")}
        </p>
        <p className="t-body" style={{ margin: 0, fontWeight: 600 }}>
          {t("settings:recoveryKey.show.keep")}
        </p>
        <code
          data-testid="recovery-key"
          className="t-mono"
          style={{
            display: "block",
            padding: "var(--ts-space-sm)",
            borderRadius: 8,
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            wordSpacing: "0.4em",
            lineHeight: 1.8,
            userSelect: "all",
          }}
        >
          {revealed.key}
        </code>
        <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
          <Button onClick={() => void copy()}>{t("settings:recoveryKey.show.copy")}</Button>
          <Button onClick={() => download(revealed.filename, fileText(t, revealed))}>
            {t("settings:recoveryKey.show.download")}
          </Button>
        </div>
        {copied === "ok" ? (
          <p className="t-caption" role="status" style={{ margin: 0 }}>
            {t("settings:recoveryKey.show.copied")}
          </p>
        ) : null}
        {copied === "failed" ? (
          <ErrorLine>{t("settings:recoveryKey.show.copyFailed")}</ErrorLine>
        ) : null}
        <span>
          <Button variant="primary" onClick={() => setStep("confirm")}>
            {t("settings:recoveryKey.show.next")}
          </Button>
        </span>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <label className="flex flex-col" style={{ gap: 4 }}>
        <span className="t-body">
          {t("settings:recoveryKey.confirm.label", { count: String(CONFIRM_LENGTH) })}
        </span>
        <input
          type="text"
          className="input t-mono"
          autoComplete="off"
          spellCheck={false}
          maxLength={CONFIRM_LENGTH + 2}
          value={lastFour}
          onChange={(e) => setLastFour(e.target.value)}
          style={{ maxWidth: 160, textTransform: "uppercase" }}
        />
      </label>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <Button
          variant="primary"
          type="submit"
          disabled={lastFour.trim().length !== CONFIRM_LENGTH || busy}
          aria-busy={busy || undefined}
        >
          {t("settings:recoveryKey.confirm.submit")}
        </Button>
        <LinkButton
          onClick={() => {
            setError(null);
            setStep("show");
          }}
        >
          {t("settings:recoveryKey.confirm.back")}
        </LinkButton>
      </div>
    </form>
  );
}
