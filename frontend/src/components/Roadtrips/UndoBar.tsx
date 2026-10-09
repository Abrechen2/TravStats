import type { JSX } from "react";

import Button from "../ui/Button";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The editor's one-step undo (removal, reorder, shift): what was done, and the
 * button that takes it back. `restores` says what the undo brings back, so
 * "Rückgängig" is never a guess about its own reach.
 */
export default function UndoBar({
  label,
  restores,
  onUndo,
}: {
  label: string;
  restores?: string;
  onUndo: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  return (
    <div
      role="status"
      className="fixed flex flex-wrap items-center"
      style={{
        left: "50%",
        bottom: 28,
        transform: "translateX(-50%)",
        zIndex: 60,
        gap: 14,
        maxWidth: "min(560px, calc(100vw - 32px))",
        padding: "12px 16px",
        borderRadius: 14,
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border-input)",
        boxShadow: "var(--ts-shadow-dialog)",
        fontSize: 14,
      }}
    >
      <span className="flex min-w-0 flex-col" style={{ gap: 2 }}>
        <span>{label}</span>
        {restores && <span className="t-caption">{restores}</span>}
      </span>
      <Button variant="secondary" icon={<Icon name="undo-2" size={16} />} onClick={onUndo}>
        {t("roadtrips:editor.undo")}
      </Button>
    </div>
  );
}
