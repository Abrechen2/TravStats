import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanApi, type PlanCollection, type PlanState } from "../../lib/api/travplan";
import { documentsApi, type TravelDocument } from "../../lib/api/documents";
import { logger } from "../../lib/logger";
import { Button, EmptyState, PageHeader, SectionLabel } from "../../components/ui";
import { usePlan } from "./usePlan";
import PlanEditor, { type EditorState } from "./PlanEditor";
import { editors, newEntry, settingFields } from "./editorModel";
import { PlanActions, PlanLink, PlanNotice } from "./planLayout";
import { calendarDays, entryRecord, type PlanCtx } from "./planContext";
import { OverviewSection } from "./sections/OverviewSection";
import { WorkspaceSection } from "./sections/WorkspaceSection";
import { ImportSection } from "./sections/ImportSection";
import { TransferSection } from "./sections/TransferSection";
import { PackingSection } from "./sections/PackingSection";
import { BudgetSection } from "./sections/BudgetSection";
import { PlanActualPanel } from "./sections/PlanActualPanel";
import PlanAI from "./PlanAI";
import { PlanHandover } from "./PlanHandover";

export const PLAN_SECTIONS = [
  "overview",
  "workspace",
  "import",
  "transfer",
  "ai",
  "packing",
  "budget",
  "handover",
  "actual",
];

export default function PlanContent({ tripId, section }: { tripId: string; section: string }) {
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
      .catch((cause: unknown) => logger.warn("Failed to load trip documents", cause));
    return () => {
      live = false;
    };
  }, [tripId, plan?.revision]);
  useEffect(() => {
    if (plan && day === null && plan.state.startDay) setDay(plan.state.startDay);
  }, [plan?.state.startDay]);
  if (loading && !plan) return <EmptyState kind="pending" title={t("loading")} />;
  if (!plan)
    return (
      <>
        {error && <PlanNotice tone="bad">{error}</PlanNotice>}
        <PlanActions>
          <Button
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
          </Button>
          <Button onClick={() => void refresh()}>{t("refresh")}</Button>
        </PlanActions>
      </>
    );
  const state = plan.state,
    prefix = "/plan/" + tripId;
  function edit(key: PlanCollection, row?: object, extras?: Partial<EditorState>) {
    setEditor({
      title: t("edit"),
      collection: key,
      fields: editors[key],
      value: row ? entryRecord(row) : newEntry(key, state.timezone, state.currency, day),
      ...extras,
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
  const ctx: PlanCtx = {
    plan,
    state,
    busy,
    prefix,
    tripId,
    day,
    setDay,
    days: calendarDays(state.startDay, state.endDay),
    mutate,
    edit,
    onError,
    setPlan,
    documents,
    query,
    setQuery,
    weatherBusy,
    setWeatherBusy,
    suggestions,
    setSuggestions,
  };
  return (
    <>
      <SectionLabel>{t("tagline")}</SectionLabel>
      <PageHeader
        title={plan.name}
        meta={`${state.destination} · ${state.startDay} – ${state.endDay}`}
        actions={
          <>
            <Button
              onClick={() =>
                setEditor({
                  title: t("editTrip"),
                  fields: settingFields,
                  value: { name: plan.name, ...state },
                })
              }
            >
              {t("editTrip")}
            </Button>
            <Button disabled={busy} onClick={() => void refresh()}>
              {t("refresh")}
            </Button>
            <PlanLink to={"/trips/" + tripId}>{t("statsMode")}</PlanLink>
          </>
        }
      />
      <nav
        aria-label={t("title")}
        className="flex overflow-x-auto"
        style={{ gap: "var(--ts-space-sm)", paddingBottom: "var(--ts-space-md)" }}
      >
        {PLAN_SECTIONS.map((s) => (
          <PlanLink key={s} variant="tab" to={prefix + "/" + s} current={s === section}>
            {t("sections." + s)}
          </PlanLink>
        ))}
      </nav>
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      {plan.lastMutationId && (
        <PlanActions>
          <Button
            disabled={busy}
            onClick={() => void mutate({ type: "undo", mutationId: plan.lastMutationId! })}
          >
            {t("undo")}
          </Button>
        </PlanActions>
      )}
      {section === "overview" && <OverviewSection ctx={ctx} />}
      {section === "workspace" && <WorkspaceSection ctx={ctx} />}
      {section === "import" && <ImportSection ctx={ctx} />}
      {section === "transfer" && <TransferSection ctx={ctx} />}
      {section === "ai" && <PlanAI key={tripId} plan={plan} mutate={mutate} onError={onError} />}
      {section === "packing" && <PackingSection ctx={ctx} />}
      {section === "budget" && <BudgetSection ctx={ctx} />}
      {section === "handover" && <PlanHandover plan={plan} busy={busy} mutate={mutate} />}
      {section === "actual" && <PlanActualPanel ctx={ctx} />}
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
