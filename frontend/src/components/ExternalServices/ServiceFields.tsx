import { useId, useState, type JSX } from "react";
import { Field, Input, Select, Switch } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import type { ServiceField } from "../../lib/api/externalServices";
import { fieldLabel } from "./serviceText";

type Draft = string | boolean;

function initialDraft(field: ServiceField): Draft {
  if (field.kind === "switch") return field.value === true;
  return field.value === null || field.value === undefined ? "" : String(field.value);
}

/**
 * The inputs of a service's fields, and which of them the person changed.
 *
 * Only changed fields are sent: an untouched secret stays the masked value the
 * server sent (`•••• 9c2e`), and sending that back would be a write of nothing.
 * Clearing a secret on purpose sends an empty string, which the server reads as
 * "remove" (spec: secrets are write-only).
 */
export function useFieldDrafts(fields: readonly ServiceField[]): {
  drafts: Record<string, Draft>;
  setDraft: (key: string, value: Draft) => void;
  changes: Record<string, unknown>;
  reset: () => void;
} {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initialDraft(f)]))
  );
  const changes: Record<string, unknown> = {};
  for (const field of fields) {
    const draft = drafts[field.key];
    if (draft === undefined || draft === initialDraft(field)) continue;
    changes[field.key] = field.kind === "number" && draft !== "" ? Number(draft) : draft;
  }
  return {
    drafts,
    setDraft: (key, value) => setDrafts((prev) => ({ ...prev, [key]: value })),
    changes,
    reset: () => setDrafts(Object.fromEntries(fields.map((f) => [f.key, initialDraft(f)]))),
  };
}

interface ServiceFieldsProps {
  serviceId: string;
  fields: readonly ServiceField[];
  drafts: Record<string, Draft>;
  onChange: (key: string, value: Draft) => void;
  disabled?: boolean;
}

export function ServiceFields({
  serviceId,
  fields,
  drafts,
  onChange,
  disabled = false,
}: ServiceFieldsProps): JSX.Element | null {
  const { t } = useTranslation(["externalServices"]);
  const uid = useId();
  if (fields.length === 0) return null;
  return (
    <div
      className="grid"
      style={{
        gap: "var(--ts-space-lg)",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      }}
    >
      {fields.map((field) => {
        const id = `${uid}-${field.key}`;
        const label = fieldLabel(t, serviceId, field);
        const draft = drafts[field.key];
        if (field.kind === "switch") {
          return (
            <Switch
              key={field.key}
              id={id}
              label={label}
              checked={draft === true}
              disabled={disabled}
              onChange={(next) => onChange(field.key, next)}
            />
          );
        }
        const text = typeof draft === "string" ? draft : "";
        const placeholder = field.kind === "secret" ? t("externalServices:fieldNotSet") : undefined;
        return (
          <Field key={field.key} label={label} htmlFor={id}>
            {field.kind === "select" && field.options ? (
              <Select
                id={id}
                value={text}
                disabled={disabled}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                // Secrets are password inputs, never readable text; the stored
                // value shows as the server's mask and the field is cleared to remove it.
                type={
                  field.kind === "secret"
                    ? "password"
                    : field.kind === "number"
                      ? "number"
                      : field.kind === "url"
                        ? "url"
                        : "text"
                }
                autoComplete="off"
                value={text}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
