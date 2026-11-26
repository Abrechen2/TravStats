import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTravTrackCapabilities } from "../../hooks/useTravTrackVisible";
import { useAuthStore } from "../../store/authStore";
import { JumpControl, useGuardedNavigate } from "../ui/settings";
import TravTrackImports from "../Settings/TravTrackImports";
import { ImportTileShell } from "./ImportTileShell";

/**
 * Google Timeline on the Import page. It builds no importer of its own: the
 * file goes through the TravTrack track-file import (same upload, job,
 * progress and counts), embedded here without its heading.
 *
 * While TravTrack cannot take a file the tile stays and says why — a tile that
 * vanished would leave a Timeline user wondering where the import went.
 */
export function TimelineImportTile(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const navigate = useGuardedNavigate();
  const caps = useTravTrackCapabilities();
  const isDemo = useIsDemoAccount();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);

  const note = isDemo
    ? t("settings:import.timeline.demo")
    : caps === null
      ? t("settings:import.timeline.unknown")
      : caps.enabled
        ? null
        : t("settings:import.timeline.off");

  return (
    <ImportTileShell
      title={t("settings:import.timeline.title")}
      description={t("settings:import.timeline.description")}
      descriptionMore={t("settings:import.timeline.descriptionMore")}
      picker={null}
    >
      {note ? (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          <p className="t-caption" role="status" data-testid="timeline-tile-note">
            {note}
          </p>
          {!isDemo && caps !== null ? (
            isAdmin ? (
              <JumpControl
                label={t("settings:import.timeline.offAdmin")}
                onJump={() => navigate("/settings/tt-bereit")}
              />
            ) : (
              <p className="t-caption">{t("settings:import.timeline.offMember")}</p>
            )
          ) : null}
        </div>
      ) : null}
      {caps !== null && (caps.hasData || caps.enabled) ? (
        <TravTrackImports
          bare
          canImport={caps.enabled && !isDemo}
          canDelete={!isDemo}
          onChanged={() => undefined}
          jump={{
            label: t("settings:import.timeline.toTravTrack"),
            onJump: () => navigate("/settings/tt-daten"),
          }}
        />
      ) : null}
    </ImportTileShell>
  );
}
