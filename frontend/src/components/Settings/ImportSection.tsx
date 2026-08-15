import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Fr24ImportTile } from "../import/Fr24ImportTile";
import { GenericCsvImportTile } from "../import/GenericCsvImportTile";
import { LodgingCsvImportTile } from "../import/LodgingCsvImportTile";
import { ImportLogSection } from "../import/ImportLogSection";

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
  const { isEnabled } = useEnabledDomains();

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
      lodging: [<LodgingCsvImportTile key="lodging-csv" onImported={handleImported} />],
    }),
    [handleImported]
  );

  const groups = AVAILABLE_DOMAINS.filter((key) => isEnabled(key));

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:import.title")}
        description={t("settings:import.description")}
      />
      <div className="flex flex-col gap-6">
        {groups.map((key) => {
          const tiles = listImporters[key] ?? [];
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
      {/* One log for every list import, below the tiles that produce them. */}
      <ImportLogSection reloadKey={importToken} />
    </SectionCard>
  );
}
