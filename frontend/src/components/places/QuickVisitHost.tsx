import { useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useQuickVisitStore } from "../../store/quickVisitStore";
import { useToastStore } from "../../store/toastStore";
import { VisitDialog } from "./VisitDialog";

/**
 * Shows the visit dialog a map card asked for (`quickVisitStore`), on the page
 * that can reload the map afterwards. While it is mounted, place cards offer
 * "Besuch erfassen" (forgejo#231).
 */
export function QuickVisitHost({
  onSaved,
}: {
  /** Reload whatever shows the place — the map's data. */
  onSaved?: () => void | Promise<void>;
}): JSX.Element | null {
  const { t } = useTranslation(["places"]);
  const addToast = useToastStore((s) => s.addToast);
  const target = useQuickVisitStore((s) => s.target);
  const close = useQuickVisitStore((s) => s.close);
  const register = useQuickVisitStore((s) => s.register);

  useEffect(() => register(), [register]);

  if (target === null) return null;
  return (
    <VisitDialog
      key={target.id}
      place={target}
      onClose={close}
      afterSaveFailedKey="common:form.savedButViewRefreshFailed"
      onSaved={async () => {
        await onSaved?.();
        addToast("success", t("places:visit.recorded", { name: target.name }));
        close();
      }}
    />
  );
}
