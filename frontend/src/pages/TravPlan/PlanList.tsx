import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useAuthStore } from "../../store/authStore";
import { travplanApi, type PlanInvitation, type PlanSummary } from "../../lib/api/travplan";
import { apiErrorMachineCode } from "../../lib/apiError";
import { PlanCreate } from "./PlanCreate";
import { shortDay } from "./route/RouteTimeline";
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
    [invitations, setInvitations] = useState<PlanInvitation[]>([]),
    [create, setCreate] = useState(false);
  async function answer(invitation: PlanInvitation, accept: boolean) {
    try {
      await travplanApi.answerInvitation(invitation.memberId, accept ? "accept" : "decline");
      setInvitations((all) => all.filter((i) => i.memberId !== invitation.memberId));
      if (accept) setPlans(await travplanApi.list());
    } catch (cause) {
      setError(t("errors." + apiErrorMachineCode(cause), { defaultValue: t("errors.unknown") }));
    }
  }
  useEffect(() => {
    let live = true;
    Promise.all([travplanApi.list(), travplanApi.capabilities(), travplanApi.invitations()])
      .then(([rows, caps, open]) => {
        if (live) {
          setPlans(rows);
          setEnabled(caps.enabled);
          setInvitations(open);
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
      {invitations.map((i) => (
        <PlanNotice key={i.memberId}>
          <p>{t("members.invitation", { owner: i.ownerName, plan: i.planName })}</p>
          <Button variant="primary" onClick={() => void answer(i, true)}>
            {t("members.accept")}
          </Button>{" "}
          <Button onClick={() => void answer(i, false)}>{t("members.decline")}</Button>
        </PlanNotice>
      ))}
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
              {p.role === "editor" && (
                <p className="t-caption">{t("members.sharedBy", { owner: p.ownerName ?? "" })}</p>
              )}
              <p className="t-body">
                {p.destination} ·{" "}
                {[shortDay(p.startDay), shortDay(p.endDay)].filter(Boolean).join(" – ")}
              </p>
              <p className="t-caption">
                {p.shape === "route"
                  ? t("listCountsRoute", { stations: p.stationsCount, stages: p.stagesCount })
                  : t("listCountsStay", { ideas: p.ideasCount, bookings: p.bookingsCount })}
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
        <PlanCreate
          onClose={() => setCreate(false)}
          onCreated={(plan) => navigate("/plan/" + plan.tripId + "/overview")}
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
