import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The line that explains the asterisk (forgejo#245).
 *
 * A mark nobody explains is a decoration: the asterisk is `aria-hidden`, so
 * this sentence is also the only place a sighted reader learns what it means.
 * One key for every domain, so the sentence cannot drift between forms.
 */
export default function RequiredLegend({ className }: { className?: string }): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <p className={`text-xs text-[var(--text-muted)] ${className ?? ""}`.trim()}>
      {t("common:form.requiredLegend")}
    </p>
  );
}
