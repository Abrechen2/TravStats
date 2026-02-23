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
    <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">{title}</h3>
          <p className="text-sm text-blue-800 dark:text-blue-200">{message}</p>
          {linkTo && linkText && (
            <Link
              to={linkTo}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block"
            >
              {linkText} {"→"}
            </Link>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="ml-4 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200"
          aria-label={t("accessibility.closeHint")}
        >
          x
        </button>
      </div>
    </div>
  );
}
