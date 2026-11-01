import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";

const TOAST_MS = 8000;

/**
 * "Rückgängig" as a toast: it appears after a change made on this page and goes away by itself,
 * instead of a permanent button that stands there looking like an action to take. The change the
 * page was opened on is not offered - only one made here is.
 */
export function UndoToast({
  mutationId,
  busy,
  onUndo,
}: {
  mutationId: string | undefined;
  busy: boolean;
  onUndo: (mutationId: string) => void;
}) {
  const { t } = useTranslation("travplan"),
    seen = useRef(mutationId),
    [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!mutationId || mutationId === seen.current) return;
    seen.current = mutationId;
    setShown(mutationId);
    const timer = setTimeout(() => setShown(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [mutationId]);
  if (!shown || shown !== mutationId) return null;
  return (
    <div
      role="status"
      className="t-body flex items-center"
      style={{
        position: "fixed",
        bottom: "var(--ts-space-xl)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        gap: "var(--ts-space-lg)",
        padding: "var(--ts-space-md) var(--ts-space-lg)",
        background: "var(--ts-surface)",
        border: "thin solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
    >
      <span>{t("savedToast")}</span>
      <Button
        disabled={busy}
        onClick={() => {
          setShown(null);
          onUndo(shown);
        }}
      >
        {t("undo")}
      </Button>
    </div>
  );
}
