import { useState } from "react";

import DetailSection from "../ui/DetailSection";
import ConfirmModal from "../Training/ConfirmModal";
import { useTranslation } from "../../hooks/useTranslation";
import { useCruiseTracks } from "../../hooks/useCruiseTracks";
import { apiErrorMessage } from "../../lib/apiError";
import { dawarichFailureKey, dawarichFailureKind } from "../../lib/api/dawarich";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { useToastStore } from "../../store/toastStore";
import type { CruiseLegTrack, CruiseTrackMeta } from "../../types/cruiseTracks";

interface Props {
  cruiseId: string;
  /** A recording was added or removed: the map and the figures need re-reading. */
  onChanged: () => void;
}

const CONTROL =
  "rounded-sm border border-(--color-border) px-3 py-1.5 text-xs hover:bg-(--bg-surface) disabled:opacity-40";

/**
 * Recorded tracks of a cruise (2.7): add one — a file, or a Dawarich pull of
 * one leg's window or the whole voyage — see per leg where its line comes
 * from and what the server says about the recordings, remove one.
 *
 * The verdict is the SERVER's (`GET /cruises/:id/tracks`); this component
 * only words it. A recording hangs off the cruise, not a leg, so "add a track"
 * on a leg uploads to the cruise and the server decides which legs it covers
 * — the leg button is a shortcut to the same place, with the leg's own window
 * for a Dawarich pull.
 */
export default function CruiseTracksPanel({ cruiseId, onChanged }: Props): JSX.Element {
  const { t, i18n } = useTranslation("cruise");
  const addToast = useToastStore((s) => s.addToast);
  const state = useCruiseTracks(cruiseId, onChanged);
  const [pendingRemove, setPendingRemove] = useState<CruiseTrackMeta | null>(null);

  const km = (value: number): string =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: 0 });
  const day = (iso: string): string =>
    new Date(iso).toLocaleDateString(i18n.language, { timeZone: "UTC" });

  const onFile = (file: File): void => {
    void (async () => {
      try {
        await state.upload(file);
        addToast("success", t("tracks.added"));
      } catch (err) {
        // A broken file and a file without timestamps are DIFFERENT server
        // sentences; whichever came back is the one to show.
        addToast("error", apiErrorMessage(err) ?? t("tracks.saveError"));
      }
    })();
  };

  const onPull = (legOrdinal?: number): void => {
    void (async () => {
      try {
        await state.pullDawarich(legOrdinal);
        addToast("success", t("tracks.added"));
      } catch (err) {
        const kind = dawarichFailureKind(err);
        addToast(
          "error",
          kind ? t(dawarichFailureKey(kind)) : (apiErrorMessage(err) ?? t("tracks.saveError"))
        );
      }
    })();
  };

  const fileInput = (label: string, testId: string): JSX.Element => (
    <label className={`${CONTROL} ${state.uploading ? "opacity-40" : "cursor-pointer"}`}>
      {state.uploading ? t("tracks.uploading") : label}
      <input
        type="file"
        accept=".gpx,.tcx,.fit"
        className="sr-only"
        data-testid={testId}
        disabled={state.uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );

  const pullButton = (legOrdinal: number | undefined, label: string): JSX.Element => (
    <button
      type="button"
      className={CONTROL}
      disabled={state.pulling !== null || !state.dawarichAvailable}
      title={state.dawarichAvailable ? undefined : t("tracks.dawarichUnavailable")}
      onClick={() => onPull(legOrdinal)}
    >
      {state.pulling === (legOrdinal ?? "voyage") ? t("tracks.pulling") : label}
    </button>
  );

  const verdictText = (leg: CruiseLegTrack): string | null =>
    leg.coverage === null ? null : t(`tracks.verdict.${leg.coverage.reason}`);

  return (
    <DetailSection title={t("tracks.title")}>
      <div className="space-y-4 text-sm">
        <p className="t-caption">{t("tracks.intro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {fileInput(t("tracks.upload"), "cruise-track-upload")}
          {pullButton(undefined, t("tracks.pullVoyage"))}
          {!state.dawarichAvailable && (
            <span className="t-caption">{t("tracks.dawarichUnavailable")}</span>
          )}
        </div>

        {state.loading && <p className="t-caption">{t("tracks.loading")}</p>}
        {!state.loading && state.loadError && (
          <div role="alert" className="text-(--danger)">
            <p>{t("tracks.loadError")}</p>
            <button type="button" className="underline" onClick={() => void state.reload()}>
              {t("common:buttons.retry")}
            </button>
          </div>
        )}

        {!state.loading && !state.loadError && state.overview && (
          <>
            <ul className="space-y-2" aria-label={t("tracks.legsTitle")}>
              {state.overview.legs.map((leg) => (
                <li
                  key={leg.ordinal}
                  data-testid={`cruise-leg-${leg.ordinal}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-(--color-border) p-3"
                >
                  <span className="min-w-0 flex-1">
                    {leg.fromPortName} → {leg.toPortName}
                    {leg.distanceKm !== null && (
                      <span className="t-caption"> · {km(leg.distanceKm)} km</span>
                    )}
                  </span>
                  <span className="rounded-sm bg-(--bg-surface) px-1.5 py-0.5 text-xs">
                    {t(`tracks.source.${leg.geometrySource}`)}
                  </span>
                  {verdictText(leg) && <span className="t-caption">{verdictText(leg)}</span>}
                  {leg.geometrySource !== "track" && (
                    <>
                      {fileInput(t("tracks.addToLeg"), `cruise-leg-upload-${leg.ordinal}`)}
                      {leg.window !== null && pullButton(leg.ordinal, t("tracks.pullLeg"))}
                    </>
                  )}
                </li>
              ))}
            </ul>

            {state.overview.tracks.length === 0 ? (
              <p className="t-caption">{t("tracks.empty")}</p>
            ) : (
              <ul className="space-y-2" aria-label={t("tracks.listTitle")}>
                {state.overview.tracks.map((track) => (
                  <li
                    key={track.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-(--color-border) p-3"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {track.name ?? t(`trips:tours.tracks.source.${track.source}`)} ·{" "}
                      {day(track.startedAt)} – {day(track.endedAt)}
                    </span>
                    <span className="t-caption">{km(track.distanceKm)} km</span>
                    <span className="t-caption">
                      {track.coveredLegs.length === 0
                        ? t("tracks.coversNone")
                        : t("tracks.coversLegs", { count: track.coveredLegs.length })}
                    </span>
                    {track.truncated && (
                      <span className="t-caption text-(--warning)">{t("tracks.truncated")}</span>
                    )}
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => setPendingRemove(track)}
                    >
                      {t("tracks.remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {pendingRemove && (
        <ConfirmModal
          isOpen
          onClose={() => setPendingRemove(null)}
          onConfirm={() => {
            const track = pendingRemove;
            setPendingRemove(null);
            void (async () => {
              try {
                await state.remove(track.id);
                addToast("success", t("tracks.removed"));
              } catch (err) {
                addToast("error", apiErrorMessage(err) ?? t("tracks.removeError"));
              }
            })();
          }}
          title={t("tracks.removeConfirmTitle")}
          message={t("tracks.removeConfirmMessage", {
            from: day(pendingRemove.startedAt),
            to: day(pendingRemove.endedAt),
          })}
          confirmText={t("tracks.remove")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}
    </DetailSection>
  );
}
