import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { remotePlansApi, type RemotePlanSummary } from "../../lib/api/remotePlans";
import { PlanNotice } from "../../pages/TravPlan/planLayout";
import Button from "../ui/Button";

/**
 * Invitations into a plan on another server (spec 2026-11-02 §4), answered where the person
 * looks: in the plan list and among the connection requests (the inbox badge counts them). A
 * failed answer keeps the invitation and says why; a host that is offline can be tried again.
 * `onChange` lets the plan list reload when an invitation became a plan.
 */
export default function RemotePlanInvitations({
  onChange,
}: {
  onChange?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["travplan"]);
  const [invitations, setInvitations] = useState<RemotePlanSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const all = await remotePlansApi.list();
      setInvitations(all.filter((p) => p.state === "invited"));
    } catch (cause) {
      // Off on this server is not a failure: there is simply nothing to answer.
      if (apiErrorMachineCode(cause) === "SHARE_REMOTE_DISABLED") return;
      logger.error("Failed to load plan invitations:", cause);
      setError(t("travplan:remote.invitations.loadFailed"));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (invitations.length === 0 && !error) return null;
  const answer = async (plan: RemotePlanSummary, accept: boolean): Promise<void> => {
    setBusy(plan.planId);
    setError("");
    try {
      if (accept) await remotePlansApi.accept(plan);
      else await remotePlansApi.decline(plan);
      setInvitations((all) => all.filter((p) => p.planId !== plan.planId));
      onChange?.();
    } catch (cause) {
      logger.error("Failed to answer a plan invitation:", cause);
      const code = apiErrorMachineCode(cause);
      setError(
        t(code ? `travplan:errors.${code}` : "travplan:errors.network", {
          defaultValue: t("travplan:errors.unknown"),
        })
      );
      await load();
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-label={t("travplan:remote.invitations.title")}>
      {invitations.map((p) => (
        <PlanNotice key={`${p.connectionId}/${p.planId}`}>
          <p>
            {t("travplan:remote.invitation", {
              owner: p.ownerDisplayName,
              plan: p.title,
              server: new URL(p.origin).host,
            })}
          </p>
          <Button variant="primary" disabled={busy !== null} onClick={() => void answer(p, true)}>
            {t("travplan:members.accept")}
          </Button>{" "}
          <Button disabled={busy !== null} onClick={() => void answer(p, false)}>
            {t("travplan:members.decline")}
          </Button>
        </PlanNotice>
      ))}
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
    </section>
  );
}
