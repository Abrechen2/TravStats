import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { travplanApi, type PlanState, type PlanSummary } from "../../lib/api/travplan";
import PlanEditor from "./PlanEditor";
import { settingFields } from "./editorModel";
import {
  Button,
  Card,
  EmptyState,
  HeroCard,
  PageHeader,
  SectionLabel,
  StatusPill,
} from "../../components/ui";
import { PlanGrid, PlanLink, PlanNotice, PlanStack } from "./planLayout";

export function PlanList() {
  const { t } = useTranslation("travplan"),
    navigate = useNavigate(),
    isAdmin = useAuthStore((s) => s.user?.isAdmin),
    [plans, setPlans] = useState<PlanSummary[]>([]),
    [enabled, setEnabled] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([travplanApi.list(), travplanApi.capabilities()])
      .then(([rows, caps]) => {
        if (live) {
          setPlans(rows);
          setEnabled(caps.enabled);
        }
      })
      .catch(() => {
        if (live) setError(t("errors.unknown"));
      });
    return () => {
      live = false;
    };
  }, [t]);
  return (
    <>
      <SectionLabel>{t("tagline")}</SectionLabel>
      <PageHeader
        title={t("heading")}
        meta={t("intro")}
        actions={
          <>
            {isAdmin && <PlanLink to="/plan/admin">{t("config")}</PlanLink>}
            <Button variant="primary" disabled={!enabled} onClick={() => setCreate(true)}>
              {t("newTrip")}
            </Button>
          </>
        }
      />
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      {enabled === false && <PlanNotice>{t("disabled")}</PlanNotice>}
      <PlanGrid>
        {plans.map((p) => (
          <HeroCard key={p.id}>
            <PlanStack>
              <div>
                <StatusPill status={p.status === "ready" ? "flown" : "scheduled"}>
                  {t(p.status === "ready" ? "readyStatus" : "planningStatus")}
                </StatusPill>
              </div>
              <h2 className="t-card-title">{p.name}</h2>
              <p className="t-body">
                {p.destination} · {p.startDay} – {p.endDay}
              </p>
              <p className="t-caption">
                {p.ideasCount} {t("sections.workspace")} · {p.bookingsCount} {t("sections.import")}
              </p>
              <div>
                <PlanLink to={"/plan/" + p.tripId + "/overview"}>{t("continue")}</PlanLink>
              </div>
            </PlanStack>
          </HeroCard>
        ))}
      </PlanGrid>
      {!plans.length && enabled && (
        <EmptyState
          title={t("empty")}
          action={
            <Button variant="primary" onClick={() => setCreate(true)}>
              {t("newTrip")}
            </Button>
          }
        />
      )}
      {create && (
        <PlanEditor
          editor={{
            title: t("newTrip"),
            fields: settingFields,
            value: {
              name: "",
              destination: "",
              startDay: null,
              endDay: null,
              timezone: null,
              travelers: 1,
              pace: "balanced",
              budget: null,
              currency: "EUR",
              latitude: null,
              longitude: null,
            },
          }}
          busy={busy}
          onClose={() => setCreate(false)}
          onSave={async (value) => {
            setBusy(true);
            try {
              const { name, ...settings } = value;
              const next = await travplanApi.create(String(name), settings as Partial<PlanState>);
              navigate("/plan/" + next.tripId + "/overview");
              return true;
            } catch {
              setError(t("errors.unknown"));
              return false;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
export function PlanAdmin() {
  const { t } = useTranslation("travplan"),
    isAdmin = useAuthStore((s) => s.user?.isAdmin);
  if (!isAdmin) return <PlanNotice tone="bad">{t("disabled")}</PlanNotice>;
  // One canonical instance form, in Administration (settings redesign, rule 4):
  // this route stays so old bookmarks and the "off for me" redirect still land,
  // but it holds no second editor.
  return (
    <>
      <PageHeader title={t("config")} meta={t("configMoved")} />
      <Card>
        <PlanLink to="/admin/instance?section=travPlan&expert=1">{t("configOpenAdmin")}</PlanLink>
      </Card>
    </>
  );
}
