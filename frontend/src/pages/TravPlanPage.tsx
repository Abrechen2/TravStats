import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "../hooks/useTranslation";
import {
  travplanApi,
  type PlanCollection,
  type PlanItem,
  type PlanState,
  type PlanBooking,
} from "../lib/api/travplan";
import { documentsApi, type TravelDocument } from "../lib/api/documents";
import { usePlan } from "./TravPlan/usePlan";
import { PlanList, PlanAdmin } from "./TravPlan/PlanList";
import PlanEditor, { type EditorState } from "./TravPlan/PlanEditor";
import { editors, newEntry, settingFields } from "./TravPlan/editorModel";
import { PlanTasks, PlanMetrics } from "./TravPlan/PlanParts";
import { BookingPlanToggle } from "./TravPlan/BookingPlanToggle";
import { PlanHandover } from "./TravPlan/PlanHandover";
import WeatherLocation from "./TravPlan/WeatherLocation";
import PlanAI from "./TravPlan/PlanAI";
import ImportPanel from "./TravPlan/ImportPanel";
import { PackingProfile } from "./TravPlan/PackingProfile";
import AppShell from "../components/ui/AppShell";
import "./TravPlan/travplan.css";
const sections = [
  "overview",
  "workspace",
  "import",
  "transfer",
  "ai",
  "packing",
  "budget",
  "handover",
];
function calendarDays(start: string | null, end: string | null) {
  if (!start || !end) return [];
  const days = [];
  for (let d = Date.parse(start); d <= Date.parse(end) && days.length < 366; d += 864e5)
    days.push(new Date(d).toISOString().slice(0, 10));
  return days;
}
const entryRecord = (row: object) => row as unknown as Record<string, unknown>;
function PlanContent({ tripId, section }: { tripId: string; section: string }) {
  const { t } = useTranslation("travplan"),
    { plan, setPlan, loading, busy, error, setError, refresh, mutate, message } = usePlan(tripId),
    [editor, setEditor] = useState<EditorState | null>(null),
    [day, setDay] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [weatherBusy, setWeatherBusy] = useState(false),
    [suggestions, setSuggestions] = useState<string[]>([]),
    [documents, setDocuments] = useState<TravelDocument[]>([]);
  const onError = useCallback((e: unknown) => setError(message(e)), [message, setError]);
  useEffect(() => {
    setEditor(null);
    setQuery("");
    setDay(null);
    setSuggestions([]);
  }, [tripId]);
  useEffect(() => {
    let live = true;
    documentsApi
      .listForEntry({ type: "trip", id: tripId })
      .then((d) => {
        if (live) setDocuments(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tripId, plan?.revision]);
  useEffect(() => {
    if (plan && day === null && plan.state.startDay) setDay(plan.state.startDay);
  }, [plan?.state.startDay]);
  if (loading && !plan) return <div className="tp-loading">{t("loading")}</div>;
  if (!plan)
    return (
      <>
        <div className="tp-error" role="alert">
          {error}
        </div>
        <button
          onClick={() =>
            void travplanApi
              .create(t("newTrip"), {}, tripId)
              .then((p) => {
                setPlan(p);
                setError("");
              })
              .catch(onError)
          }
        >
          {t("connect")}
        </button>
        <button onClick={() => void refresh()}>{t("refresh")}</button>
      </>
    );
  const state = plan.state,
    days = calendarDays(state.startDay, state.endDay),
    prefix = "/plan/" + tripId;
  const money = (n: number | null) =>
    n === null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: state.currency });
  function edit(key: PlanCollection, row?: object, extras?: Partial<EditorState>) {
    setEditor({
      title: t("edit"),
      collection: key,
      fields: editors[key],
      value: row ? entryRecord(row) : newEntry(key, state.timezone, state.currency, day),
      ...extras,
    });
  }
  function editSettings() {
    setEditor({
      title: t("editTrip"),
      fields: settingFields,
      value: { name: plan!.name, ...state },
    });
  }
  async function save(value: Record<string, unknown>) {
    if (!editor) return false;
    if (editor.ideaId)
      return mutate({
        type: "assign_idea",
        ideaId: editor.ideaId,
        day: value.day as string | null,
        time: value.time as string | null,
        duration: value.duration as number | null,
      });
    if (editor.collection) {
      if (editor.collection === "packing") value = { ...value, manual: true };
      if (editor.collection === "costs" && value.kind === "estimate") value = { ...value, paid: 0 };
      return mutate({ type: "upsert", collection: editor.collection as PlanCollection, value });
    }
    const { name, ...settings } = value;
    const values = Object.fromEntries(
      settingFields.filter((f) => f.key !== "name").map((f) => [f.key, settings[f.key]])
    );
    return mutate({ type: "settings", name: String(name), values: values as Partial<PlanState> });
  }
  function itemRow(item: PlanItem) {
    return (
      <div className="tp-row" key={item.id}>
        <span className="tp-time">{item.time || "—"}</span>
        <div className="tp-grow">
          <h3>{item.title}</h3>
          <span className="tp-badge">
            {t(item.execution === "confirmed" ? "confirmed" : item.booked ? "fixed" : "flexible")}
          </span>
          <p className="tp-muted">
            {item.note} {item.timezone || ""}
          </p>
          <div className="tp-actions">
            {item.booked ? (
              <button
                onClick={() => {
                  const booking = state.bookings.find((b) => b.id === item.bookingId);
                  if (booking) edit("bookings", booking, { review: true });
                }}
              >
                {t("sections.import")}
              </button>
            ) : (
              <>
                <button disabled={busy} onClick={() => edit("items", item)}>
                  {t("edit")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void mutate({ type: "remove", collection: "items", id: item.id })}
                >
                  {t("delete")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  function findingCards(all = false) {
    return plan!.findings.slice(0, all ? 500 : 3).map((f) => (
      <div className="tp-card" key={f.id}>
        <h3>{t("findings." + f.code, f.params)}</h3>
        <div className="tp-actions">
          <Link className="tp-button" to={prefix + "/" + f.section}>
            {t("edit")}
          </Link>
          <button
            disabled={busy}
            onClick={() =>
              void mutate({
                type: "decision",
                value: {
                  id: f.id,
                  fingerprint: f.fingerprint,
                  choice: "conscious",
                  decidedAt: new Date().toISOString(),
                },
              })
            }
          >
            {t("conscious")}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void mutate({
                type: "decision",
                value: {
                  id: f.id,
                  fingerprint: f.fingerprint,
                  choice: "dismissed",
                  decidedAt: new Date().toISOString(),
                },
              })
            }
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    ));
  }
  const tasks = (
    <PlanTasks state={state} busy={busy} edit={(task) => edit("tasks", task)} mutate={mutate} />
  );
  const metrics = <PlanMetrics budget={plan.budget} />;
  return (
    <>
      <div className="tp-head">
        <div>
          <span className="tp-kicker">{t("tagline")}</span>
          <h1>{plan.name}</h1>
          <p className="tp-muted">
            {state.destination} · {state.startDay} – {state.endDay}
          </p>
        </div>
        <div className="tp-actions">
          <button onClick={editSettings}>{t("editTrip")}</button>
          <button disabled={busy} onClick={() => void refresh()}>
            {t("refresh")}
          </button>
        </div>
      </div>
      <nav className="tp-tabs" aria-label={t("title")}>
        {sections.map((s) => (
          <Link
            className="tp-button"
            key={s}
            to={prefix + "/" + s}
            aria-current={s === section ? "page" : undefined}
          >
            {t("sections." + s)}
          </Link>
        ))}
      </nav>
      {error && (
        <div className="tp-error" role="alert">
          {error}
        </div>
      )}
      {plan.lastMutationId && (
        <div className="tp-actions">
          <button
            disabled={busy}
            onClick={() => void mutate({ type: "undo", mutationId: plan.lastMutationId! })}
          >
            {t("undo")}
          </button>
        </div>
      )}
      {section === "overview" && (
        <>
          <div className="tp-card tp-hero">
            <span className="tp-badge">
              {t(state.status === "ready" ? "readyStatus" : "planningStatus")}
            </span>
            <h2>{state.destination || plan.name}</h2>
            <p>{t("intro")}</p>
            <Link className="tp-button tp-primary" to={prefix + "/workspace"}>
              {t("continue")}
            </Link>
          </div>
          {metrics}
          <div className="tp-grid">
            <div className="tp-stack">
              {findingCards()}
              <p className="tp-muted">{t("noPush")}</p>
            </div>
            {tasks}
          </div>
        </>
      )}
      {section === "workspace" && (
        <>
          <div className="tp-tabs">
            <button aria-pressed={day === null} onClick={() => setDay(null)}>
              —
            </button>
            {days.map((d) => (
              <button key={d} aria-pressed={day === d} onClick={() => setDay(d)}>
                {d}
                {state.freeDays.includes(d) ? " · " + t("options.free") : ""}
              </button>
            ))}
          </div>
          <div className="tp-grid">
            <div className="tp-card">
              <div className="tp-head">
                <h2>{day || t("review.unknown")}</h2>
                <button onClick={() => edit("items")}>{t("newItem")}</button>
              </div>
              {day && (
                <button
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
                </button>
              )}
              {state.items
                .filter(
                  (i) => i.day === day && i.execution !== "cancelled" && i.execution !== "skipped"
                )
                .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
                .map(itemRow)}
              {!state.items.some(
                (i) => i.day === day && i.execution !== "cancelled" && i.execution !== "skipped"
              ) && <p>{t("empty")}</p>}
            </div>
            <div className="tp-card">
              <div className="tp-head">
                <h2>{t("newIdea")}</h2>
                <button onClick={() => edit("ideas")}>{t("add")}</button>
              </div>
              <input
                className="tp-search"
                aria-label={t("ideaSearch")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {state.ideas
                .filter((i) => (i.title + " " + i.note).toLowerCase().includes(query.toLowerCase()))
                .map((idea) => (
                  <div className="tp-row" key={idea.id}>
                    <div className="tp-grow">
                      <h3>{idea.title}</h3>
                      <p className="tp-muted">
                        {t("options." + idea.priority)} · {idea.category}
                      </p>
                      <p>{idea.note}</p>
                      <div className="tp-actions">
                        <button
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
                        </button>
                        <button onClick={() => edit("ideas", idea)}>{t("edit")}</button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void mutate({ type: "remove", collection: "ideas", id: idea.id })
                          }
                        >
                          {t("delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
      {section === "import" && (
        <>
          <p>{t("bookingsIntro")}</p>
          <button disabled={busy} onClick={() => void mutate({ type: "refresh_existing" })}>
            {t("refreshExisting")}
          </button>
          <div className="tp-actions">
            <button
              className="tp-primary"
              onClick={() =>
                edit("bookings", undefined, { review: true, title: t("manualBooking") })
              }
            >
              {t("manualBooking")}
            </button>
          </div>
          <div className="tp-grid">
            <ImportPanel
              key={tripId}
              plan={plan}
              onError={onError}
              onDraft={(b: PlanBooking) => edit("bookings", b, { review: true })}
            />
            <div className="tp-stack">
              <div className="tp-card">
                {state.bookings.map((b) => (
                  <div className="tp-row" key={b.id}>
                    <div className="tp-grow">
                      <h3>{b.title}</h3>
                      <p>
                        {b.day} – {b.endDay} · {b.time}
                      </p>
                      <p className="tp-muted">
                        {b.amount === null ? t("review.unknown") : b.amount + " " + b.currency} ·{" "}
                        {t("review.source")}: {b.source}
                      </p>
                      <button
                        disabled={state.items.some(
                          (i) => i.bookingId === b.id && i.source !== null
                        )}
                        onClick={() => edit("bookings", b, { review: true })}
                      >
                        {t("edit")}
                      </button>
                      <BookingPlanToggle
                        state={state}
                        bookingId={b.id}
                        busy={busy}
                        mutate={mutate}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="tp-card">
                <h2>{t("documents")}</h2>
                {documents.map((d) => (
                  <div key={d.id} className="tp-row">
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.displayName}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {section === "transfer" && (
        <>
          <p>{t("transferIntro")}</p>
          <div className="tp-stack">
            {plan.findings
              .filter((f) => f.code === "transferOpen" || f.code === "transferReview")
              .map((f) => {
                const transfer = state.transfers.find(
                  (x) => x.fromId === f.params.fromId && x.toId === f.params.toId
                );
                return (
                  <div className="tp-card" key={f.id}>
                    <h2>{t("findings." + f.code, f.params)}</h2>
                    <p>{transfer?.note}</p>
                    <div className="tp-actions">
                      <button
                        onClick={() =>
                          edit(
                            "transfers",
                            transfer || {
                              ...newEntry("transfers", null, state.currency, day),
                              fromId: f.params.fromId,
                              toId: f.params.toId,
                            }
                          )
                        }
                      >
                        {t("organized")}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate({
                            type: "upsert",
                            collection: "transfers",
                            value: entryRecord({
                              ...newEntry("transfers", null, state.currency, day),
                              ...transfer,
                              fromId: f.params.fromId,
                              toId: f.params.toId,
                              status: "conscious",
                            }),
                          })
                        }
                      >
                        {t("conscious")}
                      </button>
                    </div>
                  </div>
                );
              })}
            {state.transfers.map((x) => (
              <div className="tp-card" key={x.id}>
                <h3>
                  {x.mode || t("transferPlan")} · {t("options." + x.status)}
                </h3>
                <p>
                  {x.note} · {x.duration ?? "—"} + {x.buffer} min
                </p>
                <button onClick={() => edit("transfers", x)}>{t("edit")}</button>
              </div>
            ))}
            <p className="tp-muted">{t("transferAssumption")}</p>
            {findingCards(true)}
            {plan.findings.some((f) => f.code === "nightGap") && (
              <button
                disabled={busy}
                onClick={() =>
                  void mutate({ type: "settings", values: { openNights: days.slice(0, -1) } })
                }
              >
                {t("nightOpen")}
              </button>
            )}
          </div>
        </>
      )}
      {section === "ai" && <PlanAI key={tripId} plan={plan} mutate={mutate} onError={onError} />}
      {section === "packing" && (
        <>
          <PackingProfile state={state} mutate={mutate} busy={busy} />
          <p>{t("packIntro")}</p>
          <div className="tp-grid">
            <div className="tp-card">
              <div className="tp-head">
                <h2>
                  {state.packing.filter((p) => p.packed).length} / {state.packing.length}{" "}
                  {t("packed")}
                </h2>
                <button onClick={() => edit("packing")}>{t("newPacking")}</button>
              </div>
              {state.packing.map((p) => (
                <div className="tp-row" key={p.id}>
                  <label className="tp-check tp-grow">
                    <input
                      disabled={busy}
                      type="checkbox"
                      checked={p.packed}
                      onChange={(e) =>
                        void mutate({
                          type: "upsert",
                          collection: "packing",
                          value: entryRecord({ ...p, packed: e.target.checked }),
                        })
                      }
                    />
                    <span>
                      {p.quantity} × {p.label}
                      <small className="tp-muted">
                        {" "}
                        · {p.category} · {t("options." + p.scope)}
                      </small>
                    </span>
                  </label>
                  <button onClick={() => edit("packing", p)}>{t("edit")}</button>
                  <button
                    disabled={busy}
                    onClick={() => void mutate({ type: "remove", collection: "packing", id: p.id })}
                  >
                    {t("delete")}
                  </button>
                </div>
              ))}
            </div>
            <div className="tp-card">
              <h2>{t("forecast")}</h2>
              <WeatherLocation plan={plan} mutate={mutate} onError={onError} />
              <button
                disabled={weatherBusy || busy}
                onClick={() => {
                  setWeatherBusy(true);
                  void travplanApi
                    .forecast(plan)
                    .then(setPlan)
                    .then(() => travplanApi.packingSuggestions(tripId))
                    .then(setSuggestions)
                    .catch(onError)
                    .finally(() => setWeatherBusy(false));
                }}
              >
                {weatherBusy ? t("loading") : t("forecast")}
              </button>
              {state.forecast ? (
                <>
                  <p className="tp-muted">
                    <a href={state.forecast.source} target="_blank" rel="noopener noreferrer">
                      {t("sourceDate")}
                    </a>{" "}
                    · {state.forecast.fetchedAt}
                  </p>
                  {state.forecast.days
                    .filter(
                      (d) =>
                        (!state.startDay || d.day >= state.startDay) &&
                        (!state.endDay || d.day <= state.endDay)
                    )
                    .map((d) => (
                      <div className="tp-row" key={d.day}>
                        <span>{d.day}</span>
                        <span>
                          {d.min ?? "—"}° – {d.max ?? "—"}°
                        </span>
                        <span>{d.rainProbability ?? "—"}%</span>
                      </div>
                    ))}
                </>
              ) : (
                <p>{t("weatherUnknown")}</p>
              )}
              <button
                disabled={busy || weatherBusy}
                onClick={() =>
                  void travplanApi.packingSuggestions(tripId).then(setSuggestions).catch(onError)
                }
              >
                {t("showPackingIdeas")}
              </button>
              {suggestions
                .filter(
                  (s) =>
                    !state.packing.some((p) => p.category === "suggestion:" + s) &&
                    !state.decisions.some((d) => d.id === "packing:" + s)
                )
                .map((s) => (
                  <div key={s} className="tp-row">
                    <span className="tp-grow">{t("packingIdeas." + s)}</span>
                    <button
                      onClick={() =>
                        edit("packing", {
                          ...newEntry("packing", null, state.currency, day),
                          label: t("packingIdeas." + s),
                          note: state.forecast?.source || "",
                          manual: false,
                          category: "suggestion:" + s,
                        })
                      }
                    >
                      {t("add")}
                    </button>
                  </div>
                ))}
            </div>
          </div>
          {tasks}
        </>
      )}
      {section === "budget" && (
        <>
          {metrics}
          <div className="tp-banner">
            {t("remaining")}: {money(plan.budget.remaining)}
            {(plan.budget.unknown > 0 || plan.budget.otherCurrencies.length > 0) && (
              <p>{t("unknownCosts")}</p>
            )}
          </div>
          <div className="tp-grid">
            <div className="tp-card">
              <div className="tp-head">
                <h2>{t("sections.budget")}</h2>
                <button onClick={() => edit("costs")}>{t("newCost")}</button>
              </div>
              {[
                ...state.bookings.map((b) => ({ ...b, collection: "bookings" as const })),
                ...state.costs.map((c) => ({ ...c, collection: "costs" as const })),
              ].map((c) => (
                <div className="tp-row" key={c.id}>
                  <div className="tp-grow">
                    <h3>{c.title}</h3>
                    <p>
                      {c.amount ?? "—"} {c.currency} · {t("fields.paid")}: {c.paid}
                    </p>
                    <div className="tp-actions">
                      <button
                        onClick={() =>
                          edit(c.collection, c, { review: c.collection === "bookings" })
                        }
                      >
                        {t("edit")}
                      </button>
                      {c.amount !== null &&
                        c.paid < c.amount &&
                        (c.collection === "bookings" || c.kind === "booked") && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              const { collection, ...value } = c;
                              void mutate({
                                type: "upsert",
                                collection,
                                value: { ...value, paid: c.amount },
                              });
                            }}
                          >
                            {t("paid")}
                          </button>
                        )}
                      {c.collection === "costs" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void mutate({ type: "remove", collection: "costs", id: c.id })
                          }
                        >
                          {t("delete")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {tasks}
          </div>
        </>
      )}
      {section === "handover" && <PlanHandover plan={plan} busy={busy} mutate={mutate} />}
      {editor && (
        <PlanEditor
          key={editor.value.id ? String(editor.value.id) : "settings"}
          editor={editor}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </>
  );
}
export default function TravPlanPage() {
  const { tripId, section = "overview" } = useParams(),
    location = useLocation();
  return (
    <AppShell width="list" className="tp-main">
      {location.pathname === "/plan/admin" ? (
        <PlanAdmin />
      ) : tripId ? (
        <PlanContent tripId={tripId} section={sections.includes(section) ? section : "overview"} />
      ) : (
        <PlanList />
      )}
    </AppShell>
  );
}
