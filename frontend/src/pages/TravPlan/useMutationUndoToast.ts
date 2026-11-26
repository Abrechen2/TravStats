import { useEffect, useRef } from "react";
import { toast } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * "Rückgängig" after a change made on this page, as the app's one undoable
 * toast. The change the page was opened on is not offered — only one made here
 * is — so the first id seen once the plan has LOADED is remembered, not shown.
 * (Before the load `mutationId` is undefined for every plan, which would make
 * the stored id of an old change look like a new one.)
 */
export function useMutationUndoToast(
  mutationId: string | undefined,
  loaded: boolean,
  onUndo: (mutationId: string) => void | false
): void {
  const { t } = useTranslation("travplan");
  const seen = useRef<string | undefined | null>(null);
  const undoRef = useRef(onUndo);
  undoRef.current = onUndo;
  useEffect(() => {
    if (!loaded) return;
    if (seen.current === null) {
      seen.current = mutationId;
      return;
    }
    if (!mutationId || mutationId === seen.current) return;
    seen.current = mutationId;
    const id = toast.undoable({
      label: t("savedToast"),
      onUndo: () => undoRef.current(mutationId),
    });
    return () => toast.dismiss(id);
  }, [mutationId, loaded, t]);
}
