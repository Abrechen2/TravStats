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
 * The labels and placeholders are the ones that shipped, character for
 * character. Translating them is a separate change with its own DE/EN pair;
 * doing it inside an extraction would hide a copy change in a move.
 */

interface FieldSpec {
  key: keyof Flight;
  label: string;
  kind?: "text" | "date" | "time" | "seatClass";
  placeholder?: string;
  maxLength?: number;
  /** IATA codes are stored upper-case whatever the user types. */
  upper?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  { key: "flightNumber", label: "Flight Number", placeholder: "LH103" },
  { key: "airline", label: "Airline", placeholder: "Lufthansa" },
  { key: "aircraft", label: "Aircraft Type", placeholder: "A320, Boeing 737" },
  { key: "departureCode", label: "Departure Code", placeholder: "MUC", maxLength: 3, upper: true },
  { key: "arrivalCode", label: "Arrival Code", placeholder: "FRA", maxLength: 3, upper: true },
  { key: "departureDate", label: "Departure Date", kind: "date" },
  { key: "departureTime", label: "Departure Time", kind: "time" },
  { key: "arrivalDate", label: "Arrival Date", kind: "date" },
  { key: "arrivalTime", label: "Arrival Time", kind: "time" },
  { key: "seat", label: "Seat", placeholder: "12A" },
  { key: "seatClass", label: "Seat Class", kind: "seatClass" },
  { key: "terminal", label: "Terminal", placeholder: "2" },
  { key: "gate", label: "Gate", placeholder: "A12" },
  { key: "boardingGroup", label: "Boarding Group", placeholder: "1" },
  { key: "pnr", label: "PNR / Booking Reference", placeholder: "ABC123" },
  { key: "ticketNumber", label: "Ticket Number", placeholder: "2202236084346" },
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
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-(--text-primary)">Flight Data (Ground Truth)</h3>
        <button
          onClick={onAdd}
          className="px-3 py-1 text-sm font-medium"
          style={{ color: "var(--ts-accent)" }}
        >
          + Flug hinzufügen
        </button>
      </div>
      <div className="space-y-4">
        {flights.map((flight, index) => (
          <div key={index} className="p-4 border border-border rounded-lg bg-(--bg-base)">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-(--text-primary)">Flug {index + 1}</h4>
              {flights.length > 1 && (
                <button
                  onClick={() => onRemove(index)}
                  className="px-2 py-1 text-xs font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  Entfernen
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FIELDS.map((field) => (
                <div key={String(field.key)}>
                  <label className="block text-xs font-medium text-(--text-primary) mb-1">
                    {field.label}
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
