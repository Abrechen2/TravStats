import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";

export interface MappingFieldSpec<F extends string> {
  key: F;
  /** Already-translated label. The wizard does not know the caller's namespace. */
  label: string;
  required?: boolean;
  /** Header aliases, compared lower-cased with non-alphanumerics stripped. */
  aliases: string[];
}

export interface ColumnMappingWizardProps<F extends string> {
  fields: MappingFieldSpec<F>[];
  csvHeaders: string[];
  /**
   * Row 1 of the CSV keyed by header — used to render an inline sample
   * value next to each option so the user can disambiguate cryptic
   * headers without scrolling to the source file.
   */
  csvSamples: Record<string, string>;
  /** Pre-selected mapping (e.g. the LLM suggestion). Overrides the heuristic per field. */
  initialMapping?: Partial<Record<F, string>>;
  onSubmit: (mapping: Partial<Record<F, string>>) => void;
  onCancel: () => void;
  /**
   * A rejection from the LAST submit, rendered in the footer. The wizard
   * stays open when a mapping produces no importable row, so a message shown
   * only on the page behind it is invisible: the user presses "continue",
   * nothing appears to happen, and the reason sits under the modal.
   */
  submitError?: string | null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Header-name heuristic. This is the SAFETY NET the whole CSV path leans on:
 * the LLM suggestion is advisory, so if it is slow, unreachable or wrong, this
 * still gives the user a sane starting mapping (spec §3.1 / §5).
 * The first match wins; a header already taken by an earlier field in THIS
 * heuristic pass is never re-used, so the heuristic alone can never collide.
 * The MERGED result (heuristic + a suggested `initialMapping`) can still
 * collide, though: a suggestion is not deduped against a header the heuristic
 * already claimed for another field. When that happens both fields are
 * flagged red and submit is blocked (see the `collisions` check below) — a
 * UX nuisance the user resolves by hand, not silent data loss.
 */
export function autoMapHeaders<F extends string>(
  fields: MappingFieldSpec<F>[],
  headers: string[]
): Partial<Record<F, string>> {
  const used = new Set<string>();
  const mapping: Partial<Record<F, string>> = {};
  const normalized = headers.map((h) => ({ raw: h, norm: normalize(h) }));
  for (const field of fields) {
    const aliases = field.aliases.map(normalize);
    const match = normalized.find((h) => aliases.includes(h.norm) && !used.has(h.raw));
    if (match) {
      mapping[field.key] = match.raw;
      used.add(match.raw);
    }
  }
  return mapping;
}

export function ColumnMappingWizard<F extends string>({
  fields,
  csvHeaders,
  csvSamples,
  initialMapping,
  onSubmit,
  onCancel,
  submitError,
}: ColumnMappingWizardProps<F>): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);

  // Content-based signatures, not object/array identities. `fields` gets a
  // fresh array identity on every parent re-render (the caller's `t` from the
  // project's `useTranslation` wrapper is a new function identity every
  // render, and `useFlightMappingFields` memoizes on `[t]`), and a plain
  // `useMemo([fields, csvHeaders, initialMapping])` below would treat that as
  // "the CSV/suggestion changed" and wipe the user's in-progress selections
  // on any unrelated re-render (e.g. a 30s admin poll, a language switch).
  // Keying on these value-equal strings instead means the memo (and the
  // effect that consumes it) only actually reruns when the CSV headers, the
  // field spec, or the suggested mapping truly change.
  const fieldsSignature = JSON.stringify(
    fields.map((f) => [f.key, f.required ?? false, f.aliases])
  );
  const headerSignature = JSON.stringify(csvHeaders);
  const initialMappingSignature = JSON.stringify(initialMapping ?? {});

  const initial = useMemo(() => {
    const heuristic = autoMapHeaders(fields, csvHeaders);
    // The LLM's suggestion wins per field where it has one; the heuristic fills
    // every remaining gap. A suggestion naming a header that is not in the file
    // is dropped (the backend already sanitises, this is belt and braces).
    const merged: Partial<Record<F, string>> = { ...heuristic };
    for (const [key, header] of Object.entries(initialMapping ?? {}) as [F, string][]) {
      if (csvHeaders.includes(header)) merged[key] = header;
    }
    return merged;
  }, [fieldsSignature, headerSignature, initialMappingSignature]);

  const [mapping, setMapping] = useState<Partial<Record<F, string>>>(initial);
  const [autoFilled, setAutoFilled] = useState<Set<F>>(() => new Set(Object.keys(initial) as F[]));
  // Fields the user has explicitly touched (picked a header, or explicitly
  // skipped). A ref, not state: it must never trigger a re-render by itself,
  // only gate what the resync effect below is allowed to overwrite.
  const manuallySetRef = useRef<Set<F>>(new Set());
  const prevHeaderSignatureRef = useRef(headerSignature);

  useEffect(() => {
    const isNewCsv = prevHeaderSignatureRef.current !== headerSignature;
    prevHeaderSignatureRef.current = headerSignature;

    if (isNewCsv) {
      // A genuinely different CSV was loaded into this same wizard instance
      // (the user picked another file before submitting) — any selection tied
      // to the old file's headers is meaningless now, so start over.
      setMapping(initial);
      setAutoFilled(new Set(Object.keys(initial) as F[]));
      manuallySetRef.current = new Set();
      return;
    }

    // Same CSV: this only fires when the suggested mapping changed, e.g. a
    // late-arriving LLM suggestion landing after the heuristic already
    // rendered. Fill in fields the user has not touched yet; never clobber a
    // field they already picked (or explicitly skipped).
    const touched = manuallySetRef.current;
    setMapping((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(initial) as F[]) {
        if (!touched.has(key) && prev[key] !== initial[key]) {
          next[key] = initial[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setAutoFilled((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of Object.keys(initial) as F[]) {
        if (!touched.has(key) && !next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [initial, headerSignature]);

  const setField = (field: F, value: string | undefined): void => {
    setMapping((prev) => ({ ...prev, [field]: value || undefined }));
    if (!manuallySetRef.current.has(field)) {
      manuallySetRef.current = new Set(manuallySetRef.current).add(field);
    }
    setAutoFilled((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields]);
  const optionalFields = useMemo(() => fields.filter((f) => !f.required), [fields]);

  // Detect collisions: same csv header mapped to two fields
  const collisions = useMemo(() => {
    const seen = new Map<string, F[]>();
    for (const [field, header] of Object.entries(mapping) as Array<[F, string | undefined]>) {
      if (!header) continue;
      const list = seen.get(header) ?? [];
      list.push(field);
      seen.set(header, list);
    }
    const dup = new Set<F>();
    for (const list of seen.values()) {
      if (list.length > 1) list.forEach((f) => dup.add(f));
    }
    return dup;
  }, [mapping]);

  const missingRequired = requiredFields.filter((f) => !mapping[f.key]);
  const skippedOptionalCount = optionalFields.filter((f) => !mapping[f.key]).length;
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
            fields={requiredFields}
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
            fields={optionalFields}
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
            {submitError ? (
              <span data-testid="wizard-submit-error" style={{ color: "rgb(252, 165, 165)" }}>
                {submitError}
              </span>
            ) : missingRequired.length > 0 ? (
              <span style={{ color: "rgb(252, 165, 165)" }}>
                {t("settings:import.preview.wizard.missingFields", {
                  fields: missingRequired.map((f) => f.label).join(", "),
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

interface FieldSectionProps<F extends string> {
  heading: string;
  fields: MappingFieldSpec<F>[];
  mapping: Partial<Record<F, string>>;
  autoFilled: Set<F>;
  collisions: Set<F>;
  csvHeaders: string[];
  csvSamples: Record<string, string>;
  setField: (field: F, value: string | undefined) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  required?: boolean;
}

function FieldSection<F extends string>({
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
}: FieldSectionProps<F>): JSX.Element {
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
          const selected = mapping[field.key];
          const sample = selected ? csvSamples[selected] : undefined;
          const wasAutoFilled = autoFilled.has(field.key);
          const collides = collisions.has(field.key);
          return (
            <div
              key={field.key}
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
                <span>{field.label}</span>
                {required && (
                  <span
                    className="ml-1"
                    style={{ color: "rgb(248, 113, 113)" }}
                    aria-label={t("common:accessibility.required")}
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
                  onChange={(e) => setField(field.key, e.target.value || undefined)}
                  className="rounded-md px-2 py-1.5 text-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-primary)",
                    border: collides
                      ? "1px solid rgb(248, 113, 113)"
                      : "1px solid var(--color-border)",
                  }}
                  aria-label={field.label}
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
