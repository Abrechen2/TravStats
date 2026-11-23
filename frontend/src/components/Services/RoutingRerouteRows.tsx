import { useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { adminRerouteApi, type RerouteMode } from "../../lib/api/rerouteRuns";
import RailRerouteRows from "./RailRerouteRows";
import RailLocalTransitReroute from "../Settings/RailLocalTransitReroute";
import RerouteRunStatus from "../Routing/RerouteRunStatus";
import { useRerouteRun } from "../Routing/useRerouteRun";
import { ActionControl, ChoiceControl, ErrorLine, SettingItem } from "../ui/settings";

/**
 * "Strecken neu routen" on the routing service (forgejo#436): the administrator's
 * pass over every account's straight legs and coach rides. The run lives on the
 * server and outlasts this page — and a day: it pauses at the provider's quota
 * and carries on by itself. Rail is its own scope of the same engine
 * (`RailRerouteRows`), drawn underneath where the rail router's address is
 * entered, followed by the one-off tram and U-Bahn repair.
 */
export default function RoutingRerouteRows({
  withRail,
  railUrl = null,
}: {
  withRail: boolean;
  /** The saved rail router address; a change while the page is open triggers the offer. */
  railUrl?: string | null;
}): JSX.Element {
  const { t } = useTranslation(["routing", "settings"]);
  const [mode, setMode] = useState<RerouteMode>("straight");
  const { run, error, busy, start, cancel } = useRerouteRun({
    read: adminRerouteApi.latest,
    start: () => adminRerouteApi.start(mode),
    cancel: adminRerouteApi.cancel,
  });
  const active = run?.status === "running" || run?.status === "paused";

  return (
    <>
      <SettingItem
        title={t("routing:admin.title")}
        sub={t("routing:admin.hint")}
        scope="allAccounts"
        help={mode === "all" ? t("routing:admin.modeAllHint") : undefined}
        control={
          <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
            <ChoiceControl
              label={t("routing:admin.mode")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "straight", label: t("routing:admin.modeStraight") },
                { value: "all", label: t("routing:admin.modeAll") },
              ]}
            />
            <ActionControl
              label={t("routing:admin.start")}
              onClick={() => void start()}
              busy={busy}
              disabled={active}
            />
          </div>
        }
      >
        {error && <ErrorLine>{t(`routing:admin.${error}`)}</ErrorLine>}
        {run && (
          <RerouteRunStatus run={run} onCancel={() => void cancel()} testId="routing-reroute-run" />
        )}
      </SettingItem>
      {withRail && <RailRerouteRows railUrl={railUrl} />}
      {withRail && (
        <SettingItem title={t("settings:railRouting.reroute.action")} control={null}>
          <RailLocalTransitReroute />
        </SettingItem>
      )}
    </>
  );
}
