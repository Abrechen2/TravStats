import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  railRerouteApi,
  type RailRerouteStatus,
  type RerouteMode,
} from "../../lib/api/rerouteRuns";
import { logger } from "../../lib/logger";
import RerouteRunStatus from "../Routing/RerouteRunStatus";
import { useRerouteRun } from "../Routing/useRerouteRun";
import { ActionControl, ChoiceControl, ErrorLine, SettingItem } from "../ui/settings";

/**
 * "Bahnstrecken neu routen" where the rail router's address is entered: the
 * administrator's pass over every account's rail journeys, through the same
 * engine as the road pass. Three things it says in words:
 *  - without a router, how many rides are straight lines for that reason (the
 *    readiness note), instead of leaving the chord unexplained;
 *  - with one, the button, "only straight lines" by default;
 *  - right after an address is saved, the offer to route them now.
 */
export default function RailRerouteRows({ railUrl }: { railUrl: string | null }): JSX.Element {
  const { t } = useTranslation(["routing"]);
  const [mode, setMode] = useState<RerouteMode>("straight");
  const [info, setInfo] = useState<
    Pick<RailRerouteStatus, "straightJourneys" | "routerConfigured">
  >({ straightJourneys: 0, routerConfigured: false });
  const [offer, setOffer] = useState(false);
  const read = useCallback(async () => {
    const status = await railRerouteApi.status();
    setInfo({
      straightJourneys: status.straightJourneys,
      routerConfigured: status.routerConfigured,
    });
    return status.run;
  }, []);
  // The offer always means "the straight lines", whatever the choice beside it says.
  const offerStart = useRef(false);
  const { run, error, busy, start, cancel } = useRerouteRun(
    {
      read,
      start: () => {
        const startMode = offerStart.current ? "straight" : mode;
        offerStart.current = false;
        return railRerouteApi.start(startMode);
      },
      cancel: railRerouteApi.cancel,
    },
    true,
    () => void read().catch((err: unknown) => logger.warn("Reading the rail count failed", err))
  );
  const active = run?.status === "running" || run?.status === "paused";

  // An address saved while this page is open: count again and offer the pass.
  const lastUrl = useRef(railUrl);
  useEffect(() => {
    if (lastUrl.current === railUrl) return;
    lastUrl.current = railUrl;
    setOffer(false);
    // A removed address matters as much as a saved one: the note and the button follow it.
    void read()
      .then(() => setOffer(railUrl !== null))
      .catch((err: unknown) => logger.warn("Reading the rail count failed", err));
  }, [railUrl, read]);

  const noRouter = !info.routerConfigured;
  return (
    <SettingItem
      title={t("routing:rail.title")}
      sub={t("routing:rail.hint")}
      scope="allAccounts"
      help={mode === "all" ? t("routing:rail.modeAllHint") : undefined}
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
            label={t("routing:rail.start")}
            onClick={() => void start()}
            busy={busy}
            disabled={active || noRouter}
          />
        </div>
      }
    >
      {noRouter && info.straightJourneys > 0 && (
        <p className="t-caption" role="status" data-testid="rail-reroute-readiness">
          {t("routing:rail.readiness", { count: info.straightJourneys })}
        </p>
      )}
      {offer && !noRouter && !active && info.straightJourneys > 0 && (
        <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
          <p className="t-caption" role="status" data-testid="rail-reroute-offer">
            {t("routing:rail.offer", { count: info.straightJourneys })}
          </p>
          <ActionControl
            label={t("routing:rail.offerAction")}
            onClick={() => {
              setOffer(false);
              offerStart.current = true;
              void start();
            }}
            busy={busy}
          />
        </div>
      )}
      {error && <ErrorLine>{t(`routing:rail.${error}`)}</ErrorLine>}
      {run && (
        <RerouteRunStatus run={run} onCancel={() => void cancel()} testId="rail-reroute-run" />
      )}
    </SettingItem>
  );
}
