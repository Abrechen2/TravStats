import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { STORAGE_KEYS } from "../../lib/constants";
import { useTranslation } from "../../hooks/useTranslation";

interface ContextualHintProps {
  id: string;
  title: string;
  message: string;
  linkTo?: string;
  linkText?: string;
}

export default function ContextualHint({
  id,
  title,
  message,
  linkTo,
  linkText,
}: ContextualHintProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const { t } = useTranslation("common");

  useEffect(() => {
    const dismissedHints = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONTEXTUAL_HINTS) || "{}");
    setDismissed(dismissedHints[id] || false);
  }, [id]);

  const handleDismiss = () => {
    setDismissed(true);
    const dismissedHints = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONTEXTUAL_HINTS) || "{}");
    dismissedHints[id] = true;
    localStorage.setItem(STORAGE_KEYS.CONTEXTUAL_HINTS, JSON.stringify(dismissedHints));
  };

  if (dismissed) return null;

  return (
    <div
      className="mb-6 rounded-lg p-4"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
            {title}
          </h3>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {message}
          </p>
          {linkTo && linkText && (
            <Link
              to={linkTo}
              className="text-sm hover:underline mt-2 inline-block"
              style={{ color: "var(--color-amber)" }}
            >
              {linkText} {"→"}
            </Link>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="ml-4"
          style={{ color: "var(--text-muted)" }}
          aria-label={t("accessibility.closeHint")}
        >
          x
        </button>
      </div>
    </div>
  );
}
