import { useState } from "react";
import type { GenericMapping } from "../../lib/importers/genericCsv";

interface Props {
  csvHeaders: string[];
  onSubmit: (mapping: GenericMapping) => void;
  onCancel: () => void;
}

const TARGET_FIELDS: Array<{ key: keyof GenericMapping; label: string; required: boolean }> = [
  { key: "date", label: "Date (YYYY-MM-DD)", required: true },
  { key: "fromIata", label: "From IATA (3-4 letters)", required: true },
  { key: "toIata", label: "To IATA (3-4 letters)", required: true },
  { key: "depTimeLocal", label: "Departure time (HH:MM:SS)", required: false },
  { key: "arrTimeLocal", label: "Arrival time (HH:MM:SS)", required: false },
  { key: "flightNumber", label: "Flight number", required: false },
  { key: "airline", label: "Airline", required: false },
  { key: "aircraft", label: "Aircraft", required: false },
  { key: "registration", label: "Registration", required: false },
  { key: "seatNumber", label: "Seat number", required: false },
  { key: "notes", label: "Notes", required: false },
];

export function ColumnMappingWizard({ csvHeaders, onSubmit, onCancel }: Props): JSX.Element {
  const [mapping, setMapping] = useState<GenericMapping>({});

  const ok = TARGET_FIELDS.filter((f) => f.required).every((f) => mapping[f.key]);

  return (
    <div role="dialog" aria-modal="true" className="mapping-wizard">
      <h3>Map your CSV columns to TravStats fields</h3>
      <table>
        <thead>
          <tr>
            <th>TravStats field</th>
            <th>Your column</th>
          </tr>
        </thead>
        <tbody>
          {TARGET_FIELDS.map((f) => (
            <tr key={f.key}>
              <td>
                {f.label}
                {f.required && <span style={{ color: "var(--accent)" }}>*</span>}
              </td>
              <td>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping({ ...mapping, [f.key]: e.target.value || undefined })
                  }
                >
                  <option value="">— skip —</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer>
        <button onClick={onCancel}>Cancel</button>
        <button disabled={!ok} onClick={() => onSubmit(mapping)}>
          Continue
        </button>
      </footer>
    </div>
  );
}
