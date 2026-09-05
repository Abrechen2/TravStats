import { useTranslation } from "../../../hooks/useTranslation";

interface HistoricalToggleFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Lets the create and edit forms mount at once without an id clash. */
  id?: string;
}

/** The "historical flight (route only)" checkbox with its hint, as the
 *  create form draws it. Rendered by the edit modal since 2.6.1 — before
 *  that a historical flight had no way out: status is a read-only pill, and
 *  the year/month/day pickers carry no clock, so a flight imported without
 *  its times could never be given them (owner: "the edit form has no way
 *  to adjust the times"). */
export default function HistoricalToggleField({
  checked,
  onChange,
  id = "historicalToggle",
}: HistoricalToggleFieldProps): JSX.Element {
  const { t } = useTranslation(["flights"]);
  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded-sm"
        />
        <span className="text-sm">{t("flights:historicalCheckbox")}</span>
      </label>
      {checked && (
        <p className="text-xs mt-1 ml-6" style={{ color: "var(--text-muted)" }}>
          {t("flights:historicalHint")}
        </p>
      )}
    </div>
  );
}
