import { appLocale } from "../../lib/units";
import { useTranslation } from "../../hooks/useTranslation";
import type { PlanOperation, PlanState, PlanBudget, PlanTask } from "../../lib/api/travplan";
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
    <div className="tp-card">
      <div className="tp-head">
        <h2>{t("tasks")}</h2>
        <button onClick={() => edit()}>{t("add")}</button>
      </div>
      {state.tasks.map((task) => (
        <div className="tp-row" key={task.id}>
          <label className="tp-check tp-grow">
            <input
              type="checkbox"
              checked={task.done}
              disabled={busy}
              onChange={(e) =>
                void mutate({
                  type: "upsert",
                  collection: "tasks",
                  value: { ...task, done: e.target.checked },
                })
              }
            />
            <span>
              {task.title}
              <small className="tp-muted"> · {task.due}</small>
            </span>
          </label>
          <button onClick={() => edit(task)}>{t("edit")}</button>
          <button
            disabled={busy}
            onClick={() => void mutate({ type: "remove", collection: "tasks", id: task.id })}
          >
            {t("delete")}
          </button>
        </div>
      ))}
    </div>
  );
}
export function PlanMetrics({ budget }: { budget: PlanBudget }) {
  const { t } = useTranslation("travplan");
  const money = (n: number) =>
    n.toLocaleString(appLocale(), { style: "currency", currency: budget.currency });
  return (
    <div className="tp-metrics">
      {[
        [t(budget.unknown || budget.otherCurrencies.length ? "knownTotal" : "total"), budget.total],
        [t("booked"), budget.booked],
        [t("due"), budget.due],
      ].map(([label, value]) => (
        <div className="tp-card tp-metric" key={String(label)}>
          <span className="tp-muted">{label}</span>
          <strong>{value === null ? t("unknownValue") : money(Number(value))}</strong>
        </div>
      ))}
    </div>
  );
}
