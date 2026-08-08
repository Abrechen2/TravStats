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

export default function ImportSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { isEnabled } = useEnabledDomains();

  // The log and the tiles now live on the SAME page, so a commit here must
  // reach the log — it loads once on mount, and without this signal a fresh
  // import sat under a log still reading "no imports yet" (caught in the
  // browser; every unit test was green while it was wrong).
  const [importToken, setImportToken] = useState<number>(0);
  const handleImported = useCallback((): void => setImportToken((n) => n + 1), []);

  /** Central import hub: one settings area, bulk importers grouped per domain.
   *  Single-record email/PDF parsing deliberately stays in the add dialogs.
   *  A future domain gets a group by adding its tiles here — nothing else. */
  const bulkImporters = useMemo<Partial<Record<DomainKey, JSX.Element[]>>>(
    () => ({
      flight: [<Fr24ImportTile key="fr24" />, <GenericCsvImportTile key="csv" />],
      lodging: [<LodgingCsvImportTile key="lodging-csv" onImported={handleImported} />],
    }),
    [handleImported]
  );

  const groups = AVAILABLE_DOMAINS.filter(
    (key) => isEnabled(key) && (bulkImporters[key]?.length ?? 0) > 0
  );

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:import.title")}
        description={t("settings:import.description")}
      />
      <div className="flex flex-col gap-6">
        {groups.map((key) => (
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{bulkImporters[key]}</div>
          </div>
        ))}
      </div>
      {/* One log for every bulk import, below the tiles that produce them —
          moved here from the lodging page, where a second import surface
          contradicted the "one place to import" rule. */}
      <ImportLogSection reloadKey={importToken} />
    </SectionCard>
  );
}
