import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/** Stands in for a control the demo account may not use (403 DEMO_ACCOUNT_FORBIDDEN). */
export default function DemoLockedNotice(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <p className="t-caption" role="note">
      {t("settings:demoLocked")}
    </p>
  );
}
