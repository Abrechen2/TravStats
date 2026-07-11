import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseCsv } from "../../lib/csvParser";
import { parseGenericCsv, type GenericMapping } from "../../lib/importers/genericCsv";
import { postImportPreview, type PreviewResponse } from "../../lib/api/import";
import { ColumnMappingWizard, type MappingFieldSpec } from "./ColumnMappingWizard";
import { PreviewModal } from "./PreviewModal";
import { commitPreviewRows } from "./commitPreview";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";

type FlightField = keyof GenericMapping;

/** The flight field spec — identical aliases and required/optional split as before. */
function useFlightMappingFields(): MappingFieldSpec<FlightField>[] {
  const { t } = useTranslation("settings");
  return useMemo(
    () => [
      {
        key: "date",
        required: true,
        aliases: ["date", "flightdate", "datum", "depdate", "departuredate"],
        label: t("settings:import.preview.wizard.fields.date"),
      },
      {
        key: "fromIata",
        required: true,
        aliases: [
          "fromiata",
          "from",
          "origin",
          "originiata",
          "departure",
          "dep",
          "depiata",
          "departureiata",
          "von",
        ],
        label: t("settings:import.preview.wizard.fields.fromIata"),
      },
      {
        key: "toIata",
        required: true,
        aliases: [
          "toiata",
          "to",
          "destination",
          "destinationiata",
          "arrival",
          "arr",
          "arriata",
          "arrivaliata",
          "dest",
          "nach",
        ],
        label: t("settings:import.preview.wizard.fields.toIata"),
      },
      {
        key: "depTimeLocal",
        aliases: ["deptimelocal", "deptime", "departuretime", "dptlocal", "dpt", "abflugzeit"],
        label: t("settings:import.preview.wizard.fields.depTimeLocal"),
      },
      {
        key: "arrTimeLocal",
        aliases: ["arrtimelocal", "arrtime", "arrivaltime", "arrlocal", "ankunftszeit"],
        label: t("settings:import.preview.wizard.fields.arrTimeLocal"),
      },
      {
        key: "flightNumber",
        aliases: ["flightnumber", "flightno", "flight", "flightid", "flugnummer"],
        label: t("settings:import.preview.wizard.fields.flightNumber"),
      },
      {
        key: "airline",
        aliases: ["airline", "carrier", "fluggesellschaft"],
        label: t("settings:import.preview.wizard.fields.airline"),
      },
      {
        key: "aircraft",
        aliases: ["aircraft", "ac", "plane", "type", "flugzeug", "flugzeugtyp"],
        label: t("settings:import.preview.wizard.fields.aircraft"),
      },
      {
        key: "registration",
        aliases: ["registration", "reg", "tail", "tailnumber", "kennzeichen"],
        label: t("settings:import.preview.wizard.fields.registration"),
      },
      {
        key: "seatNumber",
        aliases: ["seatnumber", "seat", "seatno", "sitzplatz", "sitzplatznummer"],
        label: t("settings:import.preview.wizard.fields.seatNumber"),
      },
      {
        key: "notes",
        aliases: ["notes", "note", "remarks", "remark", "comment", "comments", "notiz", "notizen"],
        label: t("settings:import.preview.wizard.fields.notes"),
      },
    ],
    [t]
  );
}

export function GenericCsvImportTile(): JSX.Element {
  const { t } = useTranslation();
  const flightFields = useFlightMappingFields();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSamples, setCsvSamples] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const records = parseCsv(text);
      if (records.length === 0) {
        setError("Empty CSV.");
        return;
      }
      setCsvText(text);
      setCsvHeaders(Object.keys(records[0]));
      setCsvSamples(records[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleMappingSubmit = useCallback(
    async (mapping: GenericMapping): Promise<void> => {
      if (!csvText) return;
      const parsed = parseGenericCsv(csvText, mapping);
      if (parsed.parserErrors.length > 0) {
        const total = parsed.parserErrors.length;
        const lines = parsed.parserErrors
          .slice(0, 5)
          .map((e) => `${e.field ?? "spec"} (row ${e.rowIndex}): ${e.message}`);
        if (total > 5) lines.push(`… and ${total - 5} more`);
        setError(lines.join("\n"));
        return;
      }
      try {
        const result = await postImportPreview(parsed.rows);
        setPreview(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [csvText]
  );

  return (
    <ImportTileShell
      title={t("settings:import.tile.genericCsv.title")}
      description={t("settings:import.tile.genericCsv.description")}
      picker={
        <ImportFilePicker
          label={t("settings:import.tile.genericCsv.uploadLabel")}
          accept=".csv"
          onFile={(file) => void handleFile(file)}
        />
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {csvText && !preview && (
        <ColumnMappingWizard
          fields={flightFields}
          csvHeaders={csvHeaders}
          csvSamples={csvSamples}
          onSubmit={(mapping) => void handleMappingSubmit(mapping as GenericMapping)}
          onCancel={() => {
            setCsvText(null);
            setCsvHeaders([]);
            setCsvSamples({});
          }}
        />
      )}
      {preview && (
        <PreviewModal
          rows={preview.rows}
          summary={preview.summary}
          flightsListHref="/flights"
          onCommit={async (rows) => {
            const result = await commitPreviewRows(rows, "imported_generic_csv");
            if (result.failures.length > 0) {
              setError(
                `Imported ${result.committed} of ${rows.length}. ${result.failures.length} chunk(s) failed: ${result.failures.map((f) => `chunk ${f.chunkIndex}: ${f.error}`).join("; ")}`
              );
            }
            return {
              committed: result.committed,
              failedChunks: result.failures.length,
            };
          }}
          onClose={() => {
            setPreview(null);
            setCsvText(null);
            setCsvSamples({});
          }}
        />
      )}
    </ImportTileShell>
  );
}
