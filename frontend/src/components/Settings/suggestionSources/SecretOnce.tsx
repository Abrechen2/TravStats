import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import Button from "../../ui/Button";

/**
 * A plugin secret, shown the one time the server sends it (create, rotate). It is
 * never shown again: the page says so and offers a copy.
 */
export default function SecretOnce({
  secret,
  onDone,
}: {
  secret: string;
  onDone: () => void;
}): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div
      role="alert"
      className="flex flex-col"
      style={{
        gap: "var(--ts-space-xs)",
        padding: "var(--ts-space-md)",
        border: "1px solid var(--ts-accent)",
        borderRadius: "var(--ts-radius-card)",
      }}
      data-testid="plugin-secret"
    >
      <p className="t-body">{t("suggestionSources:plugins.secret.once")}</p>
      <code className="break-all" style={{ fontSize: 15 }}>
        {secret}
      </code>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button
          onClick={() =>
            navigator.clipboard
              .writeText(secret)
              .then(() => setCopied(true))
              .catch((e: unknown) => {
                console.warn("secret could not be copied", e);
                setCopied(false);
              })
          }
        >
          {t("suggestionSources:plugins.secret.copy")}
        </Button>
        <Button onClick={onDone}>{t("suggestionSources:plugins.secret.done")}</Button>
      </div>
      {copied !== null && (
        <p className="t-caption" role="status">
          {t(
            copied
              ? "suggestionSources:plugins.secret.copied"
              : "suggestionSources:plugins.secret.copyFailed"
          )}
        </p>
      )}
    </div>
  );
}
