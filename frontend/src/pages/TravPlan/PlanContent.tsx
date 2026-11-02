import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { RouteSection } from "./route/RouteSection";
import { shortDay } from "./route/RouteTimeline";
import { PlanDeleteDialog } from "./PlanDeleteDialog";
import { PlanMenu } from "./PlanMenu";
import { UndoToast } from "./UndoToast";
import { useCollab } from "./useCollab";
import { PlanMembersDialog } from "./PlanMembersDialog";
import { MemberNoteCard, MemberNotices } from "./MemberPanels";
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

/** The strip shows five places; the rest are reached from the overview, the header or a finding. */
const STRIP_SECTIONS = ["overview", "workspace", "import", "packing", "budget"];

export default function PlanContent({ tripId, section }: { tripId: string; section: string }) {
  const { t } = useTranslation("travplan"),
    { plan, setPlan, loading, busy, error, setError, refresh, mutate, message } = usePlan(tripId),
    [editor, setEditor] = useState<EditorState | null>(null),
    [day, setDay] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [weatherBusy, setWeatherBusy] = useState(false),
    [suggestions, setSuggestions] = useState<string[]>([]),
    [documents, setDocuments] = useState<TravelDocument[]>([]),
    [deleting, setDeleting] = useState(false),
    [members, setMembers] = useState(false),
    navigate = useNavigate();
  const onError = useCallback((e: unknown) => setError(message(e)), [message, setError]);
  const { collab, reload, markRead } = useCollab(tripId, plan?.revision ?? 0, onError);
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
      title: t(row ? "edit" : "add"),
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
    members: collab?.members ?? [],
  };
  return (
    <>
      <SectionLabel>{t("tagline")}</SectionLabel>
      <PageHeader
        title={plan.name}
        meta={[
          state.destination,
          [shortDay(state.startDay), shortDay(state.endDay)].filter(Boolean).join(" – "),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <PlanLink to={prefix + "/ai"}>{t("sections.ai")}</PlanLink>
            <PlanMenu>
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
              <Button onClick={() => setMembers(true)}>
                {t("members.open", {
                  count: collab?.members.filter((m) => m.status === "active").length ?? 1,
                })}
              </Button>
              {/* The owner's alone (D3): a co-planner is not offered what the server refuses. */}
              {(plan.self?.isOwner ?? true) && (
                <Button variant="danger" onClick={() => setDeleting(true)}>
                  {t("deletePlan.open")}
                </Button>
              )}
            </PlanMenu>
          </>
        }
      />
      <nav
        aria-label={t("title")}
        className="flex overflow-x-auto"
        style={{ gap: "var(--ts-space-sm)", paddingBottom: "var(--ts-space-md)" }}
      >
        {(STRIP_SECTIONS.includes(section) ? STRIP_SECTIONS : [...STRIP_SECTIONS, section]).map(
          (s) => (
            <PlanLink key={s} variant="tab" to={prefix + "/" + s} current={s === section}>
              {t(s === "workspace" && state.shape === "route" ? "sections.route" : "sections." + s)}
            </PlanLink>
          )
        )}
      </nav>
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      <UndoToast
        mutationId={plan.lastMutationId}
        busy={busy}
        onUndo={(mutationId) => void mutate({ type: "undo", mutationId })}
      />
      <MemberNotices collab={collab} onRead={() => void markRead()} />
      {section === "overview" && <OverviewSection ctx={ctx} />}
      {section === "overview" && (
        <MemberNoteCard
          plan={plan}
          busy={busy}
          save={(text) => mutate({ type: "member_note", text })}
        />
      )}
      {members && collab && (
        <PlanMembersDialog
          tripId={tripId}
          collab={collab}
          onClose={() => setMembers(false)}
          onChanged={reload}
          onLeft={() => navigate("/plan")}
        />
      )}
      {section === "workspace" &&
        (state.shape === "route" ? <RouteSection ctx={ctx} /> : <WorkspaceSection ctx={ctx} />)}
      {section === "import" && <ImportSection ctx={ctx} />}
      {section === "transfer" && <TransferSection ctx={ctx} />}
      {section === "ai" && <PlanAI key={tripId} plan={plan} mutate={mutate} onError={onError} />}
      {section === "packing" && <PackingSection ctx={ctx} />}
      {section === "budget" && <BudgetSection ctx={ctx} />}
      {section === "handover" && <PlanHandover plan={plan} busy={busy} mutate={mutate} />}
      {deleting && (
        <PlanDeleteDialog
          tripId={tripId}
          name={plan.name}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate("/plan")}
        />
      )}
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
