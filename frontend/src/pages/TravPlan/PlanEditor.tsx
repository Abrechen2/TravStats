import { useState, type FormEvent } from "react";
import Dialog from "../../components/ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import type { Field } from "./editorModel";
export interface EditorState {
  title: string;
  fields: Field[];
  value: Record<string, unknown>;
  collection?: string;
  ideaId?: string;
  review?: boolean;
}
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
  const { t } = useTranslation("travplan");
  const [value, setValue] = useState(editor.value),
    [reviewed, setReviewed] = useState(!editor.review);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reviewed && (await onSave(value))) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={editor.title}
      busy={busy}
      dirty={JSON.stringify(value) !== JSON.stringify(editor.value)}
      maxWidth={740}
    >
      <form className="tp-main" style={{ padding: 0 }} onSubmit={(e) => void submit(e)}>
        <div className="tp-form">
          {editor.fields.map((f) => (
            <label key={f.key} className={f.type === "textarea" ? "tp-wide" : undefined}>
              {t("fields." + f.key)}
              {f.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={value[f.key] === true}
                  onChange={(e) => setValue({ ...value, [f.key]: e.target.checked })}
                />
              ) : f.options ? (
                <select
                  value={String(value[f.key] ?? "")}
                  onChange={(e) => setValue({ ...value, [f.key]: e.target.value })}
                >
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {t("options." + o, { defaultValue: o })}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={String(value[f.key] ?? "")}
                  onChange={(e) => setValue({ ...value, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  type={f.type || "text"}
                  required={f.required}
                  maxLength={f.max || 200}
                  min={
                    f.type === "number" && !["latitude", "longitude"].includes(f.key)
                      ? 0
                      : undefined
                  }
                  step={f.type === "number" ? "any" : undefined}
                  value={String(value[f.key] ?? "")}
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
              )}
            </label>
          ))}
        </div>
        {editor.review && (
          <label className="tp-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {t("review.confirm")}
          </label>
        )}
        <div className="tp-actions">
          <button type="submit" className="tp-primary" disabled={busy || !reviewed}>
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
