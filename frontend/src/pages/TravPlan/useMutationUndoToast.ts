import { useEffect, useRef } from "react";
import { toast } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * "Rückgängig" after a change made on this page, as the app's one undoable
 * toast. The change the page was opened on is not offered — only one made here
 * is — so the first id seen is remembered, not shown.
 */
export function useMutationUndoToast(
  mutationId: string | undefined,
  onUndo: (mutationId: string) => void
): void {
  const { t } = useTranslation("travplan");
  const seen = useRef(mutationId);
  const undoRef = useRef(onUndo);
  undoRef.current = onUndo;
  useEffect(() => {
    if (!mutationId || mutationId === seen.current) return;
    seen.current = mutationId;
    const id = toast.undoable({
      label: t("savedToast"),
      onUndo: () => undoRef.current(mutationId),
    });
    return () => toast.dismiss(id);
  }, [mutationId, t]);
}
