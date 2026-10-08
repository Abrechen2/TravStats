import type { JSX, ReactNode } from "react";
import { ClockChangeNotice } from "../common/ClockChangeNotice";
import { useTranslation } from "../../hooks/useTranslation";
import type { Fold } from "../../lib/api/timeInput";
import { dayPart } from "./busFormModel";

// Native date/time pickers render their mask unreadably dark on our surface
// without it — the same note the rail and cruise forms carry.
const DARK_PICKER_STYLE = { colorScheme: "dark" } as const;

interface Props {
  /** The field's label, also the input's accessible name. */
  label: string;
  inputClassName: string;
  testId: string;
  /** `YYYY-MM-DDTHH:mm`, or a bare day while `dayOnly`. */
  value: string;
  dayOnly: boolean;
  /** The place's zone when the form can know it; without it the clock-change notice stays silent. */
  zone: string | null;
  fold: Fold | null;
  /** Props that mark the input invalid beside a refusal, and the refusal itself. */
  invalid: Record<string, unknown>;
  errorMessage: ReactNode;
  onChange: (value: string) => void;
  onDayOnlyChange: (dayOnly: boolean) => void;
  onFoldChange: (fold: Fold | null) => void;
}

/**
 * One end's time: the input, its own "only the date is known" box and, where
 * the typed clock is the repeated autumn hour, the choice of occurrence. Both
 * ends use it, because their precision and fold are independent (forgejo#214,
 * forgejo#215).
 */
export function BusTimeField({
  label,
  inputClassName,
  testId,
  value,
  dayOnly,
  zone,
  fold,
  invalid,
  errorMessage,
  onChange,
  onDayOnlyChange,
  onFoldChange,
}: Props): JSX.Element {
  const { t } = useTranslation(["bus"]);
  return (
    <div data-testid={testId}>
      <label className="block text-sm">
        {label}
        <input
          type={dayOnly ? "date" : "datetime-local"}
          className={`mt-1 ${inputClassName}`}
          style={DARK_PICKER_STYLE}
          value={dayOnly ? dayPart(value) : value}
          onChange={(e): void => onChange(e.target.value)}
          {...invalid}
        />
      </label>
      {errorMessage}
      {/* A day has no clock to be repeated. */}
      <ClockChangeNotice
        local={dayOnly ? "" : value}
        zone={zone}
        fold={fold ?? undefined}
        onFoldChange={(next): void => onFoldChange(next ?? null)}
      />
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          // Two boxes read the same on screen; the name carries which end it is.
          aria-label={`${label}: ${t("bus:form.dayOnly")}`}
          checked={dayOnly}
          onChange={(e): void => onDayOnlyChange(e.target.checked)}
        />
        {t("bus:form.dayOnly")}
      </label>
    </div>
  );
}
