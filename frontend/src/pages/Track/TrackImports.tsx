import { useCallback, useState } from "react";
import type { JSX } from "react";
import TravTrackDawarichCopy from "../../components/Settings/TravTrackDawarichCopy";
import TravTrackImports from "../../components/Settings/TravTrackImports";
import TravTrackSources from "../../components/Settings/TravTrackSources";
import { hasPushSources } from "../../components/Settings/travTrackPushSources";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravTrackCapabilities } from "../../hooks/useTravTrackVisible";
import { panelStyle } from "./map/trackMapStyle";

/**
 * `/track/imports` — Importe (board „Track-Karte", TravTrack plan T5.2/T5.3):
 * everything that brings positions in, in one place — a GPX file, the copy
 * from Dawarich, and the tokens OwnTracks and Overland post with. The same
 * components Settings used to host; Settings now links here while the Track
 * area is open. The rights follow the capabilities as there: nothing is
 * started for the demo account or while TravTrack is off, and the list and
 * its deletes stay while data is held.
 */
export default function TrackImports(): JSX.Element {
  const { t } = useTranslation(["track"]);
  const isDemo = useIsDemoAccount();
  const caps = useTravTrackCapabilities();
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  if (!caps) {
    return (
      <section data-testid="track-imports">
        <p className="t-caption">{t("track:importsTab.loading")}</p>
      </section>
    );
  }
  return (
    <section data-testid="track-imports" className="flex flex-col gap-4">
      <h2 className="t-card-title">{t("track:importsTab.title")}</h2>
      <p className="t-caption">{t("track:importsTab.intro")}</p>
      <div style={panelStyle} className="flex flex-col gap-2">
        <TravTrackImports
          canImport={caps.enabled && !isDemo}
          canDelete={!isDemo}
          version={version}
          onChanged={() => undefined}
        />
      </div>
      <div style={panelStyle} className="flex flex-col gap-2">
        <TravTrackDawarichCopy canStart={caps.enabled && !isDemo} onChanged={bump} />
      </div>
      {hasPushSources(caps.sources) && (
        <div style={panelStyle} className="flex flex-col gap-2">
          <TravTrackSources
            canCreate={caps.enabled && caps.active && !isDemo}
            canRevoke={!isDemo}
          />
        </div>
      )}
    </section>
  );
}
