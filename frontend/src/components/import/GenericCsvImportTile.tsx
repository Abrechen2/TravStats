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

type FlightFieldSpec = Omit<MappingFieldSpec<FlightField>, "key" | "label">;

/**
 * Field metadata (required flag + header aliases) keyed by `GenericMapping`
 * field. Typed as `Record<FlightField, FlightFieldSpec>` so TypeScript
 * enforces that EVERY `GenericMapping` key has a matching entry here — the
 * compile-time guarantee the old `Record<FieldKey, string[]>` ALIASES map
 * gave for free before the domain-agnostic refactor swapped it for a plain
 * array (whose element type is `MappingFieldSpec<F>`, which does not force
 * coverage of every key of `F`). Adding a field to `GenericMapping` without
 * adding an entry here now fails the build again, instead of silently
 * leaving the new field unmappable in the wizard.
 *
 * Declaration order here IS the field order shown in the wizard (required
 * first, then this list) — `Object.keys` preserves insertion order for
 * non-numeric string keys, so no separate order list is needed.
 */
const FLIGHT_FIELD_SPECS: Record<FlightField, FlightFieldSpec> = {
  date: {
    required: true,
    aliases: ["date", "flightdate", "datum", "depdate", "departuredate"],
  },
  fromIata: {
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
  },
  toIata: {
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
  },
  depTimeLocal: {
    aliases: ["deptimelocal", "deptime", "departuretime", "dptlocal", "dpt", "abflugzeit"],
  },
  arrTimeLocal: {
    aliases: ["arrtimelocal", "arrtime", "arrivaltime", "arrlocal", "ankunftszeit"],
  },
  flightNumber: {
    aliases: ["flightnumber", "flightno", "flight", "flightid", "flugnummer"],
  },
  airline: {
    aliases: ["airline", "carrier", "fluggesellschaft"],
  },
  aircraft: {
    aliases: ["aircraft", "ac", "plane", "type", "flugzeug", "flugzeugtyp"],
  },
  registration: {
    aliases: ["registration", "reg", "tail", "tailnumber", "kennzeichen"],
  },
  seatNumber: {
    aliases: ["seatnumber", "seat", "seatno", "sitzplatz", "sitzplatznummer"],
  },
  notes: {
    aliases: ["notes", "note", "remarks", "remark", "comment", "comments", "notiz", "notizen"],
  },
};

/** The flight field spec — identical aliases, required flags and order as before. */
function useFlightMappingFields(): MappingFieldSpec<FlightField>[] {
  const { t } = useTranslation("settings");
  return useMemo(
    () =>
      (Object.keys(FLIGHT_FIELD_SPECS) as FlightField[]).map((key) => ({
        key,
        ...FLIGHT_FIELD_SPECS[key],
        label: t(`settings:import.preview.wizard.fields.${key}`),
      })),
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
          onSubmit={(mapping) => void handleMappingSubmit(mapping)}
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
