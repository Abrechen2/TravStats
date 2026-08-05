import { useTranslation } from "../../../hooks/useTranslation";

interface StatusFieldProps {
  /** flown | scheduled | historical | cancelled | duplicated — the create
   *  path never passes "duplicated" (only lib/flightDuplicate.ts assigns
   *  it, bypassing the form), the edit modal can. */
  status: string;
  /** Fires with "cancelled" or "scheduled" only — status is otherwise
   *  derived server-side (#status-from-dates); this field must never grow
   *  back into a picker, that would undo a deliberate 2.5.0 decision. */
  onStatusChange: (status: "cancelled" | "scheduled") => void;
  labelClassName?: string;
}

function pillStyle(status: string): React.CSSProperties {
  if (status === "flown") {
    return { background: "rgba(63,185,80,0.15)", color: "var(--success)" };
  }
  if (status === "scheduled") {
    return { background: "rgba(56,139,253,0.15)", color: "#388bfd" };
  }
  if (status === "historical" || status === "duplicated") {
    // Archival data, not an error state — amber matches the cruise pill
    // palette (cruiseStatusStyle.ts) instead of red.
    return { background: "rgba(251,191,36,0.15)", color: "#fbbf24" };
  }
  return { background: "rgba(248,81,73,0.15)", color: "var(--danger)" };
}

/** The derived read-only status pill plus the single Cancelled checkbox,
 *  shared between the create and edit flight forms. */
export default function StatusField({
  status,
  onStatusChange,
  labelClassName = "",
}: StatusFieldProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  return (
    <div>
      <label className={`label ${labelClassName}`.trim()}>{t("flights:form.status")}</label>
      <div>
        <span
          className="px-2 py-1 text-xs font-semibold rounded-full inline-block"
          style={pillStyle(status)}
        >
          {t(`flights:status.${status}`, { defaultValue: status })}
        </span>
      </div>
      <label className="flex items-center gap-2 text-sm mt-2">
        <input
          type="checkbox"
          checked={status === "cancelled"}
          onChange={(e) => onStatusChange(e.target.checked ? "cancelled" : "scheduled")}
        />
        {t("flights:status.cancelledCheckbox")}
      </label>
    </div>
  );
}
