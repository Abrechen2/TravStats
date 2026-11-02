import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanApi, type PlanConnectionOption } from "../../lib/api/travplan";
import { apiErrorMachineCode } from "../../lib/apiError";
import { PlanGrow, PlanNotice, PlanRow } from "./planLayout";
import { remotePlanErrorKey } from "./remotePlanErrors";

/**
 * "Mitplaner auf einem anderen Server" (spec 2026-11-02 §4): the owner picks a person they are
 * connected with whose server and whose own switch both allow plans. The connection decides who
 * is offered - there is no free text and no link. Drawn only while cross-server sharing is on
 * (`SHARE_REMOTE_DISABLED` hides it); a failed load or a failed invitation says so.
 */
export function PlanRemoteInvite({ tripId, onChanged }: { tripId: string; onChanged: () => void }) {
  const { t } = useTranslation("travplan");
  const [options, setOptions] = useState<PlanConnectionOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [hidden, setHidden] = useState(false);
  const load = useCallback(async () => {
    try {
      setOptions(await travplanApi.inviteConnections(tripId));
      setError("");
    } catch (cause) {
      if (apiErrorMachineCode(cause) === "SHARE_REMOTE_DISABLED") setHidden(true);
      else setError(t(remotePlanErrorKey(cause), { defaultValue: t("errors.unknown") }));
    }
  }, [tripId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (hidden) return null;
  async function invite(option: PlanConnectionOption) {
    setBusy(option.connectionId);
    setError("");
    setInfo("");
    try {
      await travplanApi.inviteConnection(tripId, option.connectionId);
      setInfo(t("remote.invite.sent", { name: option.displayName }));
      onChanged();
      await load();
    } catch (cause) {
      const code = apiErrorMachineCode(cause);
      setError(
        t(code ? "remote.invite.errors." + code : remotePlanErrorKey(cause), {
          defaultValue: t("remote.invite.errors.unknown"),
        })
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div>
      <h3 className="t-body">{t("remote.invite.title")}</h3>
      <p className="t-caption">{t("remote.invite.intro")}</p>
      {options && options.length === 0 && <p className="t-caption">{t("remote.invite.none")}</p>}
      {options?.map((o) => (
        <PlanRow key={o.connectionId}>
          <PlanGrow>
            <strong>{o.displayName}</strong>
            <span className="t-caption">
              {" "}
              @{o.username} · {o.origin}
            </span>
          </PlanGrow>
          <Button
            disabled={busy !== null || o.member}
            onClick={() => void invite(o)}
            aria-label={t("remote.invite.send", { name: o.displayName })}
          >
            {o.member ? t("remote.invite.already") : t("members.invite")}
          </Button>
        </PlanRow>
      ))}
      {error && <PlanNotice tone="bad">{error}</PlanNotice>}
      {info && <PlanNotice>{info}</PlanNotice>}
    </div>
  );
}
