import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Fr24ImportTile } from "../import/Fr24ImportTile";
import { GenericCsvImportTile } from "../import/GenericCsvImportTile";
import { LodgingCsvImportTile } from "../import/LodgingCsvImportTile";
import { ParseImportTile } from "../import/ParseImportTile";
import { ImportLogSection } from "../import/ImportLogSection";
import { useCruiseImportAdapter } from "../import/adapters/cruiseAdapter";
import { useLodgingImportAdapter } from "../import/adapters/lodgingAdapter";

export default function ImportSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { isEnabled } = useEnabledDomains();

  // The log and the tiles now live on the SAME page, so a commit here must
  // reach the log — it loads once on mount, and without this signal a fresh
  // import sat under a log still reading "no imports yet" (caught in the
  // browser; every unit test was green while it was wrong).
  const [importToken, setImportToken] = useState<number>(0);
  const handleImported = useCallback((): void => setImportToken((n) => n + 1), []);

  // Hooks, so they run unconditionally regardless of which domains are on.
  const cruiseAdapter = useCruiseImportAdapter();
  const lodgingAdapter = useLodgingImportAdapter();

  /** Bulk importers per domain. A domain may legitimately have none. */
  const bulkImporters = useMemo<Partial<Record<DomainKey, JSX.Element[]>>>(
    () => ({
      flight: [<Fr24ImportTile key="fr24" />, <GenericCsvImportTile key="csv" />],
      lodging: [<LodgingCsvImportTile key="lodging-csv" onImported={handleImported} />],
    }),
    [handleImported]
  );

  /**
   * The e-mail / PDF route per domain — the way most bookings actually arrive,
   * and the one the hub used to omit entirely (#238). Cruise and lodging open
   * it in place; flights start it on their own page, where the multi-flight
   * review loop already lives (see `ParseImportTile`).
   */
  const parseImporters = useMemo<Partial<Record<DomainKey, JSX.Element>>>(
    () => ({
      flight: (
        <ParseImportTile
          key="flight-parse"
          title={t("settings:import.tile.parse.flight.title")}
          description={t("settings:import.tile.parse.flight.description")}
          actionLabel={t("settings:import.tile.parse.flight.action")}
          to="/flights?import=email"
        />
      ),
      cruise: (
        <ParseImportTile
          key="cruise-parse"
          title={t("settings:import.tile.parse.cruise.title")}
          description={t("settings:import.tile.parse.cruise.description")}
          actionLabel={t("settings:import.tile.parse.cruise.action")}
          adapter={cruiseAdapter}
        />
      ),
      lodging: (
        <ParseImportTile
          key="lodging-parse"
          title={t("settings:import.tile.parse.lodging.title")}
          description={t("settings:import.tile.parse.lodging.description")}
          actionLabel={t("settings:import.tile.parse.lodging.action")}
          adapter={lodgingAdapter}
        />
      ),
    }),
    [t, cruiseAdapter, lodgingAdapter]
  );

  // EVERY enabled domain gets a section. Filtering by "has a bulk importer"
  // is what hid cruises on an instance that had them switched on: the page
  // promises "bundled per area", so an area that is on must appear — with
  // whatever routes it has, or an honest line saying it has none yet.
  const groups = AVAILABLE_DOMAINS.filter((key) => isEnabled(key));

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:import.title")}
        description={t("settings:import.description")}
      />
      <div className="flex flex-col gap-6">
        {groups.map((key) => {
          const tiles = [...(bulkImporters[key] ?? [])];
          const parseTile = parseImporters[key];
          if (parseTile) tiles.push(parseTile);
          return (
            <div key={key}>
              <div className="mb-3 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ background: DOMAINS[key].color }}
                />
                <span className="text-xs font-semibold uppercase tracking-wider text-(--text-muted)">
                  {t(`common:${DOMAINS[key].i18nKey}`)}
                </span>
              </div>
              {tiles.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tiles}</div>
              ) : (
                <p className="text-sm text-(--text-muted)">{t("settings:import.noRoutes")}</p>
              )}
            </div>
          );
        })}
      </div>
      {/* One log for every bulk import, below the tiles that produce them —
          moved here from the lodging page, where a second import surface
          contradicted the "one place to import" rule. */}
      <ImportLogSection reloadKey={importToken} />
    </SectionCard>
  );
}
