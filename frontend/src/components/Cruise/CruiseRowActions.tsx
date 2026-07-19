import type { JSX, MouseEvent } from "react";
import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

export interface CruiseRowActionsProps {
  cruise: Cruise;
  onEdit: (c: Cruise) => void;
  onDuplicate: (c: Cruise) => void;
  onDelete: (id: string) => void;
}

// Edit / Duplicate / Delete cluster on each cruise row. Mirrors FlightRowActions.
// Every handler stops propagation so the row's onOpen navigation never fires.
export default function CruiseRowActions({
  cruise,
  onEdit,
  onDuplicate,
  onDelete,
}: CruiseRowActionsProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={stop(() => onEdit(cruise))}
        className="px-3 py-1 text-xs font-medium rounded-sm"
        style={{ background: "rgba(56,139,253,0.15)", color: "#388bfd" }}
      >
        {t("common:buttons.edit")}
      </button>
      <button
        onClick={stop(() => onDuplicate(cruise))}
        className="px-3 py-1 text-xs font-medium rounded-sm"
        style={{ background: "rgba(139,148,158,0.15)", color: "var(--text-muted)" }}
      >
        {t("cruise:list.duplicate")}
      </button>
      <button
        onClick={stop(() => onDelete(cruise.id))}
        className="px-3 py-1 text-xs font-medium rounded-sm"
        style={{ background: "rgba(248,81,73,0.15)", color: "var(--danger, #f85149)" }}
      >
        {t("common:buttons.delete")}
      </button>
    </div>
  );
}
