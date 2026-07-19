import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { GenericMapping } from "../../lib/importers/genericCsv";

interface Props {
  csvHeaders: string[];
  /**
   * Row 1 of the CSV keyed by header — used to render an inline sample
   * value next to each option so the user can disambiguate cryptic
   * headers without scrolling to the source file.
   */
  csvSamples: Record<string, string>;
  onSubmit: (mapping: GenericMapping) => void;
  onCancel: () => void;
}

type FieldKey = keyof GenericMapping;

const REQUIRED_FIELDS: FieldKey[] = ["date", "fromIata", "toIata"];
const OPTIONAL_FIELDS: FieldKey[] = [
  "depTimeLocal",
  "arrTimeLocal",
  "flightNumber",
  "airline",
  "aircraft",
  "registration",
  "seatNumber",
  "notes",
];

/**
 * Aliases the CSV header may use for a given TravStats field. Compared
 * lower-cased after stripping non-alphanumeric chars so "Dep Time",
 * "dep_time", "DEP-TIME" all match. The first match wins; later fields
 * are not auto-filled with an already-used header to prevent collisions.
 */
const ALIASES: Record<FieldKey, string[]> = {
  date: ["date", "flightdate", "datum", "depdate", "departuredate"],
  fromIata: [
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
  toIata: [
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
  depTimeLocal: ["deptimelocal", "deptime", "departuretime", "dptlocal", "dpt", "abflugzeit"],
  arrTimeLocal: ["arrtimelocal", "arrtime", "arrivaltime", "arrlocal", "ankunftszeit"],
  flightNumber: ["flightnumber", "flightno", "flight", "flightid", "flugnummer"],
  airline: ["airline", "carrier", "fluggesellschaft"],
  aircraft: ["aircraft", "ac", "plane", "type", "flugzeug", "flugzeugtyp"],
  registration: ["registration", "reg", "tail", "tailnumber", "kennzeichen"],
  seatNumber: ["seatnumber", "seat", "seatno", "sitzplatz", "sitzplatznummer"],
  notes: ["notes", "note", "remarks", "remark", "comment", "comments", "notiz", "notizen"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function autoMap(headers: string[]): { mapping: GenericMapping; auto: Set<FieldKey> } {
  const used = new Set<string>();
  const mapping: GenericMapping = {};
  const auto = new Set<FieldKey>();
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalize(h) }));
  const allFields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
  for (const field of allFields) {
    const aliases = ALIASES[field].map(normalize);
    const match = normalizedHeaders.find((h) => aliases.includes(h.norm) && !used.has(h.raw));
    if (match) {
      mapping[field] = match.raw;
      used.add(match.raw);
      auto.add(field);
    }
  }
  return { mapping, auto };
}

export function ColumnMappingWizard({
  csvHeaders,
  csvSamples,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const { t } = useTranslation("settings");

  const initial = useMemo(() => autoMap(csvHeaders), [csvHeaders]);
  const [mapping, setMapping] = useState<GenericMapping>(initial.mapping);
  const [autoFilled, setAutoFilled] = useState<Set<FieldKey>>(initial.auto);

  useEffect(() => {
    setMapping(initial.mapping);
    setAutoFilled(initial.auto);
  }, [initial]);

  const setField = (field: FieldKey, value: string | undefined): void => {
    setMapping((prev) => ({ ...prev, [field]: value || undefined }));
    setAutoFilled((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  // Detect collisions: same csv header mapped to two TravStats fields
  const collisions = useMemo(() => {
    const seen = new Map<string, FieldKey[]>();
    for (const [field, header] of Object.entries(mapping) as Array<
      [FieldKey, string | undefined]
    >) {
      if (!header) continue;
      const list = seen.get(header) ?? [];
      list.push(field);
      seen.set(header, list);
    }
    const dup = new Set<FieldKey>();
    for (const list of seen.values()) {
      if (list.length > 1) list.forEach((f) => dup.add(f));
    }
    return dup;
  }, [mapping]);

  const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);
  const skippedOptionalCount = OPTIONAL_FIELDS.filter((f) => !mapping[f]).length;
  const canSubmit = missingRequired.length === 0 && collisions.size === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mapping-wizard-title"
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg shadow-xl"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <header
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h3
            id="mapping-wizard-title"
            className="text-lg font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t("settings:import.preview.wizard.title")}
          </h3>
          <button
            onClick={onCancel}
            className="text-2xl leading-none"
            style={{ color: "var(--text-muted)" }}
            aria-label={t("common:buttons.close")}
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-4">
          <FieldSection
            heading={t("settings:import.preview.wizard.requiredSection")}
            fields={REQUIRED_FIELDS}
            mapping={mapping}
            autoFilled={autoFilled}
            collisions={collisions}
            csvHeaders={csvHeaders}
            csvSamples={csvSamples}
            setField={setField}
            t={t}
            required
          />
          <FieldSection
            heading={t("settings:import.preview.wizard.optionalSection")}
            fields={OPTIONAL_FIELDS}
            mapping={mapping}
            autoFilled={autoFilled}
            collisions={collisions}
            csvHeaders={csvHeaders}
            csvSamples={csvSamples}
            setField={setField}
            t={t}
          />
        </div>

        <footer
          className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p className="text-sm" aria-live="polite">
            {missingRequired.length > 0 ? (
              <span style={{ color: "rgb(252, 165, 165)" }}>
                {t("settings:import.preview.wizard.missingFields", {
                  fields: missingRequired
                    .map((f) => t(`settings:import.preview.wizard.fields.${f}`))
                    .join(", "),
                })}
              </span>
            ) : collisions.size > 0 ? (
              <span style={{ color: "rgb(252, 165, 165)" }}>
                {t("settings:import.preview.wizard.duplicateMappingHint")}
              </span>
            ) : (
              <span style={{ color: "rgb(134, 239, 172)" }}>
                {t("settings:import.preview.wizard.allMapped")}
                {skippedOptionalCount > 0 && (
                  <>
                    {" · "}
                    {t("settings:import.preview.wizard.optionalSkipped", {
                      count: skippedOptionalCount,
                    })}
                  </>
                )}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              onClick={onCancel}
              className="btn-secondary px-3 py-1.5 text-sm"
              style={{ background: "var(--bg-elevated)" }}
            >
              {t("settings:import.preview.wizard.cancel")}
            </button>
            <button
              disabled={!canSubmit}
              onClick={() => onSubmit(mapping)}
              className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {t("settings:import.preview.wizard.continue")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

interface FieldSectionProps {
  heading: string;
  fields: FieldKey[];
  mapping: GenericMapping;
  autoFilled: Set<FieldKey>;
  collisions: Set<FieldKey>;
  csvHeaders: string[];
  csvSamples: Record<string, string>;
  setField: (field: FieldKey, value: string | undefined) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  required?: boolean;
}

function FieldSection({
  heading,
  fields,
  mapping,
  autoFilled,
  collisions,
  csvHeaders,
  csvSamples,
  setField,
  t,
  required,
}: FieldSectionProps): JSX.Element {
  return (
    <section className="mb-6 last:mb-0">
      <h4
        className="mb-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {heading}
      </h4>
      <div className="flex flex-col gap-2">
        {fields.map((field) => {
          const selected = mapping[field];
          const sample = selected ? csvSamples[selected] : undefined;
          const wasAutoFilled = autoFilled.has(field);
          const collides = collisions.has(field);
          return (
            <div
              key={field}
              className="grid grid-cols-1 gap-2 rounded-md p-2 sm:grid-cols-[180px_1fr]"
              style={{
                background: wasAutoFilled
                  ? "rgba(34, 197, 94, 0.08)"
                  : collides
                    ? "rgba(239, 68, 68, 0.08)"
                    : "transparent",
              }}
            >
              <div className="flex items-center text-sm" style={{ color: "var(--text-primary)" }}>
                <span>{t(`settings:import.preview.wizard.fields.${field}`)}</span>
                {required && (
                  <span
                    className="ml-1"
                    style={{ color: "rgb(248, 113, 113)" }}
                    aria-label="required"
                  >
                    *
                  </span>
                )}
                {wasAutoFilled && (
                  <span
                    className="ml-2 inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs"
                    style={{
                      background: "rgba(34, 197, 94, 0.18)",
                      color: "rgb(134, 239, 172)",
                    }}
                  >
                    {t("settings:import.preview.wizard.autoDetected")}
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                <select
                  value={selected ?? ""}
                  onChange={(e) => setField(field, e.target.value || undefined)}
                  className="rounded-md px-2 py-1.5 text-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-primary)",
                    border: collides
                      ? "1px solid rgb(248, 113, 113)"
                      : "1px solid var(--color-border)",
                  }}
                  aria-label={t(`settings:import.preview.wizard.fields.${field}`)}
                >
                  <option value="">{t("settings:import.preview.wizard.skip")}</option>
                  {csvHeaders.map((h) => {
                    const sampleForOption = csvSamples[h];
                    const label = sampleForOption
                      ? `${h} (${t("settings:import.preview.wizard.samplePrefix")}: ${sampleForOption})`
                      : h;
                    return (
                      <option key={h} value={h}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                {sample && (
                  <p className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("settings:import.preview.wizard.samplePrefix")}: {sample}
                  </p>
                )}
                {collides && (
                  <p className="mt-1 text-xs" style={{ color: "rgb(252, 165, 165)" }}>
                    {t("settings:import.preview.wizard.duplicateMapping")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
