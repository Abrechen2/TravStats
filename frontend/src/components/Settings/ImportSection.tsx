import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import { useSettingsStore } from "../../store/settingsStore";
import { Fr24ImportTile } from "../import/Fr24ImportTile";
import { GenericCsvImportTile } from "../import/GenericCsvImportTile";
import { LodgingCsvImportTile } from "../import/LodgingCsvImportTile";
import { MapsExportImportTile } from "../import/MapsExportImportTile";
import { PlaceCsvImportTile } from "../import/PlaceCsvImportTile";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";
import { ImportLogSection } from "../import/ImportLogSection";
import { useDomainColors } from "../../hooks/useDomainColors";

/**
 * The one place for LISTS — a whole collection at once, from a file.
 *
 * It used to hold the e-mail/PDF routes as well, and #238 read that as a gap
 * to fill. The opposite turned out to be right: a list is a one-off migration
 * of something you already have, while a booking mail arrives again and again
 * and belongs where the entry will live. Two different acts, two different
 * places — so the e-mail tiles moved to the add-dialog of each area, and this
 * page stopped promising them.
 *
 * Every ENABLED area still gets a section, even one with no list format yet:
 * the honest line "no route yet" is what tells a cruise user that nothing is
 * hidden from them.
 */
export default function ImportSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { colorOf } = useDomainColors();
  const { isEnabled } = useEnabledDomains();
  // Places need BOTH the user's domain choice and the instance beta flag —
  // the same two conditions the nav and the dashboard tab apply, kept in one
  // hook so this page cannot drift from them (see hooks/usePlacesVisible.ts).
  const placesVisible = usePlacesVisible();
  const autoCreateTrips = useSettingsStore((s) => s.autoCreateTrips);
  const setAutoCreateTrips = useSettingsStore((s) => s.setAutoCreateTrips);

  // The log and the tiles live on the SAME page, so a commit here must reach
  // the log — it loads once on mount, and without this signal a fresh import
  // sat under a log still reading "no imports yet" (caught in the browser;
  // every unit test was green while it was wrong).
  const [importToken, setImportToken] = useState<number>(0);
  const handleImported = useCallback((): void => setImportToken((n) => n + 1), []);

  /** List importers per domain. A domain may legitimately have none yet. */
  const listImporters = useMemo<Partial<Record<DomainKey, JSX.Element[]>>>(
    () => ({
      flight: [<Fr24ImportTile key="fr24" />, <GenericCsvImportTile key="csv" />],
      lodging: [
        // The Maps export first: it is the one file that brings an identity
        // with it, and the generic path would reduce it to a name.
        <MapsExportImportTile key="lodging-maps" onImported={handleImported} />,
        <LodgingCsvImportTile key="lodging-csv" onImported={handleImported} />,
      ],
      // POI Phase D §5: the CSV path with coordinates. Until 2026-09-05 this
      // group rendered empty although both backend routes existed — the
      // `poiDomain` gate named exactly this missing tile as its condition.
      poi: [<PlaceCsvImportTile key="poi-csv" onImported={handleImported} />],
    }),
    [handleImported]
  );

  const [logOpen, setLogOpen] = useState(false);

  const groups = AVAILABLE_DOMAINS.filter((key) =>
    key === "poi" ? placesVisible : isEnabled(key)
  );

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:import.title")}
        description={t("settings:import.description")}
      />
      {/* Import behaviour, not an import route: whether flights sharing a
          booking reference silently become a trip + booking. Persists
          immediately via the store's setter (like the base currency). */}
      <SettingRows>
        <Switch
          id="import-auto-create-trips"
          checked={autoCreateTrips}
          onChange={setAutoCreateTrips}
          label={t("settings:import.autoCreateTrips.label")}
          sub={t("settings:import.autoCreateTrips.description")}
        />
        {groups.map((key) => {
          const tiles = listImporters[key] ?? [];
          return (
            <div key={key} className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
              <span className="t-label-mono inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ background: colorOf(key) }}
                />
                {t(`common:${DOMAINS[key].i18nKey}`)}
              </span>
              {tiles.length > 0 ? (
                <SettingRows>{tiles}</SettingRows>
              ) : (
                <p className="t-caption">{t("settings:import.noRoutes")}</p>
              )}
            </div>
          );
        })}
      </SettingRows>
      {/*
        One log for every list import — behind a button, not unrolled beneath
        the tiles. It grows with every run, and an always-open log pushed the
        tiles (the thing one comes here to USE) further down the page with each
        import. Deliberately NOT remembered across visits: this is a place one
        comes to import, and the log is the smaller question. A plain expander
        rather than a modal, because the revert confirmation inside the log is
        itself an overlay — and an overlay over an overlay is how a dialog
        became unclickable once already.
      */}
      <div>
        <button
          type="button"
          data-testid="import-log-toggle"
          aria-expanded={logOpen}
          aria-controls="import-log-panel"
          onClick={() => setLogOpen((open) => !open)}
          className="btn-secondary"
        >
          <span aria-hidden="true">{logOpen ? "▾" : "▸"}</span> {t("settings:import.log.title")}
        </button>
        {logOpen && (
          <div id="import-log-panel">
            <ImportLogSection reloadKey={importToken} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
