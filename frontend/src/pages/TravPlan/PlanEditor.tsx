import { useId, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input, Select, TextArea } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { Field as FieldSpec } from "./editorModel";
import { PlanActions } from "./planLayout";
import { PlanCheck } from "./PlanParts";

export interface EditorState {
  title: string;
  fields: FieldSpec[];
  value: Record<string, unknown>;
  collection?: string;
  ideaId?: string;
  review?: boolean;
}

const DIALOG_WIDTH = 740;
const DEFAULT_MAX_CHARS = 200;
const TEXTAREA_MAX_CHARS = 1000;
const HOTEL_ONLY = ["country", "city", "address"];
const JOURNEY_ONLY = ["originPlace", "arrivalDay", "arrivalTime", "arrivalTimezone"];
const JOURNEY_KINDS = ["flight", "rail", "bus", "ferry"];
const SIGNED_NUMBERS = ["latitude", "longitude"];

export default function PlanEditor({
  editor,
  busy,
  onClose,
  onSave,
}: {
  editor: EditorState;
  busy: boolean;
  onClose: () => void;
  onSave: (value: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t } = useTranslation("travplan"),
    uid = useId();
  const [value, setValue] = useState(editor.value),
    [reviewed, setReviewed] = useState(!editor.review);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reviewed && (await onSave(value))) onClose();
  }
  const visible = editor.fields.filter((f) => {
    if (editor.collection !== "bookings") return true;
    if (HOTEL_ONLY.includes(f.key)) return value.kind === "hotel";
    if (JOURNEY_ONLY.includes(f.key)) return JOURNEY_KINDS.includes(String(value.kind));
    return true;
  });
  function control(f: FieldSpec, id: string) {
    const text = String(value[f.key] ?? "");
    if (f.options)
      return (
        <Select
          id={id}
          aria-label={t("fields." + f.key)}
          value={text}
          onChange={(e) => setValue({ ...value, [f.key]: e.target.value })}
        >
          {f.options.map((o) => (
            <option key={o} value={o}>
              {t("options." + o, { defaultValue: o })}
            </option>
          ))}
        </Select>
      );
    if (f.type === "textarea")
      return (
        <TextArea
          id={id}
          rows={4}
          maxLength={TEXTAREA_MAX_CHARS}
          value={text}
          onChange={(e) => setValue({ ...value, [f.key]: e.target.value })}
        />
      );
    return (
      <Input
        id={id}
        type={f.type || "text"}
        required={f.required}
        maxLength={f.max || DEFAULT_MAX_CHARS}
        min={f.type === "number" && !SIGNED_NUMBERS.includes(f.key) ? 0 : undefined}
        step={f.type === "number" ? "any" : undefined}
        value={text}
        onChange={(e) =>
          setValue({
            ...value,
            [f.key]:
              e.target.value === "" && f.nullable
                ? null
                : f.type === "number"
                  ? Number(e.target.value)
                  : e.target.value,
          })
        }
      />
    );
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={editor.title}
      busy={busy}
      dirty={JSON.stringify(value) !== JSON.stringify(editor.value)}
      maxWidth={DIALOG_WIDTH}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "var(--ts-space-lg)" }}>
          {visible.map((f) =>
            f.type === "checkbox" ? (
              <PlanCheck
                key={f.key}
                checked={value[f.key] === true}
                onChange={(checked) => setValue({ ...value, [f.key]: checked })}
              >
                {t("fields." + f.key)}
              </PlanCheck>
            ) : (
              <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
                <Field label={t("fields." + f.key)} htmlFor={uid + f.key}>
                  {control(f, uid + f.key)}
                </Field>
              </div>
            )
          )}
        </div>
        {editor.review && value.priceGroupId ? <p className="t-body">{t("groupPrice")}</p> : null}
        {editor.review && (
          <PlanCheck checked={reviewed} onChange={setReviewed}>
            {t("review.confirm")}
          </PlanCheck>
        )}
        <PlanActions>
          <Button type="submit" variant="primary" disabled={busy || !reviewed}>
            {busy ? t("saving") : t("save")}
          </Button>
        </PlanActions>
      </form>
    </Dialog>
  );
}
