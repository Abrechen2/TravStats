import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { GenericMapping } from "../../lib/importers/genericCsv";

interface Props {
  csvHeaders: string[];
  onSubmit: (mapping: GenericMapping) => void;
  onCancel: () => void;
}

const TARGET_FIELDS: Array<{ key: keyof GenericMapping; required: boolean }> = [
  { key: "date", required: true },
  { key: "fromIata", required: true },
  { key: "toIata", required: true },
  { key: "depTimeLocal", required: false },
  { key: "arrTimeLocal", required: false },
  { key: "flightNumber", required: false },
  { key: "airline", required: false },
  { key: "aircraft", required: false },
  { key: "registration", required: false },
  { key: "seatNumber", required: false },
  { key: "notes", required: false },
];

export function ColumnMappingWizard({ csvHeaders, onSubmit, onCancel }: Props): JSX.Element {
  const { t } = useTranslation();
  const [mapping, setMapping] = useState<GenericMapping>({});

  const ok = TARGET_FIELDS.filter((f) => f.required).every((f) => mapping[f.key]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="mapping-wizard-title" className="mapping-wizard">
      <h3 id="mapping-wizard-title">{t("settings:import.preview.wizard.title")}</h3>
      <table>
        <thead>
          <tr>
            <th>{t("settings:import.preview.wizard.headerLabel")}</th>
            <th>{t("settings:import.preview.wizard.headerColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {TARGET_FIELDS.map((f) => (
            <tr key={f.key}>
              <td>
                {t(`settings:import.preview.wizard.fields.${f.key}`)}
                {f.required && <span style={{ color: "var(--accent)" }}>*</span>}
              </td>
              <td>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping({ ...mapping, [f.key]: e.target.value || undefined })
                  }
                >
                  <option value="">{t("settings:import.preview.wizard.skip")}</option>
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
        <button onClick={onCancel}>{t("settings:import.preview.wizard.cancel")}</button>
        <button disabled={!ok} onClick={() => onSubmit(mapping)}>
          {t("settings:import.preview.wizard.continue")}
        </button>
      </footer>
    </div>
  );
}
