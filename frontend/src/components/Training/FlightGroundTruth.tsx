import { useTranslation } from "../../hooks/useTranslation";
import type { Flight } from "./types";

/**
 * The ground-truth grid for a FLIGHT sample.
 *
 * Extracted from `EmailAnnotation.tsx` in forgejo#124 phase 6, and it is the
 * extraction that makes the phase possible: the annotation view now serves
 * four domains, and its file is frozen at its size in
 * `scripts/file-size-baseline.json` — a listed file may shrink and may never
 * grow. Sixteen inputs written out longhand is also the reason the same
 * grid could not be shown for a hotel or a sailing without a second copy of
 * itself.
 *
 * The labels WERE the ones that shipped, character for character: English,
 * in a German-first UI, under an English heading "Flight Data (Ground
 * Truth)". That was the separate change this header asked for, and it
 * happened on 2026-09-19 (beta audit, unlisted finding 2) — heading, field
 * labels and the two buttons now come from `training:annotation.groundTruth`
 * with a DE and an EN side.
 *
 * The seat classes are deliberately NOT translated: Economy, Premium
 * Economy, Business and First are what the industry prints on a German
 * boarding pass too, and a translation would be a word no document uses.
 *
 * The placeholders stay as they are — an example value (LH103, MUC) is not
 * copy in either language.
 */

interface FieldSpec {
  /**
   * The Flight field, and — the same string — the key under
   * `training:annotation.groundTruth.fields`. Renaming one without the other
   * renders the key itself as the label, which the component's test catches.
   */
  key: keyof Flight;
  kind?: "text" | "date" | "time" | "seatClass";
  placeholder?: string;
  maxLength?: number;
  /** IATA codes are stored upper-case whatever the user types. */
  upper?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  { key: "flightNumber", placeholder: "LH103" },
  { key: "airline", placeholder: "Lufthansa" },
  { key: "aircraft", placeholder: "A320, Boeing 737" },
  { key: "departureCode", placeholder: "MUC", maxLength: 3, upper: true },
  { key: "arrivalCode", placeholder: "FRA", maxLength: 3, upper: true },
  { key: "departureDate", kind: "date" },
  { key: "departureTime", kind: "time" },
  { key: "arrivalDate", kind: "date" },
  { key: "arrivalTime", kind: "time" },
  { key: "seat", placeholder: "12A" },
  { key: "seatClass", kind: "seatClass" },
  { key: "terminal", placeholder: "2" },
  { key: "gate", placeholder: "A12" },
  { key: "boardingGroup", placeholder: "1" },
  { key: "pnr", placeholder: "ABC123" },
  { key: "ticketNumber", placeholder: "2202236084346" },
];

const SEAT_CLASSES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "–" },
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium Economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

interface FlightGroundTruthProps {
  flights: Flight[];
  onChange: (index: number, field: string, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export default function FlightGroundTruth({
  flights,
  onChange,
  onAdd,
  onRemove,
}: FlightGroundTruthProps): JSX.Element {
  const { t } = useTranslation(["training"]);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-(--text-primary)">
          {t("training:annotation.groundTruth.title")}
        </h3>
        <button
          onClick={onAdd}
          className="px-3 py-1 text-sm font-medium"
          style={{ color: "var(--ts-accent)" }}
        >
          {t("training:annotation.groundTruth.addFlight")}
        </button>
      </div>
      <div className="space-y-4">
        {flights.map((flight, index) => (
          <div key={index} className="p-4 border border-border rounded-lg bg-(--bg-base)">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-(--text-primary)">
                {t("training:annotation.groundTruth.flight", { index: index + 1 })}
              </h4>
              {flights.length > 1 && (
                <button
                  onClick={() => onRemove(index)}
                  className="px-2 py-1 text-xs font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  {t("training:annotation.groundTruth.remove")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FIELDS.map((field) => (
                <div key={String(field.key)}>
                  <label className="block text-xs font-medium text-(--text-primary) mb-1">
                    {t(`training:annotation.groundTruth.fields.${String(field.key)}`)}
                  </label>
                  {field.kind === "seatClass" ? (
                    <select
                      value={flight[field.key] || ""}
                      onChange={(e) => onChange(index, String(field.key), e.target.value)}
                      className="input w-full"
                    >
                      {SEAT_CLASSES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.kind === "date" || field.kind === "time" ? field.kind : "text"}
                      value={flight[field.key] || ""}
                      onChange={(e) =>
                        onChange(
                          index,
                          String(field.key),
                          field.upper ? e.target.value.toUpperCase() : e.target.value
                        )
                      }
                      className="input w-full"
                      placeholder={field.placeholder}
                      maxLength={field.maxLength}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
