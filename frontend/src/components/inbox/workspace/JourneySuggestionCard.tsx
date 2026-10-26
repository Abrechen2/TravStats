import { useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainVisible } from "../../../hooks/useDomainVisible";
import { apiErrorMachineCode } from "../../../lib/apiError";
import { saveErrorKey } from "../../../lib/saveErrorMessage";
import {
  locationSuggestionsApi,
  type JourneyEntryKind,
  type JourneyRun,
  type LocationSuggestion,
} from "../../../lib/api/locationSuggestions";
import { toLocal } from "../../../shared/time";
import Button from "../../ui/Button";
import TrackSectionPanel from "../track/TrackSectionPanel";
import { journeyRunSectionProps } from "../track/sectionProps";
import { RailFormModal } from "../../rail/RailFormModal";
import { BusFormModal } from "../../bus/BusFormModal";
import NewRoadtripDialog from "../../Roadtrips/NewRoadtripDialog";
import { W } from "./model";
import {
  busDraftFromRun,
  clearPendingLink,
  pendingLink,
  railDraftFromRun,
  roadtripStationsFromRun,
  savePendingLink,
  type PendingLink,
} from "./journeyPrefill";

const J = `${W}.journey`;

/** How often a link still being saved elsewhere is retried, and how long apart. */
const BUSY_RETRIES = 3;
const BUSY_DELAY_MS = 600;

/** Codes whose answer changes the card: the list is reloaded after the message. */
const RELOADING = new Set(["EVIDENCE_INVALIDATED", "SUGGESTION_ALREADY_RESOLVED"]);

const ERROR_KEYS: Readonly<Record<string, string>> = {
  EVIDENCE_INVALIDATED: `${J}.errors.invalidated`,
  SUGGESTION_ALREADY_RESOLVED: `${J}.errors.resolved`,
  SUGGESTION_ACCEPT_IN_PROGRESS: `${J}.errors.busy`,
  HISTORY_CHANGED: `${J}.errors.historyChanged`,
  EVIDENCE_UNVERIFIABLE: `${J}.errors.unverifiable`,
  TRAVTRACK_DISABLED: `${J}.errors.disabled`,
  TRAVTRACK_UNAVAILABLE: `${J}.errors.providerOff`,
  VALIDATION_FAILED: `${J}.errors.entryMismatch`,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `HH:mm` on the run end's own clock. */
const clock = (ms: number, zone: string) => toLocal(ms, zone).local.slice(11, 16);

type OpenForm = { kind: JourneyEntryKind; run: JourneyRun };

/**
 * A journey TravTrack saw that the logbook lacks (TravTrack plan E7): one
 * question per day, each run listed with its times, distance and a hint from
 * its speed. A run is answered by entering it — the rail, bus or roadtrip
 * form opens prefilled, the user saves it, and the saved entry is linked — or
 * by "Kein Eintrag nötig". A form saved whose link failed leaves the entry
 * standing; the card then offers to link that saved entry.
 */
export default function JourneySuggestionCard({
  suggestion,
  disabled,
  reload,
}: {
  suggestion: LocationSuggestion;
  disabled: boolean;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation(["dataQuality", "common"]);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<OpenForm | null>(null);
  // Re-read after each answer so a link remembered or cleared shows at once.
  const [, setPendingVersion] = useState(0);
  const offered: Record<JourneyEntryKind, boolean> = {
    rail: useDomainVisible("rail"),
    bus: useDomainVisible("bus"),
    roadtrip: useDomainVisible("roadtrip"),
  };
  const runs = suggestion.journey?.runs ?? [];

  const run = async (operation: () => Promise<unknown>, after?: () => void) => {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await operation();
          break;
        } catch (failure) {
          // Another click of the same answer is still being saved: wait for it.
          const busyElsewhere = apiErrorMachineCode(failure) === "SUGGESTION_ACCEPT_IN_PROGRESS";
          if (!busyElsewhere || attempt >= BUSY_RETRIES) throw failure;
          await wait(BUSY_DELAY_MS);
        }
      }
      after?.();
      await reload();
    } catch (failure) {
      setError(t(saveErrorKey(failure, `${W}.saveFailed`, ERROR_KEYS)));
      if (RELOADING.has(apiErrorMachineCode(failure) ?? "")) await reload();
    } finally {
      lock.current = false;
      setBusy(false);
      setPendingVersion((v) => v + 1);
    }
  };

  const link = (r: JourneyRun, entry: PendingLink) =>
    run(
      () =>
        locationSuggestionsApi.acceptJourneyRun(suggestion.id, {
          runIndex: r.index,
          entryKind: entry.entryKind,
          entryId: entry.entryId,
        }),
      () => clearPendingLink(suggestion.id, r.index)
    );

  /** The form saved its entry: remember it first, so a failed link can be retried. */
  const saved = async (entry: PendingLink) => {
    const target = form;
    setForm(null);
    if (!target) return;
    savePendingLink(suggestion.id, target.run.index, entry);
    await link(target.run, entry);
  };

  const working = busy || disabled;
  const open = runs.filter((r) => r.state === "open");

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-(--ts-bad)">
          {error}
        </p>
      )}
      <h3 className="text-base font-semibold">{t(`${J}.question`)}</h3>
      <p className="t-caption">{t(`${J}.source`)}</p>
      <p className="text-sm">{t(`${J}.evidence`, { count: runs.length })}</p>
      {suggestion.coverage === "truncated" && <p className="t-caption">{t(`${J}.partial`)}</p>}
      <ol className="space-y-3">
        {runs.map((r) => {
          const pending = r.state === "open" ? pendingLink(suggestion.id, r.index) : null;
          return (
            <li key={r.index} className="rounded border border-(--ts-border) p-3 space-y-2">
              <p className="text-sm font-medium">
                {t(`${J}.run`, {
                  from: clock(r.fromMs, r.startZone),
                  until: clock(r.untilMs, r.endZone),
                  km: Math.round(r.km),
                })}
              </p>
              {r.modeHint !== "unknown" && (
                <p className="t-caption">{t(`${J}.hint.${r.modeHint}`)}</p>
              )}
              {!r.startRecorded && <p className="t-caption">{t(`${J}.startNotRecorded`)}</p>}
              {!r.endRecorded && <p className="t-caption">{t(`${J}.endNotRecorded`)}</p>}
              {r.state === "linked" && r.link && (
                <p className="text-sm">{t(`${J}.linked.${r.link.entryKind}`)}</p>
              )}
              {r.state === "closed" && <p className="text-sm">{t(`${J}.closed`)}</p>}
              {r.state === "invalidated" && <p className="text-sm">{t(`${J}.invalidated`)}</p>}
              {r.state !== "invalidated" && (
                <TrackSectionPanel {...journeyRunSectionProps(suggestion, r)} />
              )}
              {r.state === "open" && (
                <div className="flex flex-wrap gap-2">
                  {pending && (
                    <Button
                      variant="primary"
                      disabled={working}
                      onClick={() => void link(r, pending)}
                    >
                      {t(`${J}.linkSaved`)}
                    </Button>
                  )}
                  {(["rail", "bus", "roadtrip"] as const)
                    .filter((kind) => offered[kind])
                    .map((kind) => (
                      <Button
                        key={kind}
                        variant={
                          !pending && r.modeHint === "rail" && kind === "rail"
                            ? "primary"
                            : undefined
                        }
                        disabled={working}
                        onClick={() => setForm({ kind, run: r })}
                      >
                        {t(`${J}.enter.${kind}`)}
                      </Button>
                    ))}
                  <Button
                    disabled={working}
                    onClick={() =>
                      void run(() =>
                        locationSuggestionsApi.closeJourneyRuns(suggestion.id, r.index)
                      )
                    }
                  >
                    {t(`${J}.noEntry`)}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="t-caption">{t(`${J}.effect`)}</p>
      {open.length > 1 && (
        <Button
          disabled={working}
          onClick={() => void run(() => locationSuggestionsApi.closeJourneyRuns(suggestion.id))}
        >
          {t(`${J}.closeRest`)}
        </Button>
      )}
      {form?.kind === "rail" && (
        <RailFormModal
          journey={null}
          initialDraft={railDraftFromRun(form.run)}
          onClose={() => setForm(null)}
          onSaved={(ride) => saved({ entryKind: "rail", entryId: ride.id })}
        />
      )}
      {form?.kind === "bus" && (
        <BusFormModal
          journey={null}
          initialDraft={busDraftFromRun(form.run)}
          onClose={() => setForm(null)}
          onSaved={(ride) => saved({ entryKind: "bus", entryId: ride.id })}
        />
      )}
      <NewRoadtripDialog
        open={form?.kind === "roadtrip"}
        initialName={
          suggestion.journey ? t(`${J}.roadtripName`, { day: suggestion.journey.day }) : ""
        }
        initialStations={
          form?.kind === "roadtrip"
            ? roadtripStationsFromRun(form.run, {
                start: t(`${J}.stationStart`),
                end: t(`${J}.stationEnd`),
              })
            : undefined
        }
        onClose={() => setForm(null)}
        onCreated={(route) => void saved({ entryKind: "roadtrip", entryId: route.id })}
      />
    </div>
  );
}
