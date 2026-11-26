import { Button, Select } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanItem, PlanOperation, PlanState } from "../../../lib/api/travplan";
import { entryRecord } from "../planContext";
import { planDay } from "../format";

/** The operation that moves an entry to another day, keeping its time and everything else. */
export function moveItem(item: PlanItem, day: string): PlanOperation {
  return { type: "upsert", collection: "items", value: entryRecord({ ...item, day }) };
}

/**
 * The operation that takes an idea's entry off its day, back among the unplanned ideas. Only an
 * entry that belongs to an idea can go back; any other entry would vanish from the day plan.
 */
export function unplanItem(state: Pick<PlanState, "ideas">, item: PlanItem): PlanOperation | null {
  if (!state.ideas.some((i) => i.itemId === item.id)) return null;
  return { type: "upsert", collection: "items", value: entryRecord({ ...item, day: null }) };
}

/**
 * One planned entry on a day, with "move to another day" and, for an idea, "back to the ideas".
 * A booked entry stays where its booking puts it.
 */
export function ItemLine({
  item,
  state,
  days,
  busy,
  onWrite,
}: {
  item: PlanItem;
  state: PlanState;
  days: string[];
  busy: boolean;
  onWrite: (op: PlanOperation) => void;
}) {
  const { t } = useTranslation("travplan"),
    fixed = item.booked || item.bookingId !== null,
    back = unplanItem(state, item);
  return (
    <li className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
      <span className="t-body min-w-0 flex-1">
        {item.time ? <span className="t-caption">{item.time} </span> : null}
        {item.title}
        {item.place ? <span className="t-caption"> · {item.place}</span> : null}
      </span>
      {!fixed && (
        <Select
          aria-label={t("days.moveItem", { title: item.title })}
          value={item.day ?? ""}
          disabled={busy}
          onChange={(e) => e.target.value !== item.day && onWrite(moveItem(item, e.target.value))}
          style={{ width: "11rem", flex: "none" }}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {planDay(d)}
            </option>
          ))}
        </Select>
      )}
      {!fixed && back && (
        <Button
          disabled={busy}
          aria-label={t("days.unplanItem", { title: item.title })}
          onClick={() => onWrite(back)}
        >
          {t("days.unplan")}
        </Button>
      )}
    </li>
  );
}
