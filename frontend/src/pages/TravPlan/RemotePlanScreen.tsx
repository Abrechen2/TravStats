import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, EmptyState } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { downloadBlob } from "../../lib/export";
import {
  REMOTE_PLAN_ENDED_EVENT,
  remotePlansApi,
  setRemotePlanSource,
  type RemotePlanSummary,
} from "../../lib/api/remotePlans";
import PlanContent, { PLAN_SECTIONS } from "./PlanContent";
import { PlanActions, PlanNotice } from "./planLayout";
import { remotePlanErrorKey } from "./remotePlanErrors";

type View =
  | { kind: "loading" }
  | { kind: "ended"; code?: string }
  | { kind: "failed"; key: string }
  | { kind: "ready"; plan: RemotePlanSummary };

/**
 * A plan on another server (spec 2026-11-02 §4): the same plan screens, worked through this
 * server's `/remote-plans` API. The header says whose plan it is and on which server; leaving and
 * saving the trip as a file live here. While this page is mounted the plan's API calls go through
 * the remote door; when the host (or this server) says the plan is no longer shared, the page
 * says so instead of showing an error per call. A host that does not answer is a failure with a
 * retry - nothing is dropped.
 */
export default function RemotePlanScreen() {
  const { t } = useTranslation("travplan");
  const { connectionId = "", planId = "", section = "overview" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const onEnded = (event: Event) => {
      if (live)
        setView({ kind: "ended", code: (event as CustomEvent<{ code?: string }>).detail?.code });
    };
    window.addEventListener(REMOTE_PLAN_ENDED_EVENT, onEnded);
    setView({ kind: "loading" });
    remotePlansApi
      .list()
      .then((all) => {
        if (!live) return;
        const found = all.find((p) => p.connectionId === connectionId && p.planId === planId);
        if (!found) return setView({ kind: "ended" });
        // Only an accepted plan opens; an invitation is answered on the plan list.
        if (found.state === "active")
          setRemotePlanSource({ connectionId, planId, tripId: found.tripId });
        setView({ kind: "ready", plan: found });
      })
      .catch((cause: unknown) => {
        if (live) setView({ kind: "failed", key: remotePlanErrorKey(cause) });
      });
    return () => {
      live = false;
      window.removeEventListener(REMOTE_PLAN_ENDED_EVENT, onEnded);
      setRemotePlanSource(null);
    };
  }, [connectionId, planId, attempt]);
  const fail = useCallback(
    (cause: unknown) =>
      setError(t(remotePlanErrorKey(cause), { defaultValue: t("errors.unknown") })),
    [t]
  );
  const leave = useCallback(async () => {
    try {
      await remotePlansApi.leave({ connectionId, planId });
      navigate("/plan", { replace: true });
    } catch (cause) {
      fail(cause);
    }
  }, [connectionId, planId, navigate, fail]);
  const saveTrip = useCallback(async () => {
    try {
      const file = await remotePlansApi.exportTrip({ connectionId, planId });
      downloadBlob(file.blob, file.filename);
      setError("");
    } catch (cause) {
      setError(t(remotePlanErrorKey(cause), { defaultValue: t("remote.exportFailed") }));
    }
  }, [connectionId, planId, t]);
  const answer = useCallback(
    async (accept: boolean) => {
      try {
        if (accept) await remotePlansApi.accept({ connectionId, planId });
        else await remotePlansApi.decline({ connectionId, planId });
        if (accept) setAttempt((n) => n + 1);
        else navigate("/plan", { replace: true });
      } catch (cause) {
        fail(cause);
      }
    },
    [connectionId, planId, navigate, fail]
  );
  if (view.kind === "loading") return <EmptyState kind="pending" title={t("loading")} />;
  if (view.kind === "failed")
    return (
      <EmptyState
        kind="degraded"
        title={t("remote.unreachableTitle")}
        description={t(view.key, { defaultValue: t("errors.unknown") })}
        action={<Button onClick={() => setAttempt((n) => n + 1)}>{t("refresh")}</Button>}
      />
    );
  if (view.kind === "ended")
    return (
      <EmptyState
        kind="degraded"
        title={t("remote.ended.title")}
        description={t("remote.ended.body")}
        action={<Link to="/plan">{t("remote.ended.toList")}</Link>}
      />
    );
  const { plan } = view;
  if (plan.state === "invited")
    return (
      <Card>
        <p>
          {t("remote.invitation", {
            owner: plan.ownerDisplayName,
            plan: plan.title,
            server: plan.origin,
          })}
        </p>
        <PlanActions>
          <Button variant="primary" onClick={() => void answer(true)}>
            {t("members.accept")}
          </Button>
          <Button onClick={() => void answer(false)}>{t("members.decline")}</Button>
        </PlanActions>
        {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      </Card>
    );
  return (
    <>
      <Card>
        <p className="t-caption">
          {t("remote.banner", { owner: plan.ownerDisplayName, server: new URL(plan.origin).host })}
        </p>
        <PlanActions>
          <Button onClick={() => void saveTrip()}>{t("remote.export")}</Button>
          <Button variant="danger" onClick={() => void leave()}>
            {t("remote.leave")}
          </Button>
        </PlanActions>
        <p className="t-caption">{t("remote.exportHint")}</p>
        {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      </Card>
      <PlanContent
        key={plan.tripId}
        tripId={plan.tripId}
        remote
        section={PLAN_SECTIONS.includes(section) ? section : "overview"}
      />
    </>
  );
}
