import type { ReactNode } from "react";
import { appLocale } from "../../lib/units";
import { useTranslation } from "../../hooks/useTranslation";
import { Button, Card, StatTile } from "../../components/ui";
import type { PlanOperation, PlanState, PlanBudget, PlanTask } from "../../lib/api/travplan";
import { PlanCardHead, PlanGrow, PlanRow } from "./planLayout";

/**
 * A ticked item on a list (packed, done). A checkbox, not a `Switch`: the row
 * reads as a checklist, and a column of switches would read as settings.
 */
export function PlanCheck({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      className="t-body flex items-center"
      style={{ gap: "var(--ts-space-md)", minHeight: "var(--ts-size-touch-min)" }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--ts-accent)" }}
      />
      <span>{children}</span>
    </label>
  );
}

export function PlanTasks({
  state,
  busy,
  edit,
  mutate,
}: {
  state: PlanState;
  busy: boolean;
  edit: (task?: PlanTask) => void;
  mutate: (op: PlanOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation("travplan");
  return (
    <Card>
      <PlanCardHead
        title={t("tasks")}
        action={<Button onClick={() => edit()}>{t("add")}</Button>}
      />
      {state.tasks.map((task) => (
        <PlanRow key={task.id}>
          <PlanGrow>
            <PlanCheck
              checked={task.done}
              disabled={busy}
              onChange={(done) =>
                void mutate({
                  type: "upsert",
                  collection: "tasks",
                  value: { ...task, done },
                })
              }
            >
              {task.title}
              <small className="t-caption"> · {task.due}</small>
            </PlanCheck>
          </PlanGrow>
          <Button onClick={() => edit(task)}>{t("edit")}</Button>
          <Button
            disabled={busy}
            onClick={() => void mutate({ type: "remove", collection: "tasks", id: task.id })}
          >
            {t("delete")}
          </Button>
        </PlanRow>
      ))}
    </Card>
  );
}

export function PlanMetrics({ budget }: { budget: PlanBudget }) {
  const { t } = useTranslation("travplan");
  const money = (n: number) =>
    n.toLocaleString(appLocale(), { style: "currency", currency: budget.currency });
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-3"
      style={{ gap: "var(--ts-space-lg)", margin: "var(--ts-space-xl) 0" }}
    >
      {[
        [t(budget.unknown || budget.otherCurrencies.length ? "knownTotal" : "total"), budget.total],
        [t("booked"), budget.booked],
        [t("due"), budget.due],
      ].map(([label, value]) => (
        <StatTile
          key={String(label)}
          label={label}
          value={value === null ? t("unknownValue") : money(Number(value))}
        />
      ))}
    </div>
  );
}
