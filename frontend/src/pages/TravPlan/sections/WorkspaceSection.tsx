import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card, Chip, Field, Input, Pill, token } from "../../../components/ui";
import type { PlanItem } from "../../../lib/api/travplan";
import { PlanActions, PlanCardHead, PlanGrid, PlanGrow, PlanRow } from "../planLayout";
import { editors, newEntry } from "../editorModel";
import type { PlanCtx } from "../planContext";

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
          <Chip key={d} active={day === d} onClick={() => setDay(d)}>
            {d}
            {state.freeDays.includes(d) ? " · " + t("options.free") : ""}
          </Chip>
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
                <PlanGrow>
                  <h3 className="t-card-title">{idea.title}</h3>
                  <p className="t-caption">
                    {t("options." + idea.priority)} · {idea.category}
                  </p>
                  <p className="t-body">{idea.note}</p>
                  <PlanActions>
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
              </PlanRow>
            ))}
        </Card>
      </PlanGrid>
    </>
  );
}
