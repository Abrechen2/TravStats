import { useId, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input, Select, TextArea } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanStage } from "../../../lib/api/travplan";
import { PlanActions } from "../planLayout";
import { PlanCheck } from "../PlanParts";

const MODES: PlanStage["mode"][] = ["drive", "ferry", "rail", "flight", "other"];
const num = (text: string) => (text.trim() === "" ? null : Math.max(0, Number(text)));

/** Edit a stage by hand. Figures typed here are the user's own word (`metricsSource: "user"`). */
export function StageEditor({
  stage,
  title,
  busy,
  onSave,
  onClose,
}: {
  stage: PlanStage;
  title: string;
  busy: boolean;
  onSave: (stage: PlanStage) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation("travplan"),
    uid = useId(),
    [value, setValue] = useState(stage);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const figuresChanged =
      value.distanceKm !== stage.distanceKm || value.durationMinutes !== stage.durationMinutes;
    const next: PlanStage = figuresChanged
      ? { ...value, metricsSource: "user", fallbackReason: null }
      : value;
    if (await onSave(next)) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={title}
      dirty={JSON.stringify(value) !== JSON.stringify(stage)}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col"
        style={{ gap: "var(--ts-space-lg)" }}
      >
        <Field label={t("route.stage.mode")} htmlFor={uid + "-mode"}>
          <Select
            id={uid + "-mode"}
            value={value.mode}
            onChange={(e) => setValue({ ...value, mode: e.target.value as PlanStage["mode"] })}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t("route.mode." + m)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "var(--ts-space-lg)" }}>
          <Field
            label={t("route.stage.departDay")}
            htmlFor={uid + "-day"}
            hint={t("route.stage.departHint")}
          >
            <Input
              id={uid + "-day"}
              type="date"
              value={value.departDay ?? ""}
              onChange={(e) => setValue({ ...value, departDay: e.target.value || null })}
            />
          </Field>
          <Field label={t("route.stage.departTime")} htmlFor={uid + "-time"}>
            <Input
              id={uid + "-time"}
              type="time"
              value={value.departTime ?? ""}
              onChange={(e) => setValue({ ...value, departTime: e.target.value || null })}
            />
          </Field>
          <Field label={t("route.stage.distance")} htmlFor={uid + "-km"}>
            <Input
              id={uid + "-km"}
              type="number"
              min={0}
              value={value.distanceKm ?? ""}
              onChange={(e) => setValue({ ...value, distanceKm: num(e.target.value) })}
            />
          </Field>
          <Field label={t("route.stage.duration")} htmlFor={uid + "-min"}>
            <Input
              id={uid + "-min"}
              type="number"
              min={0}
              value={value.durationMinutes ?? ""}
              onChange={(e) =>
                setValue({
                  ...value,
                  durationMinutes:
                    num(e.target.value) === null ? null : Math.round(num(e.target.value)!),
                })
              }
            />
          </Field>
        </div>
        {value.mode === "ferry" && (
          <PlanCheck
            checked={value.overnight}
            onChange={(overnight) => setValue({ ...value, overnight })}
          >
            {t("route.stage.overnight")}
          </PlanCheck>
        )}
        <Field label={t("fields.note")} htmlFor={uid + "-note"}>
          <TextArea
            id={uid + "-note"}
            value={value.note}
            maxLength={1000}
            onChange={(e) => setValue({ ...value, note: e.target.value })}
          />
        </Field>
        <PlanActions>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
          <Button onClick={onClose}>{t("cancel")}</Button>
        </PlanActions>
      </form>
    </Dialog>
  );
}
