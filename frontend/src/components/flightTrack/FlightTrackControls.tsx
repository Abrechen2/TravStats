import { useState } from "react";
import type { JSX } from "react";
import ConfirmModal from "../ui/ConfirmModal";
import { useTranslation } from "../../hooks/useTranslation";
import { flightsApi } from "../../lib/api";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { useToastStore } from "../../store/toastStore";

/**
 * The flight track upload's refusals (backend `routes/flights/track.ts`,
 * forgejo#312), each with its own DE/EN sentence — never the server's prose.
 * Flight-specific rather than the tour's `TRACK_ERROR_KEYS`: those name the
 * tour and leave the flight trackers' formats (KML, KMZ, Flightradar24's CSV)
 * out. One sentence per reason a file gives no track, so an export of only
 * the two airports is not reported as a broken file.
 */
export const FLIGHT_TRACK_ERROR_KEYS: Readonly<Record<string, string>> = {
  TRACK_FILE_MISSING: "flights:track.errors.fileMissing",
  TRACK_FILE_TOO_LARGE: "flights:track.errors.fileTooLarge",
  TRACK_FILE_UNSUPPORTED: "flights:track.errors.fileUnsupported",
  TRACK_FILE_UNREADABLE: "flights:track.errors.fileUnreadable",
  TRACK_KML_INVALID: "flights:track.errors.kmlInvalid",
  TRACK_KML_UNPAIRED: "flights:track.errors.kmlUnpaired",
  TRACK_KML_NO_TRACK: "flights:track.errors.kmlNoTrack",
  TRACK_KMZ_DAMAGED: "flights:track.errors.kmzDamaged",
  TRACK_KMZ_NO_KML: "flights:track.errors.kmzNoKml",
  TRACK_KMZ_TOO_LARGE: "flights:track.errors.kmzTooLarge",
  TRACK_CSV_COLUMNS: "flights:track.errors.csvColumns",
  TRACK_CSV_NO_POSITIONS: "flights:track.errors.csvNoPositions",
  TRACK_NO_TIMESTAMPS: "flights:track.errors.noTimestamps",
  TRACK_OUTSIDE_FLIGHT: "flights:track.errors.outsideFlight",
  TRACK_ALREADY_RECORDED: "flights:track.errors.alreadyRecorded",
  // The own receiver (forgejo#408): one sentence per failure, each saying what to do.
  RECEIVER_OFF: "flights:track.receiverErrors.off",
  RECEIVER_NOT_CONFIGURED: "flights:track.receiverErrors.notConfigured",
  PRIVATE_TARGET: "flights:track.receiverErrors.privateTarget",
  RECEIVER_NO_AIRCRAFT: "flights:track.receiverErrors.noAircraft",
  RECEIVER_NO_SCHEDULE: "flights:track.receiverErrors.noSchedule",
  RECEIVER_NOT_FOUND: "flights:track.receiverErrors.notFound",
  RECEIVER_OUTSIDE_WINDOW: "flights:track.receiverErrors.outsideWindow",
  RECEIVER_WINDOW_TOO_LONG: "flights:track.receiverErrors.windowTooLong",
  RECEIVER_AUTH: "flights:track.receiverErrors.auth",
  RECEIVER_TIMEOUT: "flights:track.receiverErrors.timeout",
  RECEIVER_UNREACHABLE: "flights:track.receiverErrors.unreachable",
  RECEIVER_ERROR: "flights:track.receiverErrors.error",
  RECEIVER_BAD_TRACE: "flights:track.receiverErrors.badTrace",
  RECEIVER_TOO_LARGE: "flights:track.receiverErrors.tooLarge",
};

const ICAO24 = /^[0-9a-f]{6}$/i;

const ACCEPTED_FILES = ".gpx,.kml,.kmz,.tcx,.fit,.csv";

const CONTROL =
  "rounded-sm border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--bg-surface) disabled:opacity-40";

interface Props {
  flightId: string;
  /** A recording is stored: a new file REPLACES it (after asking), and it can be removed. */
  hasTrack: boolean;
  /** Something was stored or removed — the section re-reads the recording. */
  onChanged: () => void;
  /** The aircraft's ICAO24 hex; the receiver is looked up by it, so no hex, no button. */
  aircraftModeS?: string | null;
}

type Pending = { kind: "replace"; file: File } | { kind: "remove" } | { kind: "receiver" };

/**
 * Upload, replace and remove a flight's recording (forgejo#312). Replacing
 * and removing both ask first: a recording the phone made cannot be fetched
 * again from anywhere. A refusal stays on screen beside the button, in the
 * reader's language, until the next attempt.
 */
export default function FlightTrackControls({
  flightId,
  hasTrack,
  onChanged,
  aircraftModeS,
}: Props): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const run = async (work: () => Promise<unknown>, success: string, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      addToast("success", t(success));
      onChanged();
    } catch (err: unknown) {
      setError(saveErrorMessage(err, t, fallback, FLIGHT_TRACK_ERROR_KEYS));
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File, replace: boolean): void => {
    void run(
      () => flightsApi.uploadTrackFile(flightId, file, replace),
      "flights:track.uploaded",
      "flights:track.errors.uploadFailed"
    );
  };

  const onFile = (file: File): void => {
    if (hasTrack) setPending({ kind: "replace", file });
    else upload(file, false);
  };

  const fromReceiver = (replace: boolean): void => {
    void run(
      () => flightsApi.fetchReceiverTrack(flightId, replace),
      "flights:track.receiverFetched",
      "flights:track.receiverErrors.failed"
    );
  };

  const confirm = (): void => {
    const action = pending;
    setPending(null);
    if (action?.kind === "replace") upload(action.file, true);
    if (action?.kind === "receiver") fromReceiver(true);
    if (action?.kind === "remove") {
      void run(
        () => flightsApi.deleteTrack(flightId),
        "flights:track.removed",
        "flights:track.errors.removeFailed"
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${CONTROL} ${busy ? "opacity-40" : "cursor-pointer"}`}>
          {busy
            ? t("flights:track.working")
            : t(hasTrack ? "flights:track.replace" : "flights:track.upload")}
          <input
            type="file"
            accept={ACCEPTED_FILES}
            className="sr-only"
            data-testid="flight-track-file"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {aircraftModeS && ICAO24.test(aircraftModeS.trim()) && (
          <button
            type="button"
            className={CONTROL}
            disabled={busy}
            data-testid="flight-track-receiver"
            onClick={() => (hasTrack ? setPending({ kind: "receiver" }) : fromReceiver(false))}
          >
            {t("flights:track.fromReceiver")}
          </button>
        )}
        {hasTrack && (
          <button
            type="button"
            className={CONTROL}
            disabled={busy}
            onClick={() => setPending({ kind: "remove" })}
          >
            {t("flights:track.remove")}
          </button>
        )}
        <span className="t-caption">{t("flights:track.formats")}</span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-(--danger)">
          {error}
        </p>
      )}
      {pending && (
        <ConfirmModal
          isOpen
          onClose={() => setPending(null)}
          onConfirm={confirm}
          title={t(
            pending.kind === "remove"
              ? "flights:track.removeConfirmTitle"
              : "flights:track.replaceConfirmTitle"
          )}
          message={t(
            pending.kind === "remove"
              ? "flights:track.removeConfirmMessage"
              : "flights:track.replaceConfirmMessage"
          )}
          confirmText={t(
            pending.kind === "remove" ? "flights:track.remove" : "flights:track.replace"
          )}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}
    </div>
  );
}
