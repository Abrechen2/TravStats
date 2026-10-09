import type { JSX } from "react";
import { ClockChangeNotice } from "../common/ClockChangeNotice";
import { FieldError, RequiredMark, fieldErrorProps } from "../form";
import { useTranslation } from "../../hooks/useTranslation";
import type { Fold } from "../../lib/api/timeInput";
import { CHECK_ROW } from "./busFormFields";
import { busFieldId, dayPart } from "./busFormModel";

// Native date/time pickers render their mask unreadably dark on our surface
// without it — the same note the rail and cruise forms carry.
const DARK_PICKER_STYLE = { colorScheme: "dark" } as const;

interface Props {
  /** Which end: names the input's id (`bus-departureLocal`), the target of a refusal and a missing step. */
  field: "departureLocal" | "arrivalLocal";
  /** The field's label, also the input's accessible name. */
  label: string;
  /** The ride cannot be saved without it (forgejo#245): the shared mark and `aria-required`. */
  required?: boolean;
  inputClassName: string;
  testId: string;
  /** `YYYY-MM-DDTHH:mm`, or a bare day while `dayOnly`. */
  value: string;
  dayOnly: boolean;
  /** The place's zone when the form can know it; without it the clock-change notice stays silent. */
  zone: string | null;
  fold: Fold | null;
  /** A refusal naming this end, shown at the field and tied to it (forgejo#246); null when none. */
  error: string | null;
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
  field,
  label,
  required = false,
  inputClassName,
  testId,
  value,
  dayOnly,
  zone,
  fold,
  error,
  onChange,
  onDayOnlyChange,
  onFoldChange,
}: Props): JSX.Element {
  const { t } = useTranslation(["bus"]);
  const id = busFieldId(field);
  return (
    <div data-testid={testId}>
      {/* The error sits OUTSIDE the label, or it would become part of the field's name. */}
      <label className="block text-sm">
        {label}
        {required && (
          <>
            {" "}
            <RequiredMark />
          </>
        )}
        <input
          id={id}
          type={dayOnly ? "date" : "datetime-local"}
          className={`mt-1 ${inputClassName}`}
          style={DARK_PICKER_STYLE}
          {...(required ? { "aria-required": true } : {})}
          value={dayOnly ? dayPart(value) : value}
          onChange={(e): void => onChange(e.target.value)}
          {...fieldErrorProps(id, error)}
        />
      </label>
      <FieldError id={id} error={error} />
      {/* A day has no clock to be repeated. */}
      <ClockChangeNotice
        local={dayOnly ? "" : value}
        zone={zone}
        fold={fold ?? undefined}
        onFoldChange={(next): void => onFoldChange(next ?? null)}
      />
      <label className={`mt-2 ${CHECK_ROW}`}>
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
