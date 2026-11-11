import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { dawarichStaysApi, type StayScanState } from "../../../lib/api/dawarichStays";
import { profileDateTime } from "../../../lib/profileInstant";
import { SectionCard, SectionTitle } from "../SettingsShared";
import { useExpertRows } from "../frame/useExpertRows";
import { SettingRows } from "../../ui/SettingRow";
import {
  ActionControl,
  ChoiceControl,
  Dependency,
  ErrorLine,
  JobStatus,
  LinkButton,
  SettingItem,
  StatusValue,
  SwitchControl,
  useGuardedNavigate,
  useSettingWrite,
  type JobView,
} from "../../ui/settings";
import { DAWARICH_CONNECTION_PATH } from "./LocationSourceSection";
import { JobLostError, failedResultKey, stayErrorKey } from "./stayScanCopy";

const LOOKBACKS = ["7", "14", "30"] as const;
const POLL_MS = 3000;

type Phase =
  | { kind: "idle" }
  | { kind: "running"; done?: number; total?: number }
  | { kind: "lost" }
  | { kind: "failed"; reason: string };

/** Where each pause reason is lifted (the jump under its sentence). */
const PAUSE_JUMPS: Record<string, { label: string; to: string } | undefined> = {
  suggestionsDisabled: { label: "settings:blocks.dep.stayOff.jump", to: "/settings/trips" },
  placesDisabled: { label: "settings:blocks.dep.placesOff.jump", to: "/settings/domains" },
  connectionMissing: {
    label: "settings:blocks.dep.noOwnDawarich.jump",
    to: DAWARICH_CONNECTION_PATH,
  },
};

/**
 * Settings → Standort → Aufenthalte finden: the stay scan reads the account's
 * source every six hours and proposes stays in the inbox; nothing is entered
 * until the user confirms (R15: the switch IS the consent, there is no
 * consent dialog and no area switch — market and venue detection always run,
 * R2-1).
 *
 * "Jetzt suchen" is a background job on its own row. Every way it can end has
 * its sentence: running, done, interrupted, lost to a server restart ("ich
 * weiß nicht, ob es fertig wurde"), refused (places off, no connection, rate
 * limit). A paused scan says WHY it is paused and where to lift it.
 */
export default function StayScanSection({
  onScanned,
  belege,
  fineBefore,
}: {
  onScanned?: () => void;
  /** The "Belege" group (the Immich evidence switch), drawn between the search and its tuning. */
  belege?: ReactNode;
  /** Rows that lead the "Feinabstimmung" group, ahead of the period and the areas. */
  fineBefore?: ReactNode;
}): JSX.Element {
  const { t } = useTranslation(["settings", "trips"]);
  const isDemo = useIsDemoAccount();
  const navigate = useGuardedNavigate();
  // The search period and the areas switch are the expert rows of Feinabstimmung.
  const expert = useExpertRows(2);
  const [state, setState] = useState<StayScanState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [lookback, setLookback] = useState<(typeof LOOKBACKS)[number]>("7");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [refusal, setRefusal] = useState<string | null>(null);
  const stateRef = useRef<StayScanState | null>(null);

  /** Resolves true when the server answered. */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const next = await dawarichStaysApi.state();
      stateRef.current = next;
      setState(next);
      setLoadError(false);
      return true;
    } catch {
      setLoadError(true);
      return false;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const serverRunning = state?.result === "running";
  useEffect(() => {
    if (!serverRunning) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, serverRunning]);

  const enabled = useSettingWrite<boolean>(
    "location.stayScan",
    state?.enabled ?? false,
    async (on) => {
      setRefusal(null);
      try {
        await dawarichStaysApi.enable(on);
      } catch (err) {
        setRefusal(stayErrorKey(err));
        throw err;
      }
      await load();
      onScanned?.();
    }
  );

  // "Märkte, Parks und Museen mitsuchen": markets and venues are one switch in
  // the design; the server accepts them only while the search itself is on.
  const areas = useSettingWrite<boolean>(
    "location.stayScanAreas",
    state ? (state.marketEnabled ?? false) && (state.venueEnabled ?? false) : false,
    async (on) => {
      setRefusal(null);
      try {
        await dawarichStaysApi.enableAreas(on);
      } catch (err) {
        setRefusal(stayErrorKey(err));
        throw err;
      }
      await load();
    }
  );

  const startScan = useCallback(async (): Promise<void> => {
    setPhase({ kind: "running" });
    try {
      await dawarichStaysApi.scan(Number(lookback), {
        onPoll: (job) =>
          setPhase({
            kind: "running",
            done: job.progress?.done,
            total: job.progress?.total,
          }),
      });
      setPhase({ kind: "idle" });
      onScanned?.();
      await load();
    } catch (err) {
      await load();
      if (err instanceof JobLostError) setPhase({ kind: "lost" });
      else setPhase({ kind: "failed", reason: t(stayErrorKey(err, stateRef.current)) });
    }
  }, [lookback, load, onScanned, t]);

  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const placesPaused = state?.placesEnabled === false;
  const travtrack = state?.source === "travtrack";
  const pausedReason = state?.pausedReason ?? null;
  const at = (iso: string | null | undefined): string =>
    iso ? (profileDateTime(iso) ?? "—") : "—";
  const jumpOf = (reason: string) => {
    const jump = PAUSE_JUMPS[reason];
    return jump ? { label: t(jump.label), onJump: () => navigate(jump.to) } : undefined;
  };

  // The switch cannot be turned ON without a readable source and Places; turning
  // it OFF is always possible, so a paused scan stays switchable.
  const cannotEnable =
    state && !state.enabled
      ? placesPaused
        ? ("placesDisabled" as const)
        : !state.connected
          ? travtrack
            ? ("travTrackDisabled" as const)
            : ("connectionMissing" as const)
          : null
      : null;

  const running = phase.kind === "running" || serverRunning;
  const result = state?.result ?? null;
  const done = state?.finishedAt ? at(state.finishedAt) : "—";
  let job: JobView | null = null;
  if (phase.kind === "running") {
    job = {
      kind: "running",
      what: t("settings:location.stay.result.running"),
      done: phase.done,
      total: phase.total,
    };
  } else if (phase.kind === "lost") {
    job = {
      kind: "unknown",
      onCheck: () =>
        void load().then((answered) => {
          // Only a read that got through says how it ended.
          if (answered) setPhase({ kind: "idle" });
        }),
    };
  } else if (phase.kind === "failed") {
    job = { kind: "failed", reason: phase.reason, onRetry: () => void startScan() };
  } else if (serverRunning) {
    job = { kind: "running", what: t("settings:location.stay.result.running") };
  } else if (result === "interrupted") {
    job = {
      kind: "failed",
      reason: t("settings:location.stay.result.interrupted"),
      onRetry: () => void startScan(),
    };
  } else if (result === "stale") {
    job = { kind: "done", result: t("settings:location.stay.result.stale") };
  } else if (result === "failed") {
    job = {
      kind: "failed",
      reason: t(failedResultKey(state)),
      onRetry: () => void startScan(),
    };
  }

  // "Letzter Suchlauf": how the last finished search ended, or that none has.
  const lastRun =
    result === "succeeded" || result === "partial"
      ? t(`settings:location.stay.result.${result === "partial" ? "partial" : "done"}`, {
          created: state?.createdCount ?? 0,
          points: state?.pointCount ?? 0,
          at: done,
        })
      : null;

  const stale =
    !!state?.dataThrough && Date.now() - Date.parse(state.dataThrough) > 24 * 60 * 60_000;
  const coverageScope = state?.marketResult?.scope === "venues" ? "venues" : "markets";
  const coverage = state?.marketResult;

  return (
    <>
      <SectionCard>
        <SectionTitle title={t("settings:tt.groups.suchlauf")} />
        <SettingRows>
          <SettingItem
            title={t("settings:location.stay.scan.name")}
            sub={t("settings:location.stay.scan.sub")}
            help={[
              t("settings:location.stay.scan.help"),
              t(`trips:dawarichStays.${travtrack ? "travtrack.description" : "description"}`),
              t("trips:dawarichStays.areas.description"),
            ].join(" ")}
            save={enabled}
            locked={locked}
            dependency={
              cannotEnable
                ? {
                    reason: t(`settings:location.stay.pause.${cannotEnable}`),
                    jump: jumpOf(cannotEnable),
                  }
                : undefined
            }
            control={
              // No switch before the server said what it is: a guessed "off" would
              // let the user consent while only trying to look.
              state ? (
                <SwitchControl
                  checked={enabled.value}
                  label={t("settings:location.stay.scan.name")}
                  onChange={enabled.choose}
                />
              ) : undefined
            }
          >
            {state?.enabled && pausedReason && pausedReason !== "disabled" ? (
              <Dependency
                reason={t(`settings:location.stay.pause.${pausedReason}`)}
                jump={jumpOf(pausedReason)}
              />
            ) : null}
            {state?.nextScanAt && state.enabled && !pausedReason ? (
              <p className="t-caption" style={{ margin: 0 }}>
                {t("settings:location.stay.next", { at: at(state.nextScanAt) })}
              </p>
            ) : null}
            {refusal ? <ErrorLine>{t(refusal)}</ErrorLine> : null}
            {loadError ? (
              <ErrorLine>
                {t("settings:location.stay.loadError")}{" "}
                <LinkButton onClick={() => void load()}>
                  {t("settings:blocks.save.retry")}
                </LinkButton>
              </ErrorLine>
            ) : null}
          </SettingItem>

          <SettingItem
            title={t("settings:location.stay.last.name")}
            control={<StatusValue>{lastRun ?? t("settings:location.stay.last.none")}</StatusValue>}
          />
          <SettingItem
            title={t("settings:location.stay.now.name")}
            locked={locked}
            dependency={
              state && pausedReason
                ? {
                    reason: t(`settings:location.stay.pause.${pausedReason}`),
                    jump: jumpOf(pausedReason),
                  }
                : undefined
            }
            job={job ? <JobStatus job={job} /> : undefined}
            control={
              <>
                <ActionControl
                  label={t(
                    running ? "settings:location.stay.now.busy" : "settings:location.stay.now.label"
                  )}
                  busy={running || !state}
                  onClick={() => void startScan()}
                />
                <Link className="btn-secondary" to="/pending-updates?tab=dawarich">
                  {t("settings:location.stay.now.inbox")}
                </Link>
              </>
            }
          >
            {state?.windowStart ? (
              <p className="t-caption" style={{ margin: 0 }}>
                {t("settings:location.stay.window", {
                  from: at(state.windowStart),
                  to: at(state.windowEnd),
                })}
              </p>
            ) : null}
            {state?.dataThrough ? (
              <p className="t-caption" style={{ margin: 0 }}>
                {t("settings:location.stay.dataThrough", { at: at(state.dataThrough) })}
              </p>
            ) : null}
            {state?.finishedAt &&
            ["succeeded", "partial"].includes(result ?? "") &&
            !state.dataThrough ? (
              <p className="t-caption" style={{ margin: 0 }}>
                {t("settings:location.stay.noPoints")}
              </p>
            ) : null}
            {stale ? (
              <p className="t-caption" style={{ margin: 0 }}>
                {t("settings:location.stay.stale")}
              </p>
            ) : null}
            {coverage ? (
              <div role="status" className="flex flex-col" style={{ gap: 2 }}>
                <p className="t-caption" style={{ margin: 0 }}>
                  {t(`trips:dawarichStays.${coverageScope}.status.${coverage.status}`)}
                </p>
                <p className="t-caption" style={{ margin: 0 }}>
                  {t("trips:dawarichStays.markets.coverage", {
                    tiles: coverage.tiles,
                    total: coverage.totalTiles,
                  })}
                </p>
                {coverage.missingAreaCount ? (
                  <p className="t-caption" style={{ margin: 0 }}>
                    {t(`trips:dawarichStays.${coverageScope}.missing`, {
                      count: coverage.missingAreaCount,
                    })}
                  </p>
                ) : null}
                {coverage.staleMapData ? (
                  <p className="t-caption" style={{ margin: 0 }}>
                    {t("trips:dawarichStays.markets.stale")}
                  </p>
                ) : null}
                <p className="t-caption" style={{ margin: 0 }}>
                  {t(`trips:dawarichStays.${coverageScope}.counts`, {
                    created: coverage.createdCount,
                    known: coverage.alreadyRecordedCount,
                  })}
                </p>
              </div>
            ) : null}
          </SettingItem>
        </SettingRows>
      </SectionCard>
      {belege}
      {fineBefore || expert ? (
        <SectionCard>
          <SectionTitle title={t("settings:tt.groups.feinabstimmung")} />
          <SettingRows>
            {fineBefore}
            {expert ? (
              <SettingItem
                expert
                title={t("settings:location.stay.period.name")}
                locked={locked}
                control={
                  <ChoiceControl
                    value={lookback}
                    label={t("settings:location.stay.period.name")}
                    options={LOOKBACKS.map((days) => ({
                      value: days,
                      label: t("settings:location.stay.period.days", { count: Number(days) }),
                    }))}
                    onChange={setLookback}
                  />
                }
              />
            ) : null}

            {expert ? (
              <SettingItem
                expert
                title={t("settings:location.stay.areas.name")}
                locked={locked}
                save={areas}
                dependency={
                  state && !state.enabled
                    ? { reason: t("settings:location.stay.areas.scanOff") }
                    : undefined
                }
                control={
                  state ? (
                    <SwitchControl
                      checked={areas.value}
                      label={t("settings:location.stay.areas.name")}
                      onChange={areas.choose}
                    />
                  ) : undefined
                }
              />
            ) : null}
          </SettingRows>
        </SectionCard>
      ) : null}
    </>
  );
}
