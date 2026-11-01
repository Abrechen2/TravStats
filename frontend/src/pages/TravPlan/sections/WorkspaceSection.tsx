import { useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card, Chip, Field, Input, Pill, token } from "../../../components/ui";
import type { PlanItem } from "../../../lib/api/travplan";
import { PlanActions, PlanCardHead, PlanGrid, PlanGrow, PlanRow } from "../planLayout";
import { editors, newEntry } from "../editorModel";
import type { PlanCtx } from "../planContext";
import { assignIdeaToDay, IDEA_DRAG_TYPE } from "../ideaAssignment";

const isActive = (i: PlanItem) => i.execution !== "cancelled" && i.execution !== "skipped";

function ItemRow({ ctx, item }: { ctx: PlanCtx; item: PlanItem }) {
  const { t } = useTranslation("travplan"),
    { state, busy, edit, mutate } = ctx;
  return (
    <PlanRow>
      <span className="t-meta-mono" style={{ minWidth: "var(--ts-space-xxl)" }}>
        {item.time || "—"}
      </span>
      <PlanGrow>
        <h3 className="t-card-title">{item.title}</h3>
        <Pill color={token("info")}>
          {t(item.execution === "confirmed" ? "confirmed" : item.booked ? "fixed" : "flexible")}
        </Pill>
        <p className="t-caption">
          {item.note} {item.timezone || ""}
        </p>
        <PlanActions>
          {item.booked ? (
            <Button
              onClick={() => {
                const booking = state.bookings.find((b) => b.id === item.bookingId);
                if (booking) edit("bookings", booking, { review: true });
              }}
            >
              {t("sections.import")}
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={() => edit("items", item)}>
                {t("edit")}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void mutate({ type: "remove", collection: "items", id: item.id })}
              >
                {t("delete")}
              </Button>
            </>
          )}
        </PlanActions>
      </PlanGrow>
    </PlanRow>
  );
}

export function WorkspaceSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { state, busy, day, setDay, days, edit, mutate, query, setQuery } = ctx;
  const dayItems = state.items.filter((i) => i.day === day && isActive(i));
  const [over, setOver] = useState<string | null>(null);
  /** Drop and tap both end here: one path, so the touch fallback cannot drift from the drag. */
  const assign = (ideaId: string, target: string) => {
    const operation = assignIdeaToDay(state, ideaId, target);
    if (operation) void mutate(operation);
  };
  return (
    <>
      <div
        className="flex overflow-x-auto"
        style={{ gap: "var(--ts-space-sm)", paddingBottom: "var(--ts-space-md)" }}
      >
        <Chip active={day === null} onClick={() => setDay(null)}>
          —
        </Chip>
        {days.map((d) => (
          <span
            key={d}
            data-testid={"day-drop-" + d}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(IDEA_DRAG_TYPE)) return;
              e.preventDefault();
              setOver(d);
            }}
            onDragLeave={() => setOver((o) => (o === d ? null : o))}
            onDrop={(e) => {
              const ideaId = e.dataTransfer.getData(IDEA_DRAG_TYPE);
              setOver(null);
              if (!ideaId || busy) return;
              e.preventDefault();
              assign(ideaId, d);
            }}
            style={
              over === d
                ? {
                    outline: "var(--ts-space-sm) solid var(--ts-accent)",
                    borderRadius: "var(--ts-radius-chip)",
                  }
                : undefined
            }
          >
            <Chip active={day === d} onClick={() => setDay(d)}>
              {d}
              {state.freeDays.includes(d) ? " · " + t("options.free") : ""}
            </Chip>
          </span>
        ))}
      </div>
      <PlanGrid>
        <Card>
          <PlanCardHead
            title={day || t("review.unknown")}
            action={<Button onClick={() => edit("items")}>{t("newItem")}</Button>}
          />
          {day && (
            <Button
              disabled={busy}
              onClick={() =>
                void mutate({
                  type: "settings",
                  values: {
                    freeDays: state.freeDays.includes(day)
                      ? state.freeDays.filter((d) => d !== day)
                      : [...state.freeDays, day],
                  },
                })
              }
            >
              {t(state.freeDays.includes(day) ? "openDay" : "freeDay")}
            </Button>
          )}
          {[...dayItems]
            .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
            .map((item) => (
              <ItemRow key={item.id} ctx={ctx} item={item} />
            ))}
          {dayItems.length === 0 && <p className="t-body">{t("empty")}</p>}
        </Card>
        <Card>
          <PlanCardHead
            title={t("newIdea")}
            action={<Button onClick={() => edit("ideas")}>{t("add")}</Button>}
          />
          <Field label={t("ideaSearch")} htmlFor="travplan-idea-search">
            <Input
              id="travplan-idea-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          {state.ideas
            .filter((i) => (i.title + " " + i.note).toLowerCase().includes(query.toLowerCase()))
            .map((idea) => (
              <PlanRow key={idea.id}>
                <div
                  className="min-w-0 flex-1"
                  draggable={!busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(IDEA_DRAG_TYPE, idea.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <PlanGrow>
                    <h3 className="t-card-title">{idea.title}</h3>
                    <p className="t-caption">
                      {t("options." + idea.priority)} · {idea.category}
                    </p>
                    <p className="t-body">{idea.note}</p>
                    <PlanActions>
                      {day && (
                        <Button disabled={busy} onClick={() => assign(idea.id, day)}>
                          {t("assignToDay", { day })}
                        </Button>
                      )}
                      <Button
                        onClick={() =>
                          edit("items", newEntry("items", state.timezone, state.currency, day), {
                            ideaId: idea.id,
                            title: t("assign"),
                            fields: editors.items.filter((f) =>
                              ["day", "time", "duration"].includes(f.key)
                            ),
                          })
                        }
                      >
                        {t("assign")}
                      </Button>
                      <Button onClick={() => edit("ideas", idea)}>{t("edit")}</Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void mutate({ type: "remove", collection: "ideas", id: idea.id })
                        }
                      >
                        {t("delete")}
                      </Button>
                    </PlanActions>
                  </PlanGrow>
                </div>
              </PlanRow>
            ))}
        </Card>
      </PlanGrid>
    </>
  );
}
